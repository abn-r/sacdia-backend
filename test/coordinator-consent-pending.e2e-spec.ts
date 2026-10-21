// Must run before `../src/app.module` is required: an empty REDIS_URL keeps
// the suite on the in-memory cache and no BullMQ.
process.env.REDIS_URL = '';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BetterAuthService } from '../src/better-auth/better-auth.service';
import { ClubRoleEligibilityService } from '../src/club-role-eligibility/club-role-eligibility.service';
import { AuthorizationContextVersionService } from '../src/common/authorization/authorization-context-version.service';
import { AuthorizationContextService } from '../src/common/services/authorization-context.service';
import { UserAwareThrottlerGuard } from '../src/config/user-aware-throttler.guard';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createModelMock, createPrismaDouble } from './helpers/prisma-double';
import {
  buildAuthorizationSnapshot,
  createBearerToken,
  createTestJwtService,
} from './helpers/rbac-test-helpers';
import { createTable, type Row } from './helpers/world-prisma-double';

/**
 * Coordinator consent queue E2E: GET /coordination/me/consent-pending.
 *
 * The real app is booted (global guards, the real PermissionsGuard, the real
 * CoordinationService expansion, the real MembershipRequestsService /
 * ConsentGateService). PrismaService is the state-driven world double
 * (test/helpers/world-prisma-double.ts); `club_sections` is a small hand-written
 * model because the coordinator expansion filters on the CLUB relation
 * (`clubs: { is: { active, local_field_id } }`), which the double does not
 * evaluate.
 *
 * The world: local field 4 holds sections 31 (Club Orion) and 32 (Club Vega)
 * plus an INACTIVE section 34; section 33 (Club Lyra) belongs to local field 5.
 * Requests: three minors waiting with a current form (31, 32, 31), and around
 * them everything a coordinator must NOT see: a minor outside the coverage, one
 * in the inactive section, a verified one, one without a form, one whose only
 * form was superseded, one whose request is already active, and an adult.
 *
 * Acting / teen / device denials live in director-created-minor.e2e-spec.ts
 * (that world has the supervised principals).
 */

const LOCAL_FIELD = 4;
const OTHER_LOCAL_FIELD = 5;

const COORD_GENERAL = '00000000-0000-4000-8000-0000000000a1';
const COORD_SECTION = '00000000-0000-4000-8000-0000000000a2';
const COORD_NONE = '00000000-0000-4000-8000-0000000000a3';
const COORD_EXPIRED = '00000000-0000-4000-8000-0000000000a4';
const COORD_NO_PERMISSION = '00000000-0000-4000-8000-0000000000a5';
const DIRECTOR = '00000000-0000-4000-8000-0000000000a6';
const ADMIN = '00000000-0000-4000-8000-0000000000a7';
const UPLOADER = '00000000-0000-4000-8000-0000000000a8';

const MINOR_31_EARLY = '00000000-0000-4000-8000-0000000000b1';
const MINOR_32 = '00000000-0000-4000-8000-0000000000b2';
const MINOR_31_LATE = '00000000-0000-4000-8000-0000000000b3';
const MINOR_OUTSIDE = '00000000-0000-4000-8000-0000000000b4';
const MINOR_INACTIVE_SECTION = '00000000-0000-4000-8000-0000000000b5';
const MINOR_VERIFIED = '00000000-0000-4000-8000-0000000000b6';
const MINOR_NO_FORM = '00000000-0000-4000-8000-0000000000b7';
const MINOR_SUPERSEDED = '00000000-0000-4000-8000-0000000000b8';
const MINOR_ACTIVE = '00000000-0000-4000-8000-0000000000b9';
const ADULT = '00000000-0000-4000-8000-0000000000ba';

const coordinator = (permissions: string[] = ['consent:verify']) => ({
  globalRoleName: 'coordinator',
  globalPermissions: permissions,
});

const AUTHORIZATIONS: Record<
  string,
  Parameters<typeof buildAuthorizationSnapshot>[0]
> = {
  [COORD_GENERAL]: coordinator(),
  [COORD_SECTION]: coordinator(),
  [COORD_NONE]: coordinator(),
  [COORD_EXPIRED]: coordinator(),
  // A coordinator role that does not carry consent:verify.
  [COORD_NO_PERMISSION]: coordinator(['clubs:read']),
  // A club director of section 31: consent:verify comes from the CLUB role.
  [DIRECTOR]: {
    activeRoleName: 'director',
    activePermissions: ['club_members:approve', 'consent:verify'],
    clubId: 70,
    clubSectionId: 31,
  },
  // consent:verify from a non-coordinator GLOBAL role.
  [ADMIN]: {
    globalRoleName: 'super-admin',
    globalPermissions: ['consent:verify', 'club_members:approve'],
  },
};

const daysAgo = (days: number): Date => {
  const date = new Date();
  date.setUTCHours(10, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date;
};
const startOfToday = (offsetDays: number): Date => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date;
};

type SectionFixture = {
  club_section_id: number;
  active: boolean;
  club_type_id: number;
  club_type_name: string;
  club: {
    club_id: number;
    name: string;
    active: boolean;
    local_field_id: number;
    districlub_type_id: number;
    district_name: string;
  };
};

const SECTIONS: SectionFixture[] = [
  {
    club_section_id: 31,
    active: true,
    club_type_id: 1,
    club_type_name: 'Conquistadores',
    club: {
      club_id: 70,
      name: 'Club Orion',
      active: true,
      local_field_id: LOCAL_FIELD,
      districlub_type_id: 1,
      district_name: 'Distrito Norte',
    },
  },
  {
    club_section_id: 32,
    active: true,
    club_type_id: 2,
    club_type_name: 'Aventureros',
    club: {
      club_id: 71,
      name: 'Club Vega',
      active: true,
      local_field_id: LOCAL_FIELD,
      districlub_type_id: 2,
      district_name: 'Distrito Sur',
    },
  },
  {
    club_section_id: 33,
    active: true,
    club_type_id: 1,
    club_type_name: 'Conquistadores',
    club: {
      club_id: 72,
      name: 'Club Lyra',
      active: true,
      local_field_id: OTHER_LOCAL_FIELD,
      districlub_type_id: 3,
      district_name: 'Distrito Este',
    },
  },
  {
    club_section_id: 34,
    active: false,
    club_type_id: 3,
    club_type_name: 'Guías Mayores',
    club: {
      club_id: 70,
      name: 'Club Orion',
      active: true,
      local_field_id: LOCAL_FIELD,
      districlub_type_id: 1,
      district_name: 'Distrito Norte',
    },
  },
];

/** The where clauses the coordinator expansion and its scope rows send. */
function sectionMatches(where: Row | undefined, section: SectionFixture) {
  if (!where) return true;
  const id = where.club_section_id;
  if (typeof id === 'number' && id !== section.club_section_id) return false;
  if (id?.in && !id.in.includes(section.club_section_id)) return false;
  if (where.active !== undefined && where.active !== section.active) {
    return false;
  }
  if (
    where.club_type_id !== undefined &&
    where.club_type_id !== section.club_type_id
  ) {
    return false;
  }
  const club = where.clubs?.is;
  if (club) {
    if (club.active !== undefined && club.active !== section.club.active) {
      return false;
    }
    if (
      club.local_field_id !== undefined &&
      club.local_field_id !== section.club.local_field_id
    ) {
      return false;
    }
    if (
      club.districlub_type_id?.in &&
      !club.districlub_type_id.in.includes(section.club.districlub_type_id)
    ) {
      return false;
    }
  }
  return true;
}

const sectionRow = (section: SectionFixture) => ({
  club_section_id: section.club_section_id,
  club_type_id: section.club_type_id,
  main_club_id: section.club.club_id,
  active: section.active,
  club_types: { name: section.club_type_name },
  clubs: {
    club_id: section.club.club_id,
    name: section.club.name,
    active: section.club.active,
    districlub_type_id: section.club.districlub_type_id,
    local_field_id: section.club.local_field_id,
    districts: { name: section.club.district_name },
    local_fields: { name: `Campo ${section.club.local_field_id}` },
  },
});

describe('Coordinator consent queue E2E (GET /coordination/me/consent-pending)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let throttlerSpy: jest.SpyInstance;

  // ---- the world -----------------------------------------------------------
  const evidences: Row[] = [];
  const currentFormsOf = (grant: Row): Row[] =>
    evidences
      .filter(
        (e) =>
          e.guardianship_id === grant.guardianship_id &&
          e.superseded_at === null &&
          e.purged_at === null,
      )
      .sort((a, b) => b.uploaded_at.getTime() - a.uploaded_at.getTime())
      .slice(0, 1);

  const profiles = createTable({ idField: 'user_id' });
  const users = createTable({
    idField: 'user_id',
    defaults: () => ({ active: true, email: null, user_image: null }),
    decorate: (row) => ({
      ...row,
      dependent_profile:
        profiles.rows.find((p) => p.user_id === row.user_id) ?? null,
      supervised_login: null,
      guardianships_as_dependent: [],
    }),
  });
  const guardianships = createTable({
    idField: 'guardianship_id',
    defaults: () => ({
      guardian_user_id: null,
      is_primary: true,
      is_custodian: true,
      custodian_club_id: 70,
      is_test_data: false,
      consent_status: 'pending',
      verified_at: null,
      external_name: null,
      relationship_type_id: null,
      created_at: daysAgo(30),
    }),
    decorate: (row) => ({
      ...row,
      consent_evidences: currentFormsOf(row),
      guardian: null,
      relationship_type: null,
      custodian_club: { name: 'Club Orion' },
      dependent: {
        dependent_profile: {
          created_by_user_id: UPLOADER,
        },
      },
    }),
  });
  /** Exactly the columns listPending selects from `users`. */
  const listedUser = (userId: string) => {
    const base = users.rows.find((u) => u.user_id === userId)!;
    return {
      user_id: base.user_id,
      name: base.name,
      email: base.email ?? null,
      paternal_last_name: base.paternal_last_name,
      maternal_last_name: base.maternal_last_name ?? null,
      user_image: base.user_image ?? null,
    };
  };
  const assignments = createTable({
    idField: 'assignment_id',
    defaults: () => ({
      active: true,
      status: 'pending',
      role_id: 'role-member',
      expires_at: null,
    }),
    decorate: (row) => ({
      ...row,
      users: listedUser(row.user_id),
      roles: { role_id: row.role_id, role_name: 'member' },
    }),
  });
  const coordinatorAssignments = createTable({ idField: 'assignment_id' });

  const bearer = (userId: string) => ({
    Authorization: `Bearer ${createBearerToken(jwtService, userId)}`,
  });
  const errorCode = (body: any): string | undefined =>
    body?.error?.code ?? body?.code ?? body?.message?.code;
  const queue = (userId: string, query = '') =>
    request(app.getHttpServer())
      .get(`/api/v1/coordination/me/consent-pending${query}`)
      .set(bearer(userId));
  const listedUsers = (body: any): string[] =>
    body.data.items.map((item: { user_id: string }) => item.user_id);

  /** A minor with a pending request in `sectionId` and a custody row. */
  const seedMinor = (
    userId: string,
    sectionId: number,
    options: {
      formDaysAgo?: number | null;
      consent?: 'pending' | 'verified';
      superseded?: boolean;
      requestStatus?: string;
      requestDaysAgo?: number;
    } = {},
  ) => {
    users.rows.push({
      user_id: userId,
      name: 'Menor',
      paternal_last_name: userId.slice(-2),
      maternal_last_name: null,
      birthday: daysAgo(9 * 365),
      country_id: 1,
      email: null,
      user_image: null,
      active: true,
    });
    profiles.rows.push({ user_id: userId, created_by_user_id: UPLOADER });
    const guardianshipId = `g-${userId}`;
    guardianships.rows.push({
      guardianship_id: guardianshipId,
      dependent_user_id: userId,
      guardian_user_id: null,
      is_primary: true,
      is_custodian: true,
      custodian_club_id: 70,
      is_test_data: false,
      consent_status: options.consent ?? 'pending',
      verified_at: options.consent === 'verified' ? daysAgo(1) : null,
      external_name: null,
      relationship_type_id: null,
      created_at: daysAgo(30),
    });
    if (options.formDaysAgo !== null) {
      evidences.push({
        evidence_id: `e-${userId}`,
        guardianship_id: guardianshipId,
        uploaded_by_user_id: UPLOADER,
        uploaded_at: daysAgo(options.formDaysAgo ?? 3),
        superseded_at: options.superseded ? daysAgo(1) : null,
        purged_at: null,
      });
    }
    assignments.rows.push({
      assignment_id: `as-${userId}`,
      user_id: userId,
      role_id: 'role-member',
      club_section_id: sectionId,
      status: options.requestStatus ?? 'pending',
      active: true,
      created_at: daysAgo(options.requestDaysAgo ?? 20),
      expires_at: null,
    });
  };

  const seedWorld = () => {
    for (const id of [
      COORD_GENERAL,
      COORD_SECTION,
      COORD_NONE,
      COORD_EXPIRED,
      COORD_NO_PERMISSION,
      DIRECTOR,
      ADMIN,
      UPLOADER,
      ADULT,
    ]) {
      users.rows.push({
        user_id: id,
        name: 'Adulto',
        paternal_last_name: id.slice(-2),
        maternal_last_name: null,
        birthday: new Date('1985-01-15T00:00:00.000Z'),
        country_id: 1,
        email: `${id.slice(-2)}@example.org`,
        user_image: null,
        active: true,
      });
    }

    // Waiting with a current form: 32 (9 days), 31 (5 days), 31 (2 days).
    seedMinor(MINOR_32, 32, { formDaysAgo: 9 });
    seedMinor(MINOR_31_EARLY, 31, { formDaysAgo: 5 });
    seedMinor(MINOR_31_LATE, 31, { formDaysAgo: 2 });
    // Everything a coordinator must not see.
    seedMinor(MINOR_OUTSIDE, 33, { formDaysAgo: 20 });
    seedMinor(MINOR_INACTIVE_SECTION, 34, { formDaysAgo: 20 });
    seedMinor(MINOR_VERIFIED, 31, { formDaysAgo: 20, consent: 'verified' });
    seedMinor(MINOR_NO_FORM, 32, { formDaysAgo: null });
    seedMinor(MINOR_SUPERSEDED, 31, { formDaysAgo: 20, superseded: true });
    seedMinor(MINOR_ACTIVE, 31, { formDaysAgo: 20, requestStatus: 'active' });
    assignments.rows.push({
      assignment_id: `as-${ADULT}`,
      user_id: ADULT,
      role_id: 'role-member',
      club_section_id: 31,
      status: 'pending',
      active: true,
      created_at: daysAgo(25),
      expires_at: null,
    });

    const assignment = (
      assignment_id: string,
      user_id: string,
      over: Row,
    ): Row => ({
      assignment_id,
      user_id,
      active: true,
      local_field_id: LOCAL_FIELD,
      zone_id: null,
      club_type_id: null,
      club_section_id: null,
      start_date: startOfToday(-30),
      end_date: null,
      created_at: daysAgo(30),
      ...over,
    });
    coordinatorAssignments.rows.push(
      assignment('ca-general', COORD_GENERAL, { assignment_type: 'GENERAL' }),
      assignment('ca-section', COORD_SECTION, {
        assignment_type: 'SECTION',
        club_section_id: 32,
      }),
      assignment('ca-expired', COORD_EXPIRED, {
        assignment_type: 'SECTION',
        club_section_id: 31,
        start_date: startOfToday(-60),
        end_date: startOfToday(-1),
      }),
      // A coordinator role WITHOUT consent:verify, assigned anyway.
      assignment('ca-no-permission', COORD_NO_PERMISSION, {
        assignment_type: 'GENERAL',
      }),
    );
  };

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET || 'test-secret';
    jwtService = createTestJwtService();
    throttlerSpy = jest
      .spyOn(UserAwareThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(true);
    jest
      .spyOn(NotificationsService.prototype, 'sendSilentToSection')
      .mockResolvedValue(undefined);

    seedWorld();

    const prismaDouble = createPrismaDouble({
      users: users.model,
      dependent_profiles: profiles.model,
      guardianships: guardianships.model,
      club_role_assignments: assignments.model,
      coordinator_assignments: coordinatorAssignments.model,
      club_sections: createModelMock({
        findMany: jest.fn(async (args: Row = {}) =>
          SECTIONS.filter((section) => sectionMatches(args.where, section)).map(
            sectionRow,
          ),
        ),
        findFirst: jest.fn(async (args: Row = {}) => {
          const found = SECTIONS.find((section) =>
            sectionMatches(args.where, section),
          );
          return found ? sectionRow(found) : null;
        }),
      }),
      countries: createModelMock({
        findUnique: jest.fn().mockResolvedValue({
          minor_self_login_min_age: 13,
          age_of_majority: 18,
          age_reference_timezone: 'America/Mexico_City',
        }),
      }),
      authorization_context_versions: createModelMock({
        upsert: jest.fn().mockResolvedValue({ version: 1n }),
      }),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn(async (arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => Promise<unknown>)(prismaDouble)
          : Promise.all(arg as Array<Promise<unknown>>),
      ),
    });

    const authorizationContext = {
      resolveUserAuthorization: jest.fn(async (userId: string) => ({
        profile: { user_id: userId },
        post_register_complete: true,
        authorization: buildAuthorizationSnapshot(
          AUTHORIZATIONS[userId] ?? { assignmentId: null },
        ),
        legacy: {
          roles: [],
          permissions: [],
          club: null,
          club_context: {
            active_assignment_id: null,
            active: null,
            available: [],
          },
        },
      })),
      canManageClub: jest.fn().mockResolvedValue(false),
      canAccessHierarchyScope: jest.fn().mockReturnValue(false),
      isSuperAdmin: jest.fn(async (userId: string) => userId === ADMIN),
      hasAnyGlobalRole: jest.fn(async (userId: string) => userId === ADMIN),
      invalidateUserAuthorizationCache: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthorizationContextService)
      .useValue(authorizationContext)
      .overrideProvider(BetterAuthService)
      .useValue({
        hasTotpEnabled: jest.fn().mockResolvedValue({ enabled: false }),
        signOut: jest.fn().mockResolvedValue(undefined),
        findLinkedDeviceOfSession: jest.fn().mockResolvedValue(null),
      })
      .overrideProvider(ClubRoleEligibilityService)
      .useValue({ assertAssignment: jest.fn().mockResolvedValue({}) })
      .overrideProvider(AuthorizationContextVersionService)
      .useValue({ bump: jest.fn().mockResolvedValue(1n) })
      .overrideProvider(PrismaService)
      .useValue(prismaDouble)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    throttlerSpy.mockRestore();
  });

  it('a GENERAL coordinator gets every waiting form of the local field, longest-waiting first, labelled by section', async () => {
    const response = await queue(COORD_GENERAL);

    expect(response.status).toBe(200);
    expect(listedUsers(response.body)).toEqual([
      MINOR_32,
      MINOR_31_EARLY,
      MINOR_31_LATE,
    ]);
    expect(response.body.data).toMatchObject({
      total: 3,
      limit: 50,
      offset: 0,
      by_section: [
        {
          club_section_id: 31,
          club_name: 'Club Orion',
          club_type_name: 'Conquistadores',
          district_name: 'Distrito Norte',
          pending_consent_count: 2,
        },
        {
          club_section_id: 32,
          club_name: 'Club Vega',
          club_type_name: 'Aventureros',
          district_name: 'Distrito Sur',
          pending_consent_count: 1,
        },
      ],
    });
    expect(response.body.data.items[0]).toMatchObject({
      assignment_id: `as-${MINOR_32}`,
      club_section_id: 32,
      club_name: 'Club Vega',
      club_type_name: 'Aventureros',
      district_name: 'Distrito Sur',
      consent_form_uploaded_at: expect.any(String),
      effective_expires_at: expect.any(String),
      consent: {
        required: true,
        dependent: true,
        status: 'pending',
        evidence_uploaded: true,
        viewer_can_verify: true,
        viewer_verify_block: null,
      },
    });
  });

  it('nothing outside the coverage or without work: no other local field, no inactive section, no adult, no verified, no form-less, no superseded-only, no non-pending request', async () => {
    const response = await queue(COORD_GENERAL);

    const listed = listedUsers(response.body);
    for (const hidden of [
      MINOR_OUTSIDE,
      MINOR_INACTIVE_SECTION,
      ADULT,
      MINOR_VERIFIED,
      MINOR_NO_FORM,
      MINOR_SUPERSEDED,
      MINOR_ACTIVE,
    ]) {
      expect(listed).not.toContain(hidden);
    }
  });

  it('the item carries the same personal fields as the per-section list, nothing more (no birthday, no guardian contact)', async () => {
    const response = await queue(COORD_GENERAL);

    const [item] = response.body.data.items;
    expect(Object.keys(item.users).sort()).toEqual(
      [
        'email',
        'maternal_last_name',
        'name',
        'paternal_last_name',
        'user_id',
        'user_image',
      ].sort(),
    );
    expect(item.users.email).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('birthday');
    expect(JSON.stringify(response.body)).not.toContain(UPLOADER);
  });

  it('a SECTION coordinator sees only their section', async () => {
    const response = await queue(COORD_SECTION);

    expect(response.status).toBe(200);
    expect(listedUsers(response.body)).toEqual([MINOR_32]);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.by_section).toEqual([
      expect.objectContaining({
        club_section_id: 32,
        pending_consent_count: 1,
      }),
    ]);
  });

  it('pages with limit / offset; total stays whole', async () => {
    const firstPage = await queue(COORD_GENERAL, '?limit=2');
    const secondPage = await queue(COORD_GENERAL, '?limit=2&offset=2');

    expect(listedUsers(firstPage.body)).toEqual([MINOR_32, MINOR_31_EARLY]);
    expect(listedUsers(secondPage.body)).toEqual([MINOR_31_LATE]);
    expect(firstPage.body.data).toMatchObject({
      total: 3,
      limit: 2,
      offset: 0,
    });
    expect(secondPage.body.data).toMatchObject({
      total: 3,
      limit: 2,
      offset: 2,
    });
  });

  it.each([
    ['limit above 100', '?limit=101'],
    ['limit 0', '?limit=0'],
    ['a negative offset', '?offset=-1'],
    ['an unknown param', '?cursor=abc'],
  ])('%s is 400', async (_label, query) => {
    const response = await queue(COORD_GENERAL, query);

    expect(response.status).toBe(400);
  });

  it.each([
    ['a club director (consent:verify from the CLUB role)', DIRECTOR],
    ['an admin (consent:verify from a non-coordinator role)', ADMIN],
    [
      'a coordinator whose role lacks consent:verify (assigned anyway)',
      COORD_NO_PERMISSION,
    ],
  ])('%s is 403 GUARD_PERMISSION_DENIED', async (_label, userId) => {
    const response = await queue(userId);

    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe('GUARD_PERMISSION_DENIED');
  });

  it.each([
    ['without any assignment', COORD_NONE],
    ['whose only assignment expired', COORD_EXPIRED],
  ])(
    'a coordinator %s is 403 GUARD_CLUB_SCOPE_REQUIRED',
    async (_label, userId) => {
      const response = await queue(userId);

      expect(response.status).toBe(403);
      expect(errorCode(response.body)).toBe('GUARD_CLUB_SCOPE_REQUIRED');
    },
  );

  it('once a form is verified it leaves the queue (state-driven)', async () => {
    guardianships.find({ dependent_user_id: MINOR_32 })!.consent_status =
      'verified';

    const response = await queue(COORD_GENERAL);

    expect(listedUsers(response.body)).toEqual([MINOR_31_EARLY, MINOR_31_LATE]);
    expect(response.body.data.total).toBe(2);
  });
});

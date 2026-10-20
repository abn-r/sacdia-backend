// Must run before `../src/app.module` is required: an empty REDIS_URL keeps
// the suite on the in-memory cache and no BullMQ. test/setup.ts replaces the
// principal resolver with an adult-only one unless asked: the admin journey
// needs the REAL one (a disabled teen must be cut with a 401).
process.env.REDIS_URL = '';
process.env.E2E_REAL_SUPERVISED_RESOLVER = 'true';
process.env.FAMILY_DIRECTOR_CREATE_MINOR_ENABLED = 'true';
process.env.FAMILY_TEEN_LOGIN_ENABLED = 'true';
process.env.FAMILY_LINKED_DEVICE_ENABLED = 'true';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ActingForCache } from '../src/auth/acting-for/acting-for.cache';
import { ClubRoleEligibilityService } from '../src/club-role-eligibility/club-role-eligibility.service';
import { AuthorizationContextVersionService } from '../src/common/authorization/authorization-context-version.service';
import { accessJwtClaims } from '../src/common/constants/jwt-audiences';
import { AuthorizationContextService } from '../src/common/services/authorization-context.service';
import { UserAwareThrottlerGuard } from '../src/config/user-aware-throttler.guard';
import { GuardianNotificationsService } from '../src/guardianships/guardian-notifications.service';
import { CURRENT_LEGAL_DOCUMENTS } from '../src/legal/legal-documents.constants';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { BetterAuthService } from '../src/better-auth/better-auth.service';
import { createModelMock, createPrismaDouble } from './helpers/prisma-double';
import {
  buildAuthorizationSnapshot,
  createBearerToken,
  createTestJwtService,
} from './helpers/rbac-test-helpers';
import { createTable, type Row } from './helpers/world-prisma-double';

/**
 * Director-created minor E2E (family profiles 3c, FP3-61..66).
 *
 * The real app is booted (global + local guards, the real JwtStrategy, the real
 * SupervisedPrincipalResolver and LinkedDeviceGate, DTO validation, the error
 * filter, the real services behind every route). Only PrismaService (a
 * STATE-DRIVEN in-memory double, see test/helpers/world-prisma-double.ts: rows
 * written by one request are read by the next), BetterAuthService and
 * AuthorizationContextService are replaced, plus three collaborators that are
 * not under test here (see "What is NOT driven" below).
 *
 *   A. A director registers a 10-year-old; the creator cannot verify; a
 *      verify-only reviewer cannot approve; another reviewer verifies; the
 *      director approves; the family claims the minor with a code; the creator
 *      verifies the PARENT's new form.
 *   B. An admin cuts a minor's own login and a paired device: reason mandatory,
 *      immediate 401, guardians notified, audited, and NO route to enable or
 *      reset a password.
 *
 * What is NOT driven (state is flipped, the real code has unit coverage):
 *  - the consent form upload (R2 is not configured in the sandbox): the
 *    evidence row is written straight into the double;
 *  - ClubRoleEligibilityService and AuthorizationContextVersionService are
 *    stubbed (approval eligibility rules and the authorization cache version
 *    are unrelated to the consent journey);
 *  - the push/inbox delivery: NotificationsService.sendToUser is a spy, so the
 *    asserts are on WHO is told and with what payload.
 *
 * Relation filters in `where` (`account: { none }`, `dependent_profile: { is }`)
 * are not evaluated by the double; the decorated rows carry the relations
 * instead. Coordinators are not part of the journey: the guard cannot resolve
 * their territory (B11 finding), a CLUB secretary is the independent verifier.
 */

const SECTION_ID = 3;
const CLUB_ID = 7;
const DIRECTOR_1 = '00000000-0000-4000-8000-0000000000d1';
const DIRECTOR_2 = '00000000-0000-4000-8000-0000000000d2';
const SECRETARY = '00000000-0000-4000-8000-0000000000e1';
const MEMBER = '00000000-0000-4000-8000-0000000000e2';
const PARENT = '00000000-0000-4000-8000-0000000000a1';
const OTHER_ADULT = '00000000-0000-4000-8000-0000000000a2';
const ADMIN = '00000000-0000-4000-8000-0000000000f1';
const ADMIN_READ_ONLY = '00000000-0000-4000-8000-0000000000f2';
const GUARDIAN = '00000000-0000-4000-8000-0000000000b1';
const TEEN = '00000000-0000-4000-8000-0000000000c1';
const CHILD = '00000000-0000-4000-8000-0000000000c2';
const OTHER_CHILD = '00000000-0000-4000-8000-0000000000c3';
const RELATIONSHIP_ID = '00000000-0000-4000-8000-0000000000e9';
const HANDLE = 'rayo-veloz-482913';
const DEVICE_ID = '00000000-0000-4000-8000-0000000000d9';
const OTHER_DEVICE_ID = '00000000-0000-4000-8000-0000000000d8';
const DEVICE_SESSION = 'device-session-1';

const AUTHORIZATIONS: Record<
  string,
  Parameters<typeof buildAuthorizationSnapshot>[0]
> = {
  [DIRECTOR_1]: {
    activeRoleName: 'director',
    activePermissions: [
      'dependents:create',
      'club_members:approve',
      'consent:verify',
    ],
    clubId: CLUB_ID,
    clubSectionId: SECTION_ID,
  },
  [DIRECTOR_2]: {
    activeRoleName: 'director',
    activePermissions: [
      'dependents:create',
      'club_members:approve',
      'consent:verify',
    ],
    clubId: CLUB_ID,
    clubSectionId: SECTION_ID,
  },
  // Verify-only reviewer: consent:verify WITHOUT club_members:approve.
  [SECRETARY]: {
    activeRoleName: 'secretary',
    activePermissions: ['consent:verify'],
    clubId: CLUB_ID,
    clubSectionId: SECTION_ID,
  },
  [ADMIN]: {
    globalRoleName: 'super-admin',
    globalPermissions: [
      'users:read_detail',
      'users:update_admin',
      'legal_representative:read',
      'legal_representative:update',
    ],
  },
  // An admin who can read but not write.
  [ADMIN_READ_ONLY]: {
    globalRoleName: 'admin',
    globalPermissions: ['users:read_detail'],
    unionId: 2,
  },
};

describe('Director-created minor E2E', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let config: ConfigService;
  let actingCache: ActingForCache;
  let throttlerSpy: jest.SpyInstance;
  let sendToUser: jest.SpyInstance;
  let onConsentVerified: jest.SpyInstance;

  // ---- the world -----------------------------------------------------------
  const users = createTable({
    idField: 'user_id',
    defaults: () => ({
      active: true,
      email: null,
      user_image: null,
      union_id: null,
      local_field_id: null,
      country_id: 1,
    }),
    decorate: (row) => ({
      ...row,
      email: row.email ?? null,
      dependent_profile:
        profiles.rows.find((p) => p.user_id === row.user_id) ?? null,
      supervised_login:
        logins.rows.find((l) => l.user_id === row.user_id) ?? null,
      account: accounts.rows
        .filter((a) => a.userId === row.user_id)
        .map((a) => ({ id: a.id })),
      users_pr: usersPr.rows.find((p) => p.user_id === row.user_id) ?? {
        complete: false,
        active_club_assignment_id: null,
      },
      // Verified, real, not revoked (custody included): what the principal
      // resolver and the security notices read from this relation.
      guardianships_as_dependent: guardianships.rows
        .filter(
          (g) =>
            g.dependent_user_id === row.user_id &&
            g.consent_status === 'verified' &&
            !g.is_test_data,
        )
        .map((g) => ({ ...g, consent_evidences: evidencesOf(g) })),
      users_roles: [],
      enrollments: [],
      club_role_assignments: [],
    }),
  });
  const profiles = createTable({ idField: 'user_id' });
  const usersPr = createTable({ idField: 'user_id' });
  const accounts = createTable({ idField: 'id' });
  const logins = createTable({ idField: 'user_id' });
  const sessions = createTable({ idField: 'id' });
  const devices = createTable({
    idField: 'linked_device_id',
    decorate: (row) => ({
      ...row,
      guardianship:
        guardianships.rows.find(
          (g) => g.guardianship_id === row.guardianship_id,
        ) ?? null,
      dependent: userView(row.dependent_user_id),
      paired_by: userView(row.paired_by_user_id),
    }),
  });
  const guardianships = createTable({
    idField: 'guardianship_id',
    defaults: () => ({
      guardian_user_id: null,
      is_primary: false,
      is_custodian: false,
      is_test_data: false,
      consent_status: 'pending',
      verified_at: null,
      verified_by_user_id: null,
      revoked_at: null,
      revoked_reason: null,
      invited_by_guardianship_id: null,
      created_at: new Date(),
    }),
    decorate: (row) => ({
      ...row,
      consent_evidences: evidencesOf(row),
      dependent: userView(row.dependent_user_id),
      guardian: row.guardian_user_id ? userView(row.guardian_user_id) : null,
      relationship_type: row.relationship_type_id
        ? { relationship_type_id: row.relationship_type_id, name: 'Madre' }
        : null,
      custodian_club: row.custodian_club_id
        ? { club_id: row.custodian_club_id, name: 'Club Orion' }
        : null,
    }),
  });
  const assignments = createTable({
    idField: 'assignment_id',
    defaults: () => ({
      active: true,
      status: 'pending',
      created_at: new Date(),
    }),
    decorate: (row) => ({
      ...row,
      club_sections: {
        club_section_id: row.club_section_id,
        main_club_id: CLUB_ID,
        club_type_id: 1,
        clubs: { name: 'Club Orion' },
        club_types: { name: 'Conquistadores' },
      },
      roles: {
        role_name: row.role_id === 'role-member' ? 'member' : 'director',
      },
    }),
  });
  const linkCodes = createTable({
    idField: 'link_code_id',
    defaults: () => ({
      consumed_at: null,
      revoked_at: null,
      consumed_by_user_id: null,
    }),
  });
  const audits = createTable({ idField: 'audit_id' });
  const legal = createTable({ idField: 'acceptance_id' });
  const evidences: Row[] = [];

  function evidencesOf(grant: Row): Row[] {
    return evidences
      .filter(
        (e) =>
          e.guardianship_id === grant.guardianship_id &&
          e.superseded_at === null &&
          e.purged_at === null,
      )
      .sort((a, b) => b.uploaded_at.getTime() - a.uploaded_at.getTime())
      .slice(0, 1);
  }

  /** A user row as nested relations see it (never recursing into guardianships). */
  function userView(userId: string): Row | null {
    const base = users.rows.find((u) => u.user_id === userId);
    if (!base) return null;
    return {
      ...base,
      dependent_profile:
        profiles.rows.find((p) => p.user_id === userId) ?? null,
      supervised_login: logins.rows.find((l) => l.user_id === userId) ?? null,
      account: accounts.rows
        .filter((a) => a.userId === userId)
        .map((a) => ({ id: a.id })),
      users_pr: { complete: false },
      guardianships_as_dependent: [],
      dependent: undefined,
    };
  }

  // ---- helpers -------------------------------------------------------------
  const bearer = (userId: string) => ({
    Authorization: `Bearer ${createBearerToken(jwtService, userId)}`,
  });
  const errorCode = (body: any): string | undefined =>
    body?.error?.code ?? body?.code ?? body?.message?.code;
  const api = (path: string) => `/api/v1${path}`;

  const adultBirthday = new Date('1985-01-15T00:00:00.000Z');
  const yearsAgo = (years: number): Date => {
    const date = new Date();
    date.setUTCFullYear(date.getUTCFullYear() - years);
    date.setUTCMonth(0, 1);
    date.setUTCHours(0, 0, 0, 0);
    return date;
  };
  const isoDay = (date: Date) => date.toISOString().slice(0, 10);

  const seedAdult = (userId: string) =>
    users.model.create({
      data: {
        user_id: userId,
        name: 'Adulto',
        paternal_last_name: userId.slice(-2),
        birthday: adultBirthday,
      },
    });

  const clearWorld = () => {
    for (const table of [
      users,
      profiles,
      usersPr,
      accounts,
      logins,
      sessions,
      devices,
      guardianships,
      assignments,
      linkCodes,
      audits,
      legal,
    ]) {
      table.rows.length = 0;
    }
    evidences.length = 0;
  };

  const validBody = (over: Record<string, unknown> = {}) => ({
    name: 'Luis',
    paternal_last_name: 'Pérez',
    maternal_last_name: 'López',
    birthday: isoDay(yearsAgo(10)),
    gender: 'M',
    sworn_declaration: true,
    accepted_terms_version: CURRENT_LEGAL_DOCUMENTS.terms.version,
    accepted_privacy_version: CURRENT_LEGAL_DOCUMENTS.privacy.version,
    ...over,
  });

  beforeAll(async () => {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET || 'test-secret';

    jwtService = createTestJwtService();
    throttlerSpy = jest
      .spyOn(UserAwareThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(true);
    sendToUser = jest
      .spyOn(NotificationsService.prototype, 'sendToUser')
      .mockResolvedValue({ success: true });
    jest
      .spyOn(NotificationsService.prototype, 'sendSilentToSection')
      .mockResolvedValue(undefined);
    onConsentVerified = jest
      .spyOn(GuardianNotificationsService.prototype, 'onConsentVerified')
      .mockResolvedValue(undefined);

    const prismaDouble = createPrismaDouble({
      users: users.model,
      dependent_profiles: profiles.model,
      users_pr: usersPr.model,
      account: accounts.model,
      supervised_logins: logins.model,
      session: sessions.model,
      linked_devices: devices.model,
      guardianships: guardianships.model,
      club_role_assignments: assignments.model,
      guardianship_link_codes: linkCodes.model,
      audit_logs: audits.model,
      legal_acceptances: legal.model,
      club_sections: createModelMock({
        findUnique: jest.fn(async (args: any) =>
          args?.where?.club_section_id === SECTION_ID
            ? {
                club_section_id: SECTION_ID,
                main_club_id: CLUB_ID,
                club_type_id: 1,
                clubs: { local_fields: { unions: { country_id: 1 } } },
              }
            : null,
        ),
      }),
      ecclesiastical_years: createModelMock({
        findFirst: jest.fn().mockResolvedValue({
          year_id: 5,
          start_date: new Date('2026-01-01T00:00:00.000Z'),
        }),
      }),
      roles: createModelMock({
        findFirst: jest.fn(async (args: any) => ({
          role_id: `role-${args?.where?.role_name}`,
          role_name: args?.where?.role_name,
        })),
      }),
      countries: createModelMock({
        findUnique: jest.fn().mockResolvedValue({
          minor_self_login_min_age: 13,
          age_of_majority: 18,
          age_reference_timezone: 'America/Mexico_City',
        }),
      }),
      relationship_types: createModelMock({
        findFirst: jest.fn().mockResolvedValue({
          relationship_type_id: RELATIONSHIP_ID,
          name: 'Madre',
        }),
      }),
      enrollments: createModelMock({
        findMany: jest.fn().mockResolvedValue([]),
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
      // Territory is NOT what these journeys test: the active club assignment
      // (section 3) is what lets a reviewer through the guard.
      canManageClub: jest.fn().mockResolvedValue(false),
      canAccessHierarchyScope: jest.fn().mockReturnValue(false),
      isSuperAdmin: jest.fn(async (userId: string) => userId === ADMIN),
      hasAnyGlobalRole: jest.fn(async (userId: string) =>
        [ADMIN, ADMIN_READ_ONLY].includes(userId),
      ),
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

    config = moduleFixture.get(ConfigService);
    actingCache = moduleFixture.get(ActingForCache, { strict: false });

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
    sendToUser.mockRestore();
    onConsentVerified.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // A. Director registers a minor
  // ---------------------------------------------------------------------------

  describe('A. a director registers a minor under club custody', () => {
    let minorId: string;
    let assignmentId: string;
    let custodyId: string;

    beforeAll(async () => {
      clearWorld();
      for (const id of [
        DIRECTOR_1,
        DIRECTOR_2,
        SECRETARY,
        MEMBER,
        PARENT,
        OTHER_ADULT,
      ]) {
        await seedAdult(id);
      }
      // The people who review requests in the section (reviewer notice).
      for (const id of [DIRECTOR_1, SECRETARY]) {
        await assignments.model.create({
          data: {
            user_id: id,
            role_id: id === SECRETARY ? 'role-secretary' : 'role-director',
            club_section_id: SECTION_ID,
            status: 'active',
          },
        });
      }
    });

    it('is a 404 while FAMILY_DIRECTOR_CREATE_MINOR_ENABLED is off (nothing created)', async () => {
      config.set('FAMILY_DIRECTOR_CREATE_MINOR_ENABLED', false);
      try {
        const response = await request(app.getHttpServer())
          .post(api(`/club-sections/${SECTION_ID}/dependents`))
          .set(bearer(DIRECTOR_1))
          .send(validBody());

        expect(response.status).toBe(404);
        expect(errorCode(response.body)).toBe('FAMILY_FEATURE_DISABLED');
        expect(profiles.rows).toHaveLength(0);
      } finally {
        config.set('FAMILY_DIRECTOR_CREATE_MINOR_ENABLED', true);
      }
    });

    it('a member without dependents:create is 403 and nothing is created', async () => {
      const response = await request(app.getHttpServer())
        .post(api(`/club-sections/${SECTION_ID}/dependents`))
        .set(bearer(MEMBER))
        .send(validBody());

      expect(response.status).toBe(403);
      expect(profiles.rows).toHaveLength(0);
    });

    it.each([
      ['an email', { email: 'luis@example.org' }],
      ['an account / access mode', { access_mode: 'supervised_login' }],
      ['sworn_declaration false', { sworn_declaration: false }],
    ])('a body with %s is 400 and nothing is created', async (_label, over) => {
      const response = await request(app.getHttpServer())
        .post(api(`/club-sections/${SECTION_ID}/dependents`))
        .set(bearer(DIRECTOR_1))
        .send(validBody(over));

      expect(response.status).toBe(400);
      expect(profiles.rows).toHaveLength(0);
    });

    it('stale legal versions are 400 LEGAL_VERSION_MISMATCH and an 18-year-old is 422 (nothing created)', async () => {
      const stale = await request(app.getHttpServer())
        .post(api(`/club-sections/${SECTION_ID}/dependents`))
        .set(bearer(DIRECTOR_1))
        .send(validBody({ accepted_terms_version: '1.0.0-old' }));
      expect(stale.status).toBe(400);
      expect(errorCode(stale.body)).toBe('LEGAL_VERSION_MISMATCH');

      const adult = await request(app.getHttpServer())
        .post(api(`/club-sections/${SECTION_ID}/dependents`))
        .set(bearer(DIRECTOR_1))
        .send(validBody({ birthday: isoDay(yearsAgo(18)) }));
      expect(adult.status).toBe(422);
      expect(errorCode(adult.body)).toBe(
        'GUARDIANSHIP_DEPENDENT_AGE_OUT_OF_RANGE',
      );

      expect(profiles.rows).toHaveLength(0);
      expect(users.rows.some((u) => u.name === 'Luis')).toBe(false);
    });

    it('the director registers a 10-year-old: user, profile, CUSTODY guardianship and a PENDING request, all in one go', async () => {
      const response = await request(app.getHttpServer())
        .post(api(`/club-sections/${SECTION_ID}/dependents`))
        .set(bearer(DIRECTOR_1))
        .send(validBody());

      expect(response.status).toBe(201);
      const data = response.body.data;
      minorId = data.dependent.user_id;
      assignmentId = data.assignment.assignment_id;
      custodyId = data.guardianship.guardianship_id;
      expect(data).toMatchObject({
        dependent: { name: 'Luis', age: 10 },
        guardianship: { is_custodian: true, consent_status: 'pending' },
        assignment: { status: 'pending', club_section_id: SECTION_ID },
      });

      // The rows really exist (not just the response).
      const user = users.find({ user_id: minorId })!;
      expect(user).toMatchObject({ email: null, name: 'Luis', country_id: 1 });
      expect(accounts.rows.filter((a) => a.userId === minorId)).toHaveLength(0);
      expect(profiles.find({ user_id: minorId })).toMatchObject({
        created_by_user_id: DIRECTOR_1,
      });
      expect(guardianships.find({ guardianship_id: custodyId })).toMatchObject({
        dependent_user_id: minorId,
        guardian_user_id: null,
        is_custodian: true,
        custodian_club_id: CLUB_ID,
        is_primary: true,
        consent_status: 'pending',
      });
      expect(assignments.find({ assignment_id: assignmentId })).toMatchObject({
        user_id: minorId,
        club_section_id: SECTION_ID,
        status: 'pending',
        active: true,
      });
      // Terms and privacy accepted FOR the minor, BY the director.
      const acceptances = legal.rows.filter((row) => row.user_id === minorId);
      expect(acceptances.map((row) => row.document_type).sort()).toEqual([
        'privacy',
        'terms',
      ]);
      expect(
        acceptances.every((row) => row.accepted_by_user_id === DIRECTOR_1),
      ).toBe(true);
      expect(
        audits.rows.find((row) => row.action === 'created_by_director'),
      ).toMatchObject({ actor_user_id: DIRECTOR_1, target_user_id: minorId });
    });

    it('the reviewers are told "Minor · consent pending", the creator and the minor are not', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const recipients = sendToUser.mock.calls
        .filter(([, , source]) => source === 'membership_requests:new_request')
        .map(([dto]) => dto.userId);

      expect(recipients).toEqual([SECRETARY]);
      expect(recipients).not.toContain(DIRECTOR_1);
      expect(recipients).not.toContain(minorId);
    });

    it('the minor is NOT a member yet: approving before any verification is 409 MR_CONSENT_NOT_VERIFIED', async () => {
      const response = await request(app.getHttpServer())
        .post(
          api(
            `/club-sections/${SECTION_ID}/membership-requests/${assignmentId}/approve`,
          ),
        )
        .set(bearer(DIRECTOR_1))
        .send({});

      expect(response.status).toBe(409);
      expect(errorCode(response.body)).toBe('MR_CONSENT_NOT_VERIFIED');
      expect(assignments.find({ assignment_id: assignmentId })!.status).toBe(
        'pending',
      );
    });

    const listRequests = (userId: string) =>
      request(app.getHttpServer())
        .get(api(`/club-sections/${SECTION_ID}/membership-requests`))
        .set(bearer(userId));
    const consentOf = (body: {
      data: Array<{ assignment_id: string; consent: Record<string, unknown> }>;
    }) =>
      body.data.find((item) => item.assignment_id === assignmentId)!.consent;

    it('before any form exists the list says nothing can be verified yet: false / null for the creator too', async () => {
      const response = await listRequests(DIRECTOR_1);

      expect(response.status).toBe(200);
      expect(consentOf(response.body)).toMatchObject({
        evidence_uploaded: false,
        viewer_can_verify: false,
        viewer_verify_block: null,
      });
    });

    describe('the paper form is uploaded by the creator (state flip: R2 is not configured here)', () => {
      beforeAll(() => {
        evidences.push({
          evidence_id: 'evidence-1',
          guardianship_id: custodyId,
          uploaded_by_user_id: DIRECTOR_1,
          uploaded_at: new Date(),
          superseded_at: null,
          purged_at: null,
        });
      });

      const verify = (userId: string, body: Record<string, unknown>) =>
        request(app.getHttpServer())
          .post(
            api(
              `/club-sections/${SECTION_ID}/membership-requests/${assignmentId}/verify-consent`,
            ),
          )
          .set(bearer(userId))
          .send(body);

      it('the CREATOR cannot verify (403 GUARDIANSHIP_CUSTODIAN_SELF_VERIFY) and nothing is written', async () => {
        const response = await verify(DIRECTOR_1, {
          confirm_paper_form_reviewed: true,
        });

        expect(response.status).toBe(403);
        expect(errorCode(response.body)).toBe(
          'GUARDIANSHIP_CUSTODIAN_SELF_VERIFY',
        );
        expect(
          guardianships.find({ guardianship_id: custodyId })!.consent_status,
        ).toBe('pending');
        expect(
          audits.rows.some((row) => row.action === 'consent_verified'),
        ).toBe(false);
      });

      it('the list tells the CREATOR he may not verify (false / self_custodian) and an independent director may (true / null), without any user id', async () => {
        const creator = await listRequests(DIRECTOR_1);
        const independent = await listRequests(DIRECTOR_2);

        expect(creator.status).toBe(200);
        expect(consentOf(creator.body)).toMatchObject({
          evidence_uploaded: true,
          viewer_can_verify: false,
          viewer_verify_block: 'self_custodian',
        });
        expect(independent.status).toBe(200);
        expect(consentOf(independent.body)).toMatchObject({
          viewer_can_verify: true,
          viewer_verify_block: null,
        });
        for (const body of [creator.body, independent.body]) {
          const json = JSON.stringify(consentOf(body));
          expect(json).not.toContain(DIRECTOR_1);
          expect(json).not.toContain(minorId);
        }
      });

      it('the creator cannot get around it by asking to approve in the same call', async () => {
        const response = await verify(DIRECTOR_1, {
          confirm_paper_form_reviewed: true,
          approve: true,
        });

        expect(response.status).toBe(403);
        expect(assignments.find({ assignment_id: assignmentId })!.status).toBe(
          'pending',
        );
      });

      it('a verify-only reviewer (consent:verify without club_members:approve) cannot ask to approve: 403 MR_APPROVE_PERMISSION_REQUIRED, nothing written', async () => {
        const response = await verify(SECRETARY, {
          confirm_paper_form_reviewed: true,
          approve: true,
        });

        expect(response.status).toBe(403);
        expect(errorCode(response.body)).toBe('MR_APPROVE_PERMISSION_REQUIRED');
        expect(
          guardianships.find({ guardianship_id: custodyId })!.consent_status,
        ).toBe('pending');
      });

      it('a reviewer who is not in the section / has no permission is 403', async () => {
        const response = await verify(MEMBER, {
          confirm_paper_form_reviewed: true,
        });

        expect(response.status).toBe(403);
      });

      it('the verify-only reviewer (another person) verifies: consent verified, audit with HER as the actor, request still pending', async () => {
        const response = await verify(SECRETARY, {
          confirm_paper_form_reviewed: true,
        });

        expect(response.status).toBe(200);
        expect(response.body.data.guardianship).toMatchObject({
          guardianship_id: custodyId,
          consent_status: 'verified',
          verified_by_user_id: SECRETARY,
          verification_method: 'director_paper_form',
        });
        expect(response.body.data.assignment).toBeNull();
        expect(
          guardianships.find({ guardianship_id: custodyId }),
        ).toMatchObject({
          consent_status: 'verified',
          verified_by_user_id: SECRETARY,
        });
        expect(
          audits.rows.find((row) => row.action === 'consent_verified'),
        ).toMatchObject({ actor_user_id: SECRETARY, target_user_id: minorId });
        expect(assignments.find({ assignment_id: assignmentId })!.status).toBe(
          'pending',
        );
        expect(onConsentVerified).toHaveBeenCalledWith({
          dependentUserId: minorId,
          verifierUserId: SECRETARY,
        });
      });

      it('once verified the list says false / null for everyone (nothing left to verify)', async () => {
        const response = await listRequests(DIRECTOR_2);

        expect(consentOf(response.body)).toMatchObject({
          status: 'verified',
          viewer_can_verify: false,
          viewer_verify_block: null,
        });
      });

      it('the verify-only reviewer still cannot approve the request (403, still pending)', async () => {
        const response = await request(app.getHttpServer())
          .post(
            api(
              `/club-sections/${SECTION_ID}/membership-requests/${assignmentId}/approve`,
            ),
          )
          .set(bearer(SECRETARY))
          .send({});

        expect(response.status).toBe(403);
        expect(assignments.find({ assignment_id: assignmentId })!.status).toBe(
          'pending',
        );
      });

      it('the director approves: the minor is now an ACTIVE member', async () => {
        const response = await request(app.getHttpServer())
          .post(
            api(
              `/club-sections/${SECTION_ID}/membership-requests/${assignmentId}/approve`,
            ),
          )
          .set(bearer(DIRECTOR_1))
          .send({});

        expect(response.status).toBe(200);
        expect(assignments.find({ assignment_id: assignmentId })).toMatchObject(
          {
            status: 'active',
            expires_at: null,
          },
        );
      });
    });

    describe('the family claims the minor (director_claim code, 7 days)', () => {
      let code: string;
      let parentGuardianshipId: string;

      it('the director issues the claim code of a CUSTODIAL minor of the section', async () => {
        const response = await request(app.getHttpServer())
          .post(
            api(
              `/club-sections/${SECTION_ID}/dependents/${minorId}/claim-codes`,
            ),
          )
          .set(bearer(DIRECTOR_1))
          .send({});

        expect(response.status).toBe(201);
        expect(response.body.data.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
        code = response.body.data.code;
        expect(linkCodes.rows).toHaveLength(1);
        expect(linkCodes.rows[0]).toMatchObject({
          purpose: 'director_claim',
          dependent_user_id: minorId,
          issued_by_user_id: DIRECTOR_1,
          issued_for_club_section_id: SECTION_ID,
        });
        // Only the HASH is stored.
        expect(JSON.stringify(linkCodes.rows)).not.toContain(
          code.replace('-', ''),
        );
      });

      it('the parent redeems it: custody is revoked as "claimed", the parent is primary and PENDING (verification is not inherited)', async () => {
        const response = await request(app.getHttpServer())
          .post(api('/guardianships/link-codes/redeem'))
          .set(bearer(PARENT))
          .send({
            code,
            relationship_type_id: RELATIONSHIP_ID,
            sworn_declaration: true,
          });

        expect(response.status).toBe(201);
        const custody = guardianships.find({ guardianship_id: custodyId })!;
        expect(custody).toMatchObject({
          consent_status: 'revoked',
          revoked_reason: 'claimed',
        });
        const parentRow = guardianships.find({
          dependent_user_id: minorId,
          guardian_user_id: PARENT,
        })!;
        parentGuardianshipId = parentRow.guardianship_id;
        expect(parentRow).toMatchObject({
          is_primary: true,
          is_custodian: false,
          consent_status: 'pending',
          verified_at: null,
        });
        expect(linkCodes.rows[0].consumed_by_user_id).toBe(PARENT);
      });

      it('the code is single use: another adult gets the uniform invalid code', async () => {
        const response = await request(app.getHttpServer())
          .post(api('/guardianships/link-codes/redeem'))
          .set(bearer(OTHER_ADULT))
          .send({
            code,
            relationship_type_id: RELATIONSHIP_ID,
            sworn_declaration: true,
          });

        expect(response.status).toBe(400);
        expect(errorCode(response.body)).toBe('GUARDIANSHIP_LINK_CODE_INVALID');
        expect(
          guardianships.filter({
            dependent_user_id: minorId,
            guardian_user_id: OTHER_ADULT,
          }),
        ).toHaveLength(0);
      });

      it('the parent uploads a NEW form and the ORIGINAL CREATOR may verify it (the creator rule is for custody rows only)', async () => {
        evidences.push({
          evidence_id: 'evidence-2',
          guardianship_id: parentGuardianshipId,
          uploaded_by_user_id: PARENT,
          uploaded_at: new Date(),
          superseded_at: null,
          purged_at: null,
        });

        const response = await request(app.getHttpServer())
          .post(
            api(
              `/club-sections/${SECTION_ID}/membership-requests/${assignmentId}/verify-consent`,
            ),
          )
          .set(bearer(DIRECTOR_1))
          .send({ confirm_paper_form_reviewed: true });

        expect(response.status).toBe(200);
        expect(response.body.data.guardianship).toMatchObject({
          guardianship_id: parentGuardianshipId,
          consent_status: 'verified',
          verified_by_user_id: DIRECTOR_1,
        });
        // The membership was already approved: this only verified.
        expect(assignments.find({ assignment_id: assignmentId })!.status).toBe(
          'active',
        );
      });
    });
  });

  // ---------------------------------------------------------------------------
  // B. Admin disables a login and revokes a device
  // ---------------------------------------------------------------------------

  describe("B. an admin cuts a minor's access", () => {
    let tokenBeforeDisable: string;

    const deviceToken = () =>
      jwtService.sign(
        {
          sub: CHILD,
          sid: DEVICE_SESSION,
          dev: DEVICE_ID,
          iss: 'https://api.sacdia.app',
          aud: 'sacdia:device',
        },
        { expiresIn: '1h' },
      );
    const asDevice = () => ({ Authorization: `Bearer ${deviceToken()}` });
    /** A cheap member route: a device is allowed or scope-denied, never 401, while active. */
    const statusPath = (userId: string) =>
      api(`/users/${userId}/post-registration/status`);

    beforeAll(async () => {
      clearWorld();
      for (const id of [GUARDIAN, ADMIN, ADMIN_READ_ONLY]) await seedAdult(id);

      // A 14-year-old with a guardian-enabled handle login, verified guardian.
      users.model.create({
        data: {
          user_id: TEEN,
          name: 'Ana',
          paternal_last_name: 'Gómez',
          birthday: yearsAgo(14),
        },
      });
      accounts.model.create({
        data: { id: 'acc-teen', userId: TEEN, providerId: 'credential' },
      });
      profiles.model.create({
        data: { user_id: TEEN, created_by_user_id: GUARDIAN },
      });
      usersPr.model.create({
        data: {
          user_id: TEEN,
          complete: false,
          profile_picture_complete: false,
          personal_info_complete: false,
          club_selection_complete: false,
          date_completed: null,
        },
      });
      logins.model.create({
        data: {
          user_id: TEEN,
          method: 'handle',
          login_handle: HANDLE,
          origin: 'guardian_enabled',
          enabled_by_user_id: GUARDIAN,
          enabled_at: new Date('2026-10-10T10:00:00.000Z'),
          disabled_at: null,
          disabled_reason: null,
          password_set_by: 'guardian',
          pending_since: null,
        },
      });
      sessions.model.create({
        data: {
          id: 'session-teen',
          userId: TEEN,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      guardianships.model.create({
        data: {
          dependent_user_id: TEEN,
          guardian_user_id: GUARDIAN,
          is_primary: true,
          consent_status: 'verified',
        },
      });

      // A 9-year-old with a paired phone (no account).
      for (const id of [CHILD, OTHER_CHILD]) {
        users.model.create({
          data: {
            user_id: id,
            name: id === CHILD ? 'Mateo' : 'Sofía',
            paternal_last_name: 'Ruiz',
            birthday: yearsAgo(9),
          },
        });
        profiles.model.create({
          data: { user_id: id, created_by_user_id: GUARDIAN },
        });
      }
      const childGuardianship = await guardianships.model.create({
        data: {
          dependent_user_id: CHILD,
          guardian_user_id: GUARDIAN,
          is_primary: true,
          consent_status: 'verified',
        },
      });
      sessions.model.create({
        data: {
          id: DEVICE_SESSION,
          userId: CHILD,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      devices.model.create({
        data: {
          linked_device_id: DEVICE_ID,
          dependent_user_id: CHILD,
          guardianship_id: childGuardianship.guardianship_id,
          paired_by_user_id: GUARDIAN,
          session_id: DEVICE_SESSION,
          label: 'Tablet de Mateo',
          platform: 'android',
          app_version: '2.4.0',
          paired_at: new Date('2026-10-01T10:00:00.000Z'),
          absolute_expires_at: new Date(Date.now() + 100 * 86_400_000),
          last_seen_at: null,
          revoked_at: null,
          revoked_by_user_id: null,
          revoked_reason: null,
          fcm_token_id: null,
        },
      });
      // A device of ANOTHER family.
      devices.model.create({
        data: {
          linked_device_id: OTHER_DEVICE_ID,
          dependent_user_id: OTHER_CHILD,
          guardianship_id: childGuardianship.guardianship_id,
          paired_by_user_id: GUARDIAN,
          session_id: 'other-session',
          label: 'Tablet de Sofía',
          platform: 'ios',
          app_version: null,
          paired_at: new Date('2026-10-01T10:00:00.000Z'),
          absolute_expires_at: new Date(Date.now() + 100 * 86_400_000),
          revoked_at: null,
          revoked_reason: null,
        },
      });

      await actingCache.bump(TEEN);
      await actingCache.bump(CHILD);
      sendToUser.mockClear();
    });

    describe('the user detail (family_access block)', () => {
      it('an admin with the sensitive read permission sees the login (with the handle) and the paired phones', async () => {
        const response = await request(app.getHttpServer())
          .get(api(`/admin/users/${TEEN}`))
          .set(bearer(ADMIN));

        expect(response.status).toBe(200);
        expect(response.body.data.family_access).toMatchObject({
          supervision: 'active',
          supervised_login: {
            status: 'active',
            method: 'handle',
            login_handle: HANDLE,
            origin: 'guardian_enabled',
            disabled_at: null,
            password_set_by: 'guardian',
          },
          linked_devices: [],
        });
      });

      it('a child with a paired phone lists it, with who paired it and when it expires', async () => {
        const response = await request(app.getHttpServer())
          .get(api(`/admin/users/${CHILD}`))
          .set(bearer(ADMIN));

        expect(response.status).toBe(200);
        expect(response.body.data.family_access.supervised_login).toBeNull();
        expect(response.body.data.family_access.linked_devices).toEqual([
          expect.objectContaining({
            linked_device_id: DEVICE_ID,
            label: 'Tablet de Mateo',
            platform: 'android',
            status: 'active',
            paired_by: expect.objectContaining({ user_id: GUARDIAN }),
            revoked_at: null,
          }),
        ]);
      });
    });

    describe('the supervised login', () => {
      const disablePath = (userId = TEEN) =>
        api(`/admin/users/${userId}/supervised-login/disable`);

      it('while the login is on, the teen token works', async () => {
        tokenBeforeDisable = jwtService.sign({
          sub: TEEN,
          email: `${TEEN}@test.local`,
          ...accessJwtClaims(),
          iat: Math.floor(Date.now() / 1000) - 60,
        });
        const response = await request(app.getHttpServer())
          .get(statusPath(TEEN))
          .set({ Authorization: `Bearer ${tokenBeforeDisable}` });

        expect(response.status).toBe(200);
      });

      it.each([
        ['no body', {}],
        ['a 4-character reason', { reason: 'abcd' }],
        ['a reason of spaces', { reason: '      ' }],
        [
          'a password (nothing but the reason is accepted)',
          { reason: 'motivo valido', password: 'Str0ng@Pass1!x' },
        ],
      ])('%s is 400 and the login stays enabled', async (_label, body) => {
        const response = await request(app.getHttpServer())
          .post(disablePath())
          .set(bearer(ADMIN))
          .send(body);

        expect(response.status).toBe(400);
        expect(logins.find({ user_id: TEEN })!.disabled_at).toBeNull();
      });

      it('a guardian (not an admin) and an admin without the write permission are 403', async () => {
        for (const userId of [GUARDIAN, ADMIN_READ_ONLY]) {
          const response = await request(app.getHttpServer())
            .post(disablePath())
            .set(bearer(userId))
            .send({ reason: 'motivo valido' });
          expect({ userId, status: response.status }).toEqual({
            userId,
            status: 403,
          });
        }
        expect(logins.find({ user_id: TEEN })!.disabled_at).toBeNull();
      });

      it('there is NO admin route to enable, reactivate or reset the password of the login', async () => {
        for (const action of ['enable', 'reactivate', 'password', 'reset']) {
          const response = await request(app.getHttpServer())
            .post(api(`/admin/users/${TEEN}/supervised-login/${action}`))
            .set(bearer(ADMIN))
            .send({ reason: 'motivo valido', password: 'Str0ng@Pass1!x' });
          expect({ action, status: response.status }).toEqual({
            action,
            status: 404,
          });
        }
        const bare = await request(app.getHttpServer())
          .post(api(`/admin/users/${TEEN}/supervised-login`))
          .set(bearer(ADMIN))
          .send({ method: 'handle', password: 'Str0ng@Pass1!x' });
        expect(bare.status).toBe(404);
        expect(logins.find({ user_id: TEEN })!.disabled_at).toBeNull();
      });

      it('with a reason the login is disabled: reason admin, sessions deleted, and the answer never carries the handle', async () => {
        const response = await request(app.getHttpServer())
          .post(disablePath())
          .set(bearer(ADMIN))
          .send({ reason: 'Solicitud escrita del tutor legal' });

        expect(response.status).toBe(200);
        expect(response.body.data.supervised_login).toMatchObject({
          status: 'disabled',
          method: 'handle',
          origin: 'guardian_enabled',
          disabled_reason: 'admin',
          password_set_by: 'guardian',
        });
        expect(JSON.stringify(response.body)).not.toContain(HANDLE);
        expect(logins.find({ user_id: TEEN })).toMatchObject({
          disabled_reason: 'admin',
          disabled_by_user_id: ADMIN,
        });
        expect(sessions.filter({ userId: TEEN })).toHaveLength(0);
      });

      it("the teen's very next request is 401 AUTH_SUPERVISED_ACCESS_REVOKED, also for a token minted before", async () => {
        for (const headers of [
          bearer(TEEN),
          { Authorization: `Bearer ${tokenBeforeDisable}` },
        ]) {
          const response = await request(app.getHttpServer())
            .get(statusPath(TEEN))
            .set(headers);
          expect(response.status).toBe(401);
          expect(errorCode(response.body)).toBe(
            'AUTH_SUPERVISED_ACCESS_REVOKED',
          );
        }
      });

      it('every verified guardian is told (security notice, mandatory source) and the notice carries no handle or password', async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const notices = sendToUser.mock.calls.filter(
          ([, , source]) => source === 'family:security',
        );

        expect(notices.map(([dto]) => dto.userId)).toEqual([GUARDIAN]);
        const [dto] = notices[0];
        expect(dto.data).toMatchObject({
          type: 'dependent_security',
          event: 'teen_login_disabled',
          dependent_user_id: TEEN,
        });
        expect(JSON.stringify(dto)).not.toContain(HANDLE);
        expect(JSON.stringify(dto)).not.toContain('Str0ng');
      });

      it('the audit row has the admin as actor and the typed reason, and never a password or the handle', () => {
        const audit = audits.rows.find(
          (row) => row.action === 'admin.supervised_login.disabled',
        )!;

        expect(audit).toMatchObject({
          actor_user_id: ADMIN,
          target_user_id: TEEN,
          entity_id: TEEN,
        });
        expect(audit.changes).toEqual({
          reason: 'Solicitud escrita del tutor legal',
          sessions_revoked: 1,
        });
        expect(JSON.stringify(audits.rows)).not.toContain(HANDLE);
        expect(JSON.stringify(audits.rows)).not.toContain('Str0ng');
      });

      it('disabling again is idempotent: 200, one audit row, no new notice', async () => {
        sendToUser.mockClear();
        const response = await request(app.getHttpServer())
          .post(disablePath())
          .set(bearer(ADMIN))
          .send({ reason: 'otro intento' });

        expect(response.status).toBe(200);
        expect(
          audits.rows.filter(
            (row) => row.action === 'admin.supervised_login.disabled',
          ),
        ).toHaveLength(1);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(sendToUser).not.toHaveBeenCalled();
      });

      it('a user without a supervised login is 404 SUPERVISED_LOGIN_NOT_FOUND', async () => {
        const response = await request(app.getHttpServer())
          .post(disablePath(CHILD))
          .set(bearer(ADMIN))
          .send({ reason: 'motivo valido' });

        expect(response.status).toBe(404);
        expect(errorCode(response.body)).toBe('SUPERVISED_LOGIN_NOT_FOUND');
      });
    });

    describe('the linked device', () => {
      const revokePath = (deviceId = DEVICE_ID, userId = CHILD) =>
        api(`/admin/users/${userId}/linked-devices/${deviceId}/revoke`);

      it('while the device is active its token is accepted (never a 401)', async () => {
        const response = await request(app.getHttpServer())
          .get(statusPath(CHILD))
          .set(asDevice());

        expect(response.status).not.toBe(401);
        expect(response.status).toBeLessThan(500);
      });

      it.each([
        ['no body', {}],
        ['a 4-character reason', { reason: 'abcd' }],
      ])('%s is 400 and the device stays linked', async (_label, body) => {
        const response = await request(app.getHttpServer())
          .post(revokePath())
          .set(bearer(ADMIN))
          .send(body);

        expect(response.status).toBe(400);
        expect(
          devices.find({ linked_device_id: DEVICE_ID })!.revoked_at,
        ).toBeNull();
      });

      it('an admin without the write permission is 403', async () => {
        const response = await request(app.getHttpServer())
          .post(revokePath())
          .set(bearer(ADMIN_READ_ONLY))
          .send({ reason: 'motivo valido' });

        expect(response.status).toBe(403);
        expect(
          devices.find({ linked_device_id: DEVICE_ID })!.revoked_at,
        ).toBeNull();
      });

      it('a device of ANOTHER family under this user is 404 DEVICE_NOT_FOUND and stays linked', async () => {
        const response = await request(app.getHttpServer())
          .post(revokePath(OTHER_DEVICE_ID, CHILD))
          .set(bearer(ADMIN))
          .send({ reason: 'motivo valido' });

        expect(response.status).toBe(404);
        expect(errorCode(response.body)).toBe('DEVICE_NOT_FOUND');
        expect(
          devices.find({ linked_device_id: OTHER_DEVICE_ID })!.revoked_at,
        ).toBeNull();
      });

      it('with a reason the device is revoked (reason admin), its session deleted', async () => {
        sendToUser.mockClear();
        const response = await request(app.getHttpServer())
          .post(revokePath())
          .set(bearer(ADMIN))
          .send({ reason: 'Teléfono extraviado' });

        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({
          linked_device_id: DEVICE_ID,
          revoked_reason: 'admin',
        });
        expect(response.body.data.revoked_at).toEqual(expect.any(String));
        expect(devices.find({ linked_device_id: DEVICE_ID })).toMatchObject({
          revoked_reason: 'admin',
          revoked_by_user_id: ADMIN,
        });
        expect(sessions.filter({ id: DEVICE_SESSION })).toHaveLength(0);
      });

      it("the device's very next request is 401 AUTH_DEVICE_REVOKED (its JWT was still valid)", async () => {
        const response = await request(app.getHttpServer())
          .get(statusPath(CHILD))
          .set(asDevice());

        expect(response.status).toBe(401);
        expect(errorCode(response.body)).toBe('AUTH_DEVICE_REVOKED');
      });

      it('the guardians are told "device unlinked" and the audit stores the typed reason', async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const notices = sendToUser.mock.calls.filter(
          ([, , source]) => source === 'family:security',
        );
        expect(notices.map(([dto]) => dto.userId)).toEqual([GUARDIAN]);
        expect(notices[0][0].data).toMatchObject({
          type: 'dependent_security',
          event: 'device_revoked',
          dependent_user_id: CHILD,
        });

        const audit = audits.rows.find(
          (row) => row.action === 'admin.linked_device.revoked',
        )!;
        expect(audit).toMatchObject({
          actor_user_id: ADMIN,
          target_user_id: CHILD,
          entity_id: DEVICE_ID,
        });
        expect(audit.changes).toMatchObject({
          reason: 'Teléfono extraviado',
          revoked_reason: 'admin',
        });
      });

      it('revoking again is idempotent: 200 and still ONE audit row', async () => {
        const response = await request(app.getHttpServer())
          .post(revokePath())
          .set(bearer(ADMIN))
          .send({ reason: 'otro intento' });

        expect(response.status).toBe(200);
        expect(response.body.data.revoked_reason).toBe('admin');
        expect(
          audits.rows.filter(
            (row) => row.action === 'admin.linked_device.revoked',
          ),
        ).toHaveLength(1);
      });
    });
  });
});

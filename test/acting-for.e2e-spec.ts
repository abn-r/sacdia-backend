// Must run before `../src/app.module` is required (see certifications e2e):
// an empty REDIS_URL keeps the suite on the in-memory cache and no BullMQ.
process.env.REDIS_URL = '';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ActingForCache } from '../src/auth/acting-for/acting-for.cache';
import { AuthorizationContextService } from '../src/common/services/authorization-context.service';
import { UserAwareThrottlerGuard } from '../src/config/user-aware-throttler.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  buildAuthorizationSnapshot,
  createBearerToken,
  createTestJwtService,
} from './helpers/rbac-test-helpers';

/**
 * Acting-for E2E (family profiles, 2a).
 *
 * The real app is booted (routing, global + local JwtAuthGuard, the real
 * JwtStrategy and ActingForResolver, PermissionsGuard, DTO validation, error
 * filter). Only PrismaService is replaced by an in-memory double, because the
 * sandbox has no database. What is proven here is the wiring:
 *   - a guardian creates a dependent,
 *   - the X-Acting-For header substitutes the principal on a scoped route,
 *   - never-scope routes and guardian endpoints are denied while acting,
 *   - a dependent that is not the guardian's gets the uniform 403,
 *   - a revocation is honored on the next request (epoch bump).
 */

const GUARDIAN_ID = '00000000-0000-4000-8000-0000000000a1';
const OTHER_GUARDIAN_ID = '00000000-0000-4000-8000-0000000000a2';
const DEPENDENT_ID = '00000000-0000-4000-8000-0000000000d1';
const FOREIGN_DEPENDENT_ID = '00000000-0000-4000-8000-0000000000d2';
/** A second dependent of the SAME guardian (cross-dependent checks). */
const SIBLING_DEPENDENT_ID = '00000000-0000-4000-8000-0000000000d3';
const RANDOM_ID = '00000000-0000-4000-8000-0000000000ff';
const RELATIONSHIP_ID = '00000000-0000-4000-8000-0000000000e1';

function isThenLike(prop: string | symbol): boolean {
  return (
    typeof prop === 'symbol' ||
    prop === 'then' ||
    prop === 'catch' ||
    prop === 'finally'
  );
}

function createModelMock(seed: Record<string, unknown> = {}): any {
  const target: Record<string, unknown> = { ...seed };
  return new Proxy(target, {
    get(_target: any, prop: string | symbol) {
      if (isThenLike(prop)) return undefined;
      if (prop in target) return target[prop as string];
      const fn = jest.fn().mockResolvedValue(null);
      target[prop as string] = fn;
      return fn;
    },
  });
}

function createPrismaDouble(seed: Record<string, unknown>): any {
  const target: Record<string, unknown> = { ...seed };
  return new Proxy(target, {
    get(_target: any, prop: string | symbol) {
      if (isThenLike(prop)) return undefined;
      if (prop in target) return target[prop as string];
      const mock =
        typeof prop === 'string' && prop.startsWith('$')
          ? jest.fn().mockResolvedValue(null)
          : createModelMock();
      target[prop as string] = mock;
      return mock;
    },
  });
}

function resolvedProfile(userId: string, authorization: unknown) {
  return {
    profile: { user_id: userId },
    post_register_complete: true,
    authorization,
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
  };
}

describe('Acting-for E2E', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let prisma: any;
  let actingCache: ActingForCache;
  let throttlerSpy: jest.SpyInstance;
  let authorizationContext: {
    resolveUserAuthorization: jest.Mock;
    canManageClub: jest.Mock;
    canAccessHierarchyScope: jest.Mock;
  };
  let defaultResolveAuthorization: (userId: string) => Promise<unknown>;

  /** Consent state of GUARDIAN_ID's guardianship over DEPENDENT_ID; null = none. */
  let grantedStatus: 'pending' | 'verified' | null;

  const bearer = (userId: string) => ({
    Authorization: `Bearer ${createBearerToken(jwtService, userId)}`,
  });
  const acting = (userId: string, dependentId: string) => ({
    ...bearer(userId),
    'X-Acting-For': dependentId,
  });

  const summaryRow = () => ({
    guardianship_id: 'gs-1',
    dependent_user_id: DEPENDENT_ID,
    is_primary: true,
    consent_status: 'pending',
    verified_at: null,
    relationship_type: { relationship_type_id: RELATIONSHIP_ID, name: 'Madre' },
    dependent: {
      // The signed form hangs on the consent (primary) row of the dependent.
      guardianships_as_dependent: [{ consent_evidences: [] }],
      user_id: DEPENDENT_ID,
      name: 'Ana',
      paternal_last_name: 'Pérez',
      maternal_last_name: null,
      birthday: new Date('2017-04-02T00:00:00.000Z'),
      user_image: null,
      country_id: null,
      users_pr: { complete: false },
      dependent_profile: { frozen_at: null },
      // 3a: a dependent without credentials is guardian-managed.
      account: [],
      supervised_login: null,
    },
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

    defaultResolveAuthorization = async (userId: string) =>
      resolvedProfile(userId, buildAuthorizationSnapshot({}));
    authorizationContext = {
      resolveUserAuthorization: jest.fn(defaultResolveAuthorization),
      canManageClub: jest.fn().mockResolvedValue(false),
      canAccessHierarchyScope: jest.fn().mockReturnValue(false),
    };

    const guardianships = createModelMock({
      // The resolver asks for (dependent, guardian); the summary reader selects
      // the dependent block; the denial diagnosis has an orderBy.
      findFirst: jest.fn(async (args: any) => {
        const where = args?.where ?? {};
        if (args?.select?.dependent?.select?.name !== undefined) {
          return where.guardian_user_id === GUARDIAN_ID ? summaryRow() : null;
        }
        if (
          where.guardian_user_id === GUARDIAN_ID &&
          (where.dependent_user_id === DEPENDENT_ID ||
            where.dependent_user_id === SIBLING_DEPENDENT_ID) &&
          grantedStatus !== null &&
          !args?.orderBy
        ) {
          return {
            guardianship_id: 'gs-1',
            consent_status: grantedStatus,
            dependent: {
              birthday: new Date('2017-04-02T00:00:00.000Z'),
              country_id: null,
            },
          };
        }
        return null;
      }),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    });

    const prismaDouble = createPrismaDouble({
      guardianships,
      users: createModelMock({
        findUnique: jest.fn().mockResolvedValue({
          birthday: new Date('1985-01-15T00:00:00.000Z'),
          country_id: null,
        }),
      }),
      users_pr: createModelMock({
        findUnique: jest.fn().mockResolvedValue({
          complete: false,
          profile_picture_complete: false,
          personal_info_complete: false,
          club_selection_complete: false,
          date_completed: null,
        }),
      }),
      clubs: createModelMock({
        findUnique: jest
          .fn()
          .mockResolvedValue({ club_id: 7, club_sections: [] }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      }),
      club_sections: createModelMock({
        findMany: jest.fn().mockResolvedValue([]),
      }),
      relationship_types: createModelMock({
        findFirst: jest.fn().mockResolvedValue({
          relationship_type_id: RELATIONSHIP_ID,
          name: 'Madre',
        }),
      }),
      roles: createModelMock({
        findFirst: jest.fn().mockResolvedValue({ role_id: 'role-user' }),
      }),
      club_role_assignments: createModelMock({
        findMany: jest.fn().mockResolvedValue([]),
      }),
      $transaction: jest.fn(async (arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
          : Promise.all(arg as Array<Promise<unknown>>),
      ),
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthorizationContextService)
      .useValue(authorizationContext)
      .overrideProvider(PrismaService)
      .useValue(prismaDouble)
      .compile();

    prisma = moduleFixture.get(PrismaService);
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
  });

  beforeEach(() => {
    grantedStatus = 'pending';
  });

  const errorCode = (body: any): string | undefined =>
    body?.error?.code ?? body?.code ?? body?.message?.code;

  it('a guardian creates a dependent (step 0)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/guardianships/me/dependents')
      .set(bearer(GUARDIAN_ID))
      .send({
        name: 'Ana',
        paternal_last_name: 'Pérez',
        birthday: '2017-04-02',
        relationship_type_id: RELATIONSHIP_ID,
        sworn_declaration: true,
        accepted_terms_version: '2.0.0-family',
        accepted_privacy_version: '2.0.0-family',
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      user_id: DEPENDENT_ID,
      access_mode: 'guardian_managed',
      guardianship: { is_primary: true, consent_status: 'pending' },
    });
    const created = prisma.users.create.mock.calls.at(-1)[0].data;
    expect(created.email).toBeNull();
    expect(prisma.dependent_profiles.create).toHaveBeenCalledWith({
      data: { user_id: created.user_id, created_by_user_id: GUARDIAN_ID },
    });
  });

  it('rejects access_mode and email in the create body', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/guardianships/me/dependents')
      .set(bearer(GUARDIAN_ID))
      .send({
        name: 'Ana',
        paternal_last_name: 'Pérez',
        birthday: '2017-04-02',
        relationship_type_id: RELATIONSHIP_ID,
        sworn_declaration: true,
        accepted_terms_version: '2.0.0-family',
        accepted_privacy_version: '2.0.0-family',
        access_mode: 'self',
        email: 'x@y.z',
      });
    expect(response.status).toBe(400);
  });

  it('with the header, GET post-registration/status returns the dependent (200)', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/users/${DEPENDENT_ID}/post-registration/status`)
      .set(acting(GUARDIAN_ID, DEPENDENT_ID));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ complete: false });
  });

  it('without the header the same request is forbidden: the guardian is not the owner', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/users/${DEPENDENT_ID}/post-registration/status`)
      .set(bearer(GUARDIAN_ID));

    expect(response.status).toBe(403);
  });

  it('with the header, GET /auth/sessions is a never-scope route: 403 ACTING_FOR_SCOPE_DENIED', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set(acting(GUARDIAN_ID, DEPENDENT_ID));

    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe('ACTING_FOR_SCOPE_DENIED');
  });

  describe('post-registration step 3 reads while acting (pending guardianship)', () => {
    beforeEach(() => {
      grantedStatus = 'pending';
    });

    it('GET /clubs?localFieldId= (club picker) is reachable', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/clubs?localFieldId=4')
        .set(acting(GUARDIAN_ID, DEPENDENT_ID));

      expect(errorCode(response.body)).not.toBe('ACTING_FOR_SCOPE_DENIED');
      expect(response.status).toBe(200);
    });

    it('GET /clubs/:clubId/sections (sections of the picked club) is reachable', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/clubs/7/sections')
        .set(acting(GUARDIAN_ID, DEPENDENT_ID));

      expect(errorCode(response.body)).not.toBe('ACTING_FOR_SCOPE_DENIED');
      expect(response.status).toBe(200);
    });

    it.each([
      '/api/v1/catalogs/countries',
      '/api/v1/catalogs/local-fields?unionId=1',
      '/api/v1/catalogs/relationship-types',
      '/api/v1/catalogs/allergies',
      '/api/v1/catalogs/diseases',
      '/api/v1/catalogs/medicines',
      '/api/v1/legal/current',
    ])('public read %s keeps working with the header', async (url) => {
      const response = await request(app.getHttpServer())
        .get(url)
        .set(acting(GUARDIAN_ID, DEPENDENT_ID));

      expect(errorCode(response.body)).not.toBe('ACTING_FOR_SCOPE_DENIED');
      expect(response.status).toBe(200);
    });

    it.each([
      '/api/v1/catalogs/unions?countryId=1',
      '/api/v1/classes?clubTypeId=1',
    ])(
      'public read %s is not blocked by the acting scope (the Prisma double has no data for it)',
      async (url) => {
        const response = await request(app.getHttpServer())
          .get(url)
          .set(acting(GUARDIAN_ID, DEPENDENT_ID));

        expect(errorCode(response.body)).not.toBe('ACTING_FOR_SCOPE_DENIED');
        expect([401, 403]).not.toContain(response.status);
      },
    );

    it.each([
      'GET /api/v1/clubs/7',
      'GET /api/v1/clubs/7/overview',
      'GET /api/v1/clubs/7/leadership',
      'GET /api/v1/clubs/7/sections/3',
      'GET /api/v1/clubs/7/sections/3/members',
    ])('every other club route stays denied: %s', async (route) => {
      const [, url] = route.split(' ');
      const response = await request(app.getHttpServer())
        .get(url)
        .set(acting(GUARDIAN_ID, DEPENDENT_ID));

      expect(response.status).toBe(403);
      expect(errorCode(response.body)).toBe('ACTING_FOR_SCOPE_DENIED');
    });

    it('without the header GET /clubs is unchanged (no scope check)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/clubs?localFieldId=4')
        .set(bearer(GUARDIAN_ID));

      expect(response.status).toBe(200);
    });
  });

  it('guardian endpoints cannot be used while acting', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/guardianships/me/dependents')
      .set(acting(GUARDIAN_ID, DEPENDENT_ID));

    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe('ACTING_FOR_SCOPE_DENIED');
  });

  describe('consent evidence (2c)', () => {
    const evidenceUrl = `/api/v1/guardianships/me/dependents/${DEPENDENT_ID}/consent-evidence`;
    const pdf = Buffer.from('%PDF-1.7 signed form');

    it('both guardian routes are denied while acting (no ActingScope)', async () => {
      const upload = await request(app.getHttpServer())
        .post(evidenceUrl)
        .set(acting(GUARDIAN_ID, DEPENDENT_ID))
        .attach('file', pdf, {
          filename: 'f.pdf',
          contentType: 'application/pdf',
        });
      const read = await request(app.getHttpServer())
        .get(evidenceUrl)
        .set(acting(GUARDIAN_ID, DEPENDENT_ID));

      for (const response of [upload, read]) {
        expect(response.status).toBe(403);
        expect(errorCode(response.body)).toBe('ACTING_FOR_SCOPE_DENIED');
      }
    });

    it('the app boots without the private bucket and the endpoints fail closed with 503', async () => {
      const upload = await request(app.getHttpServer())
        .post(evidenceUrl)
        .set(bearer(GUARDIAN_ID))
        .attach('file', pdf, {
          filename: 'f.pdf',
          contentType: 'application/pdf',
        });
      const read = await request(app.getHttpServer())
        .get(evidenceUrl)
        .set(bearer(GUARDIAN_ID));
      const unrelated = await request(app.getHttpServer())
        .get('/api/v1/guardianships/me/dependents')
        .set(bearer(GUARDIAN_ID));

      expect(upload.status).toBe(503);
      expect(errorCode(upload.body)).toBe('GUARDIANSHIP_EVIDENCE_UNAVAILABLE');
      expect(read.status).toBe(503);
      expect(errorCode(read.body)).toBe('GUARDIANSHIP_EVIDENCE_UNAVAILABLE');
      // The rest of the API keeps working.
      expect(unrelated.status).toBe(200);
    });

    it('rejects a spoofed type and a missing file before touching storage', async () => {
      const spoofed = await request(app.getHttpServer())
        .post(evidenceUrl)
        .set(bearer(GUARDIAN_ID))
        .attach('file', Buffer.from([0x4d, 0x5a, 0x90, 0x00]), {
          filename: 'f.jpg',
          contentType: 'image/jpeg',
        });
      const heic = await request(app.getHttpServer())
        .post(evidenceUrl)
        .set(bearer(GUARDIAN_ID))
        .attach('file', Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), {
          filename: 'f.heic',
          contentType: 'image/heic',
        });
      const missing = await request(app.getHttpServer())
        .post(evidenceUrl)
        .set(bearer(GUARDIAN_ID))
        .field('note', 'no file');

      expect(spoofed.status).toBe(400);
      expect(errorCode(spoofed.body)).toBe('FILE_TYPE_INVALID');
      expect(heic.status).toBe(400);
      expect(errorCode(heic.body)).toBe('FILE_TYPE_INVALID');
      expect(missing.status).toBe(400);
    });

    it('a user without club_members:approve cannot use the director routes (403)', async () => {
      const assignment = '00000000-0000-4000-8000-0000000000c1';
      const base = `/api/v1/club-sections/12/membership-requests/${assignment}`;
      const upload = await request(app.getHttpServer())
        .post(`${base}/consent-evidence`)
        .set(bearer(GUARDIAN_ID))
        .attach('file', pdf, {
          filename: 'f.pdf',
          contentType: 'application/pdf',
        });
      const read = await request(app.getHttpServer())
        .get(`${base}/consent-evidence`)
        .set(bearer(GUARDIAN_ID));
      const verify = await request(app.getHttpServer())
        .post(`${base}/verify-consent`)
        .set(bearer(GUARDIAN_ID))
        .send({ confirm_paper_form_reviewed: true, approve: true });

      for (const response of [upload, read, verify]) {
        expect(response.status).toBe(403);
      }
    });

    it('a non-admin cannot read the admin evidence route (403)', async () => {
      const response = await request(app.getHttpServer())
        .get(
          `/api/v1/admin/users/${DEPENDENT_ID}/guardianships/00000000-0000-4000-8000-0000000000b1/consent-evidence`,
        )
        .set(bearer(GUARDIAN_ID));

      expect(response.status).toBe(403);
    });
  });

  it('a pending grant cannot reach classes:write routes', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/users/${DEPENDENT_ID}/classes/enroll`)
      .set(acting(GUARDIAN_ID, DEPENDENT_ID))
      .send({ class_id: 1 });

    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe('ACTING_FOR_SCOPE_DENIED');
  });

  it('answers a foreign, a random and an unrelated dependent with the same 403', async () => {
    const bodies: unknown[] = [];
    for (const target of [FOREIGN_DEPENDENT_ID, RANDOM_ID, OTHER_GUARDIAN_ID]) {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/users/${target}/post-registration/status`)
        .set(acting(GUARDIAN_ID, target));
      expect(response.status).toBe(403);
      expect(errorCode(response.body)).toBe('ACTING_FOR_FORBIDDEN');
      bodies.push(
        // Same body once the per-request fields (time, echoed path) are gone.
        JSON.stringify({
          ...response.body,
          timestamp: undefined,
          path: undefined,
        }),
      );
    }
    expect(new Set(bodies).size).toBe(1);
  });

  describe('cross-dependent isolation (FP-12)', () => {
    const statusOf = (dependentId: string) =>
      `/api/v1/users/${dependentId}/post-registration/status`;

    it('acting for one dependent can never read or write another dependent of the same guardian', async () => {
      // Both dependents are legitimately the guardian's: each header works on
      // its own dependent...
      const own = await request(app.getHttpServer())
        .get(statusOf(SIBLING_DEPENDENT_ID))
        .set(acting(GUARDIAN_ID, SIBLING_DEPENDENT_ID));
      expect(own.status).toBe(200);

      // ...but a header for D1 on a path of D3 (and the reverse) is denied.
      for (const [header, path] of [
        [DEPENDENT_ID, SIBLING_DEPENDENT_ID],
        [SIBLING_DEPENDENT_ID, DEPENDENT_ID],
      ]) {
        const read = await request(app.getHttpServer())
          .get(statusOf(path))
          .set(acting(GUARDIAN_ID, header));
        expect(read.status).toBe(403);
        // Owner check on the substituted principal, not a missing header.
        expect(errorCode(read.body)).toBe('GUARD_PERMISSION_DENIED');

        const profile = await request(app.getHttpServer())
          .get(`/api/v1/users/${path}`)
          .set(acting(GUARDIAN_ID, header));
        expect(profile.status).toBe(403);

        const write = await request(app.getHttpServer())
          .patch(`/api/v1/users/${path}`)
          .set(acting(GUARDIAN_ID, header))
          .send({ name: 'Otro' });
        expect(write.status).toBe(403);
      }
      // Nothing was written for the sibling through the wrong header.
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('acting for a dependent and addressing a stranger is denied too', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/users/${FOREIGN_DEPENDENT_ID}`)
        .set(acting(GUARDIAN_ID, DEPENDENT_ID));
      expect(response.status).toBe(403);
    });
  });

  describe('base user role grants while acting (#519)', () => {
    /**
     * Simulates a regressed base role that still carries cross-user grants
     * (pre-20261016100000 plus users:read_detail): the guard itself, not only
     * the seed, must keep the acting guardian off other users' data.
     */
    const BASE_ROLE_PERMISSIONS = [
      'users:read',
      'users:read_detail',
      'users:update_profile',
      'health:read',
      'health:update',
      'emergency_contacts:read',
      'post_registration:read',
    ];

    beforeEach(() => {
      authorizationContext.resolveUserAuthorization.mockImplementation(
        async (userId: string) =>
          resolvedProfile(
            userId,
            buildAuthorizationSnapshot({
              globalRoleName: 'user',
              globalPermissions: BASE_ROLE_PERMISSIONS,
            }),
          ),
      );
      authorizationContext.resolveUserAuthorization.mockClear();
    });

    afterEach(() => {
      authorizationContext.resolveUserAuthorization.mockImplementation(
        defaultResolveAuthorization,
      );
    });

    it.each([
      ['health', (id: string) => `/api/v1/users/${id}/allergies`],
      ['profile', (id: string) => `/api/v1/users/${id}`],
      [
        'post-registration',
        (id: string) => `/api/v1/users/${id}/post-registration/status`,
      ],
    ])(
      'an acting guardian cannot read a non-dependent user %s through base-role grants',
      async (_label, path) => {
        for (const target of [RANDOM_ID, GUARDIAN_ID]) {
          const response = await request(app.getHttpServer())
            .get(path(target))
            .set(acting(GUARDIAN_ID, DEPENDENT_ID));
          expect(response.status).toBe(403);
          expect(errorCode(response.body)).toBe('GUARD_PERMISSION_DENIED');
        }
        // Only the substituted principal (the dependent) was evaluated.
        const evaluated =
          authorizationContext.resolveUserAuthorization.mock.calls.map(
            ([userId]) => userId,
          );
        expect(evaluated.length).toBeGreaterThan(0);
        expect(new Set(evaluated)).toEqual(new Set([DEPENDENT_ID]));
      },
    );

    it('the owner bypass still serves the dependent own route while acting', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/users/${DEPENDENT_ID}/post-registration/status`)
        .set(acting(GUARDIAN_ID, DEPENDENT_ID));

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ complete: false });
      expect(
        authorizationContext.resolveUserAuthorization,
      ).not.toHaveBeenCalled();
    });

    it('without the header the guardian cannot use base-role grants on the dependent either', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/users/${DEPENDENT_ID}/allergies`)
        .set(bearer(GUARDIAN_ID));

      expect(response.status).toBe(403);
      expect(errorCode(response.body)).toBe('GUARD_PERMISSION_DENIED');
    });
  });

  describe('@Public routes ignore the header (FP-08)', () => {
    it.each([
      ['malformed', 'not-a-uuid'],
      ['foreign', FOREIGN_DEPENDENT_ID],
    ])(
      'a %s X-Acting-For on GET /legal/current is ignored',
      async (_kind, value) => {
        const response = await request(app.getHttpServer())
          .get('/api/v1/legal/current')
          .set({ ...bearer(GUARDIAN_ID), 'X-Acting-For': value });

        expect(response.status).toBe(200);
        expect(response.body.data.documents).toBeDefined();
      },
    );
  });

  it('a malformed header is a 400, not a 401', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set({ ...bearer(GUARDIAN_ID), 'X-Acting-For': 'not-a-uuid' });

    expect(response.status).toBe(400);
    expect(errorCode(response.body)).toBe('ACTING_FOR_HEADER_INVALID');
  });

  it('acting for yourself is forbidden', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(acting(GUARDIAN_ID, GUARDIAN_ID));
    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe('ACTING_FOR_FORBIDDEN');
  });

  it('honors a revocation on the very next request (epoch bump), not after the cache TTL', async () => {
    const url = `/api/v1/users/${DEPENDENT_ID}/post-registration/status`;

    // Warm the 60s grant cache.
    const first = await request(app.getHttpServer())
      .get(url)
      .set(acting(GUARDIAN_ID, DEPENDENT_ID));
    expect(first.status).toBe(200);

    // Another guardian removes this one; the service bumps the epoch.
    grantedStatus = null;
    const stale = await request(app.getHttpServer())
      .get(url)
      .set(acting(GUARDIAN_ID, DEPENDENT_ID));
    expect(stale.status).toBe(200); // still cached: nothing told the cache yet

    await actingCache.bump(DEPENDENT_ID);

    const after = await request(app.getHttpServer())
      .get(url)
      .set(acting(GUARDIAN_ID, DEPENDENT_ID));
    expect(after.status).toBe(403);
    expect(errorCode(after.body)).toBe('ACTING_FOR_FORBIDDEN');

    // The guardian's own requests keep working.
    const own = await request(app.getHttpServer())
      .get('/api/v1/guardianships/me/dependents')
      .set(bearer(GUARDIAN_ID));
    expect(own.status).toBe(200);
  });
});

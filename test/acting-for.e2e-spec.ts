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

describe('Acting-for E2E', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let prisma: any;
  let actingCache: ActingForCache;
  let throttlerSpy: jest.SpyInstance;

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
    consent_evidences: [],
    dependent: {
      user_id: DEPENDENT_ID,
      name: 'Ana',
      paternal_last_name: 'Pérez',
      maternal_last_name: null,
      birthday: new Date('2017-04-02T00:00:00.000Z'),
      user_image: null,
      country_id: null,
      users_pr: { complete: false },
      dependent_profile: { frozen_at: null },
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

    const authorizationContext = {
      resolveUserAuthorization: jest.fn(async (userId: string) => ({
        profile: { user_id: userId },
        post_register_complete: true,
        authorization: buildAuthorizationSnapshot({}),
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
          where.dependent_user_id === DEPENDENT_ID &&
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
      relationship_types: createModelMock({
        findFirst: jest
          .fn()
          .mockResolvedValue({ relationship_type_id: RELATIONSHIP_ID }),
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
        accepted_terms_version: '1.0.0-store',
        accepted_privacy_version: '1.0.0-store',
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
        accepted_terms_version: '1.0.0-store',
        accepted_privacy_version: '1.0.0-store',
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

  it('guardian endpoints cannot be used while acting', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/guardianships/me/dependents')
      .set(acting(GUARDIAN_ID, DEPENDENT_ID));

    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe('ACTING_FOR_SCOPE_DENIED');
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

/**
 * confirm-union-http.e2e-spec.ts
 *
 * HTTP-layer guard coverage for POST /annual-folders/:folderId/sections/:sectionId/confirm-union.
 *
 * These two tests (T-C9a, T-C9b) were originally deferred from the direct-service
 * spec (src/annual-folders/__tests__/confirm-union.e2e-spec.ts) because that file
 * has no HTTP stack. They live here — in the shared `test/` harness — so the REAL
 * PermissionsGuard runs end-to-end through supertest.
 *
 * Strategy (strategy b from the research doc):
 *   - Spin up a full NestJS app via AppModule (no PermissionsGuard mock).
 *   - Spy on AuthorizationContextService.prototype.resolveUserAuthorization per-test
 *     to return a controlled ResolvedAuthorizationProfile with no global permissions.
 *   - The real PermissionsGuard evaluates annual_folders:evaluate against global_roles
 *     (type: 'global'), finds nothing, and throws ForbiddenException → HTTP 403.
 *   - No DB seeding needed: the guard rejects before any Prisma call.
 *
 * SDD change: annual-folders-ownership-rework, tasks T-C9a / T-C9b
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  AuthorizationContextService,
  type ResolvedAuthorizationProfile,
} from '../src/common/services/authorization-context.service';
import {
  buildAuthorizationSnapshot,
  createBearerToken,
  createTestJwtService,
} from './helpers/rbac-test-helpers';

// ---------------------------------------------------------------------------
// Fake UUIDs for folder / section — the guard rejects before DB is touched
// (resource.type = 'global' → no Prisma scope validation in PermissionsGuard)
// ---------------------------------------------------------------------------

const FAKE_FOLDER_ID = '00000000-aaaa-4000-8000-000000000001';
const FAKE_SECTION_ID = '00000000-bbbb-4000-8000-000000000002';

// ---------------------------------------------------------------------------
// Module setup
// ---------------------------------------------------------------------------

describe('Confirm Union — HTTP guard layer (T-C9a / T-C9b)', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  /** Throttler bypass — we never want rate-limit interference in tests */
  const mockThrottlerGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  /** Build a ResolvedAuthorizationProfile with zero global permissions. */
  function buildEmptyProfile(
    userId: string,
    email: string,
  ): ResolvedAuthorizationProfile {
    return {
      profile: {
        user_id: userId,
        email,
        name: 'Test',
        paternal_last_name: 'User',
        maternal_last_name: null,
        gender: null,
        birthday: null,
        baptism: false,
        baptism_date: null,
        user_image: null,
        country_id: null,
        union_id: null,
        local_field_id: null,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
      },
      post_register_complete: false,
      authorization: buildAuthorizationSnapshot({
        // No globalPermissions → global_roles array is empty → guard throws 403
        globalPermissions: [],
      }),
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

  /** Build a ResolvedAuthorizationProfile for a club-only director
   * (has a club_assignment, but global_roles is empty — no annual_folders:evaluate). */
  function buildClubDirectorProfile(
    userId: string,
    email: string,
  ): ResolvedAuthorizationProfile {
    return {
      profile: {
        user_id: userId,
        email,
        name: 'Club',
        paternal_last_name: 'Director',
        maternal_last_name: null,
        gender: null,
        birthday: null,
        baptism: false,
        baptism_date: null,
        user_image: null,
        country_id: null,
        union_id: null,
        local_field_id: null,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
      },
      post_register_complete: false,
      authorization: buildAuthorizationSnapshot({
        // No globalPermissions — mirrors a real club director who only has
        // club_role_assignments (no entry in users_roles / global_roles).
        globalPermissions: [],
        activePermissions: ['activities:read', 'activities:create'],
        activeRoleName: 'director',
        assignmentId: 'club-assignment-1',
        clubId: 1,
        clubSectionId: 1,
        clubTypeName: 'Guías Mayores',
      }),
      legacy: {
        roles: ['director'],
        permissions: [],
        club: {
          club_id: 1,
          club_name: 'Club Test',
          club_type: 'Guías Mayores',
        },
        club_context: {
          active_assignment_id: 'club-assignment-1',
          active: null,
          available: [],
        },
      },
    };
  }

  beforeAll(async () => {
    // Environment hygiene — prevent side-effects from Redis / Firebase at init
    delete process.env.REDIS_URL;
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.FIREBASE_CLIENT_EMAIL;

    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET || 'test-secret';

    jwtService = createTestJwtService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Bypass rate-limiting — not under test here
      .overrideProvider(APP_GUARD)
      .useValue(mockThrottlerGuard)
      .overrideGuard(ThrottlerGuard)
      .useValue(mockThrottlerGuard)
      // NOTE: PermissionsGuard is intentionally NOT overridden —
      // the whole point of T-C9a/T-C9b is that the real guard enforces 403.
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // T-C9a: Club-only director — FORBIDDEN at HTTP layer
  //
  // A user whose ONLY role is "director" at club scope (club_role_assignments)
  // has NO entry in global_roles and therefore lacks annual_folders:evaluate.
  // PermissionsGuard checks global_roles for type='global' resources and must
  // throw ForbiddenException.
  // =========================================================================

  it('T-C9a: club-user director is FORBIDDEN at HTTP layer (guard: no global annual_folders:evaluate)', async () => {
    const userId = 'club-director-test-id';
    const email = 'director-club@sacdia.com';

    // Spy on the real guard's internal resolveUserAuthorization call so the
    // REAL PermissionsGuard executes its permission check against our fixture.
    jest
      .spyOn(AuthorizationContextService.prototype, 'resolveUserAuthorization')
      .mockResolvedValue(buildClubDirectorProfile(userId, email));

    const token = createBearerToken(jwtService, userId, email);

    const response = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post(
        `/api/v1/annual-folders/${FAKE_FOLDER_ID}/sections/${FAKE_SECTION_ID}/confirm-union`,
      )
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVED' })
      .expect(403);

    expect(response.body).toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('annual_folders:evaluate'),
    });
  });

  // =========================================================================
  // T-C9b: Non-assigned user (zero roles) — FORBIDDEN at HTTP layer
  //
  // A freshly-created user with no users_roles entries and no club_role_assignments
  // has an empty authorization snapshot. Same 403 result — different actor shape.
  // =========================================================================

  it('T-C9b: non-assigned user is FORBIDDEN at HTTP layer (guard: no global annual_folders:evaluate)', async () => {
    const userId = 'no-role-test-id';
    const email = 'no-role-confirm-union@sacdia.test';

    jest
      .spyOn(AuthorizationContextService.prototype, 'resolveUserAuthorization')
      .mockResolvedValue(buildEmptyProfile(userId, email));

    const token = createBearerToken(jwtService, userId, email);

    const response = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post(
        `/api/v1/annual-folders/${FAKE_FOLDER_ID}/sections/${FAKE_SECTION_ID}/confirm-union`,
      )
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVED' })
      .expect(403);

    expect(response.body).toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('annual_folders:evaluate'),
    });
  });
});

/**
 * E2E integration tests for /api/v1/member-rankings/
 *
 * Critical purpose: lock down the route-order bug (engram #1888) where
 * ParseIntPipe applied to `:enrollmentId` would collide with the static
 * route `/me` — causing GET /member-rankings/me to return 400 instead of
 * the correct 403 (hidden) or 200 (self_only).
 *
 * Plan 8.4-A Task 16.
 * Deviation from plan: plan proposed `loginAs()` with real Better Auth login.
 * Adapted to mocked JWT (project pattern: `createBearerToken` + JWT secret).
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PermissionsGuard } from '../src/common/guards';
import { PrismaService } from '../src/prisma/prisma.service';
import { SystemConfigService } from '../src/system-config/system-config.service';
import type { ResolvedAuthorizationProfile } from '../src/common/services/authorization-context.service';
import {
  buildAuthorizationSnapshot,
  createBearerToken,
  createTestJwtService,
} from './helpers/rbac-test-helpers';

// ---------------------------------------------------------------------------
// Profile factory
// Matches runtime ResolvedAuthorizationProfile shape (Task 12 C1 lesson).
// We pass the full profile via req.authorization so services can access
// both profile.profile.user_id and profile.authorization.*.
// ---------------------------------------------------------------------------

function makeProfile(
  userId: string,
  permissions: string[],
  clubIds: number[] = [],
  sectionIds: number[] = [],
): ResolvedAuthorizationProfile {
  return {
    profile: {
      user_id: userId,
      email: `${userId}@test.local`,
      name: null,
      paternal_last_name: null,
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
    post_register_complete: true,
    authorization: buildAuthorizationSnapshot({
      activePermissions: permissions,
      activeRoleName: clubIds.length > 0 ? 'director' : 'member',
      assignmentId: clubIds.length > 0 ? 'assign-e2e-1' : null,
      clubId: clubIds[0],
      clubSectionId: sectionIds[0],
    }),
    legacy: {
      roles: [],
      permissions,
      club: null,
      club_context: { active_assignment_id: null, active: null, available: [] },
    },
  };
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const MEMBER_USER_ID = 'member-e2e-uuid-1';
const YEAR_ID = 5;

const memberProfile = makeProfile(MEMBER_USER_ID, [
  'member_rankings:read_self',
]);
const directorProfile = makeProfile(
  'director-e2e-uuid-1',
  ['member_rankings:read_club'],
  [10],
  [100],
);

// ---------------------------------------------------------------------------
// Mock enrollment ranking row returned by Prisma
// ---------------------------------------------------------------------------

const mockEnrollmentRankingRow = {
  enrollment_id: 123,
  user_id: MEMBER_USER_ID,
  club_id: 10,
  club_section_id: 100,
  ecclesiastical_year_id: YEAR_ID,
  class_score_pct: null,
  investiture_score_pct: null,
  camporee_score_pct: null,
  composite_score_pct: null,
  rank_position: null,
  composite_calculated_at: null,
  awarded_category_id: null,
  user: { name: 'Test Member' },
  club_section: { club_types: { name: 'Section A' } },
  awarded_category: null,
};

// ---------------------------------------------------------------------------
// Guard override — sets req.authorization to a profile controlled per-test.
// Using a mutable closure so each test can control the profile without
// rebuilding the app module.
// ---------------------------------------------------------------------------

let currentProfile: ResolvedAuthorizationProfile = memberProfile;

const mockPermissionsGuard = {
  canActivate: jest.fn((ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<Record<string, unknown>>();
    req['authorization'] = currentProfile;
    return true;
  }),
};

// ---------------------------------------------------------------------------
// App bootstrap
// ---------------------------------------------------------------------------

describe('Member Rankings E2E (/api/v1/member-rankings)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let systemConfig: SystemConfigService;
  let jwtService: JwtService;
  let memberToken: string;

  const mockThrottlerGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  beforeAll(async () => {
    delete process.env.REDIS_URL;
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.FIREBASE_CLIENT_EMAIL;

    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET || 'test-secret';

    jwtService = createTestJwtService();
    memberToken = createBearerToken(
      jwtService,
      MEMBER_USER_ID,
      `${MEMBER_USER_ID}@test.local`,
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(APP_GUARD)
      .useValue(mockThrottlerGuard)
      .overrideGuard(ThrottlerGuard)
      .useValue(mockThrottlerGuard)
      .overrideGuard(PermissionsGuard)
      .useValue(mockPermissionsGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.setGlobalPrefix('api/v1');

    prisma = app.get(PrismaService);
    systemConfig = app.get(SystemConfigService);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Reset to member profile after each test
    currentProfile = memberProfile;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Baseline — app boot
  // ─────────────────────────────────────────────────────────────────────────

  it('should be defined (app boots successfully)', () => {
    expect(app).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. CRITICAL: /me must NOT be parsed as integer — engram #1888 lock-down
  //
  // If route order is wrong (dynamic :enrollmentId before static /me), this
  // test returns 400 (ParseIntPipe rejects "me" as non-integer).
  // Correct behavior: 403 MEMBER_RANKING_HIDDEN (static route matches first).
  // ─────────────────────────────────────────────────────────────────────────

  it('GET /me — visibility=hidden returns 403 MEMBER_RANKING_HIDDEN (NOT 400 ParseIntPipe)', async () => {
    currentProfile = memberProfile;

    jest.spyOn(systemConfig, 'get').mockResolvedValue('hidden');

    const response = await request(app.getHttpServer())
      .get('/api/v1/member-rankings/me')
      .query({ year_id: YEAR_ID })
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(403);

    expect(response.body).toHaveProperty('code', 'MEMBER_RANKING_HIDDEN');
    // Explicit guard: must not be a ValidationPipe/ParseIntPipe 400
    expect(response.status).not.toBe(400);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. /me — visibility=self_only returns 200 with own ranking shape
  // ─────────────────────────────────────────────────────────────────────────

  it('GET /me — visibility=self_only returns 200 with member ranking shape', async () => {
    currentProfile = memberProfile;

    jest.spyOn(systemConfig, 'get').mockResolvedValue('self_only');

    jest
      .spyOn(prisma.enrollmentRanking, 'findFirst')
      .mockResolvedValue(mockEnrollmentRankingRow as any);

    const response = await request(app.getHttpServer())
      .get('/api/v1/member-rankings/me')
      .query({ year_id: YEAR_ID })
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    expect(response.body).toHaveProperty('member');
    expect(response.body).toHaveProperty('visibility_mode', 'self_only');
    expect(response.body.member).toHaveProperty('enrollment_id', 123);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. /:enrollmentId/breakdown — integer enrollmentId works (200 or 404)
  // ─────────────────────────────────────────────────────────────────────────

  it('GET /123/breakdown — integer enrollmentId returns 404 MEMBER_RANKING_NOT_FOUND when not found', async () => {
    currentProfile = memberProfile;

    jest.spyOn(prisma.enrollmentRanking, 'findFirst').mockResolvedValue(null);

    const response = await request(app.getHttpServer())
      .get('/api/v1/member-rankings/123/breakdown')
      .query({ year_id: YEAR_ID })
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(404);

    expect(response.body).toHaveProperty('code', 'MEMBER_RANKING_NOT_FOUND');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. /:enrollmentId/breakdown — non-integer rejected by ParseIntPipe (400)
  // ─────────────────────────────────────────────────────────────────────────

  it('GET /abc/breakdown — non-integer enrollmentId is rejected with 400 (ParseIntPipe)', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/member-rankings/abc/breakdown')
      .query({ year_id: YEAR_ID })
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(400);

    // NestJS ValidationPipe/ParseIntPipe returns 400 with "message" array
    expect(response.body).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. POST /recalculate — kill-switch off returns 400 RECALCULATION_DISABLED
  // ─────────────────────────────────────────────────────────────────────────

  it('POST /recalculate — kill-switch returns 400 RECALCULATION_DISABLED', async () => {
    currentProfile = directorProfile;

    jest.spyOn(systemConfig, 'get').mockResolvedValue('false');

    const response = await request(app.getHttpServer())
      .post('/api/v1/member-rankings/recalculate')
      .query({ year_id: YEAR_ID })
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(400);

    expect(response.body).toHaveProperty('code', 'RECALCULATION_DISABLED');
  });
});

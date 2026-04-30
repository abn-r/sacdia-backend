/**
 * E2E integration tests for /api/v1/section-rankings/
 *
 * Verifies paginated list endpoint with RBAC scope enforcement,
 * section member drill-down with integer path param, ParseIntPipe
 * rejection for non-integer params, and 403 for callers without
 * section_rankings permissions.
 *
 * Plan 8.4-A Task 16.
 * Deviation from plan: loginAs() real auth adapted to mocked JWT
 * (project pattern: createBearerToken + JWT secret).
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
import type { ResolvedAuthorizationProfile } from '../src/common/services/authorization-context.service';
import {
  buildAuthorizationSnapshot,
  createBearerToken,
  createTestJwtService,
} from './helpers/rbac-test-helpers';

// ---------------------------------------------------------------------------
// Profile factory
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
      assignmentId: clubIds.length > 0 ? 'assign-sec-e2e-1' : null,
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

const DIRECTOR_USER_ID = 'director-sec-e2e-uuid-1';
const MEMBER_USER_ID = 'member-sec-e2e-uuid-1';
const YEAR_ID = 5;
const SECTION_ID = 1;

const directorProfile = makeProfile(
  DIRECTOR_USER_ID,
  ['section_rankings:read_club'],
  [1],       // club_id: 1
  [SECTION_ID],
);

const memberProfile = makeProfile(
  MEMBER_USER_ID,
  ['member_rankings:read_self'], // no section_rankings permission
);

// ---------------------------------------------------------------------------
// Guard override — sets req.authorization to a profile controlled per-test
// ---------------------------------------------------------------------------

let currentProfile: ResolvedAuthorizationProfile = directorProfile;

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

describe('Section Rankings E2E (/api/v1/section-rankings)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let directorToken: string;
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
    directorToken = createBearerToken(
      jwtService,
      DIRECTOR_USER_ID,
      `${DIRECTOR_USER_ID}@test.local`,
    );
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

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Reset to director profile after each test
    currentProfile = directorProfile;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Baseline — app boot
  // ─────────────────────────────────────────────────────────────────────────

  it('should be defined (app boots successfully)', () => {
    expect(app).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. GET / — director-club returns 200 with paginated envelope
  // ─────────────────────────────────────────────────────────────────────────

  it(
    'GET / — director with read_club returns 200 paginated envelope',
    async () => {
      currentProfile = directorProfile;

      jest
        .spyOn(prisma.sectionRanking, 'findMany')
        .mockResolvedValue([]);
      jest
        .spyOn(prisma.sectionRanking, 'count')
        .mockResolvedValue(0);

      const response = await request(app.getHttpServer())
        .get('/api/v1/section-rankings')
        .query({ year_id: YEAR_ID })
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('page');
      expect(response.body).toHaveProperty('limit');
      expect(Array.isArray(response.body.data)).toBe(true);
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // 3. GET /:sectionId/members — integer sectionId works (200)
  // ─────────────────────────────────────────────────────────────────────────

  it(
    'GET /1/members — integer sectionId is accepted (200)',
    async () => {
      currentProfile = directorProfile;

      jest
        .spyOn(prisma.club_sections, 'findUnique')
        .mockResolvedValue({
          club_section_id: SECTION_ID,
          name: 'Section A',
          club_id: 1,
          clubs: { club_id: 1, local_field_id: null },
        } as any);

      jest
        .spyOn(prisma.enrollmentRanking, 'findMany')
        .mockResolvedValue([]);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/section-rankings/${SECTION_ID}/members`)
        .query({ year_id: YEAR_ID })
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // 4. GET /:sectionId/members — non-integer rejected by ParseIntPipe (400)
  // ─────────────────────────────────────────────────────────────────────────

  it(
    'GET /abc/members — non-integer sectionId is rejected with 400 (ParseIntPipe)',
    async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/section-rankings/abc/members')
        .query({ year_id: YEAR_ID })
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(400);

      expect(response.body).toBeDefined();
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // 5. GET / — member without section_rankings permission returns 403
  // ─────────────────────────────────────────────────────────────────────────

  it(
    'GET / — member with only member_rankings:read_self returns 403 MEMBER_RANKING_SCOPE_DENIED',
    async () => {
      // Member has no section_rankings:* permission — service throws
      currentProfile = memberProfile;

      const response = await request(app.getHttpServer())
        .get('/api/v1/section-rankings')
        .query({ year_id: YEAR_ID })
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(403);

      expect(response.body).toHaveProperty('code', 'MEMBER_RANKING_SCOPE_DENIED');
    },
  );
});

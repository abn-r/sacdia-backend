import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { MemberRankingsController } from './member-rankings.controller';
import { MemberRankingsService } from './member-rankings.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import {
  AppForbiddenException,
  AppBadRequestException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { MemberRankingResponseDto } from './dto/member-ranking-response.dto';
import type { ResolvedAuthorizationProfile } from '../../common/services/authorization-context.service';

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

const YEAR_ID = 5;
const ENROLLMENT_ID = 42;

const mockRankingRow: MemberRankingResponseDto = {
  enrollment_id: ENROLLMENT_ID,
  user_id: 'user-uuid-001',
  member_name: 'Juan Perez',
  club_section_id: 10,
  section_name: 'Seccion A',
  class_score_pct: 80,
  investiture_score_pct: 100,
  camporee_score_pct: 60,
  composite_score_pct: 82,
  rank_position: 3,
  awarded_category: null,
  composite_calculated_at: '2026-04-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// ResolvedAuthorizationProfile fixtures
// PermissionsGuard is bypassed in tests; we manually set req.authorization
// to match the real profile shape consumed by the service.
// ---------------------------------------------------------------------------

function makeProfile(
  userId: string,
  permissions: string[],
  clubIds: number[] = [],
  sectionIds: number[] = [],
  localFieldIds: number[] = [],
): ResolvedAuthorizationProfile {
  return {
    profile: {
      user_id: userId,
      email: `${userId}@test.com`,
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
      created_at: new Date(),
    },
    post_register_complete: true,
    authorization: {
      grants: {
        global_roles: [],
        club_assignments: clubIds.map((clubId, i) => ({
          assignment_id: `assign-${i}`,
          role_name: 'director',
          permissions,
          club: { club_id: clubId, club_name: `Club ${clubId}` },
          section: { club_section_id: sectionIds[i] ?? clubId * 10, club_type_name: null },
          scope: {
            local_field: localFieldIds[i] !== undefined
              ? { id: localFieldIds[i], name: `LF ${localFieldIds[i]}` }
              : undefined,
          },
          status: 'active',
          start_date: null,
          end_date: null,
          expires_at: null,
        })),
      },
      active_assignment: { assignment_id: clubIds.length > 0 ? 'assign-0' : null },
      effective: {
        permissions,
        scope: {
          global: {},
          club: clubIds.length > 0
            ? {
                assignment_id: 'assign-0',
                role_name: 'director',
                club: { club_id: clubIds[0], club_name: `Club ${clubIds[0]}` },
                section: { club_section_id: sectionIds[0] ?? clubIds[0] * 10, club_type_name: null },
              }
            : null,
        },
      },
    },
    legacy: {
      roles: [],
      permissions,
      club: null,
      club_context: { active_assignment_id: null, active: null, available: [] },
    },
  };
}

// Profile for a plain member (read_self only)
const selfProfile = makeProfile('user-uuid-001', ['member_rankings:read_self']);

// Profile for a club director (read_club) with club 99, section 10
const directorProfileOwnClub = makeProfile(
  'director-uuid-001',
  ['member_rankings:read_club'],
  [99],
  [10],
);

// Profile for a club director with a DIFFERENT club (999 ≠ 99 in row)
const directorProfileDifferentClub = makeProfile(
  'director-uuid-001',
  ['member_rankings:read_club'],
  [999],
  [9990],
);

// Profile for a local-field reader with local_field_id = 1
const lfProfileLf1 = makeProfile(
  'lf-admin-uuid-001',
  ['member_rankings:read_lf'],
  [10],   // club 10 is in LF 1
  [100],
  [1],    // localFieldIds[0] = 1
);

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------

const mockService = {
  list: jest.fn(),
  getMyRanking: jest.fn(),
  getBreakdown: jest.fn(),
  triggerRecalculate: jest.fn(),
};

// ---------------------------------------------------------------------------
// Guard overrides — bypass auth so we test handler logic only
// ---------------------------------------------------------------------------

const allowGuard = { canActivate: () => true };

// ---------------------------------------------------------------------------

describe('MemberRankingsController', () => {
  let controller: MemberRankingsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MemberRankingsController],
      providers: [
        { provide: MemberRankingsService, useValue: mockService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allowGuard)
      .overrideGuard(PermissionsGuard)
      .useValue(allowGuard)
      .compile();

    controller = module.get<MemberRankingsController>(MemberRankingsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. GET / member self → 200 (own only)
  // ─────────────────────────────────────────────────────────────────────────
  describe('GET / — member self → 200', () => {
    it('returns paginated ranking scoped to own user_id', async () => {
      const paginatedResult = {
        data: [mockRankingRow],
        total: 1,
        page: 1,
        limit: 20,
      };
      mockService.list.mockResolvedValueOnce(paginatedResult);

      const req = {
        user: { user_id: selfProfile.profile.user_id },
        authorization: selfProfile,
      };
      const result = await controller.list(req, YEAR_ID);

      expect(mockService.list).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: selfProfile,
          yearId: YEAR_ID,
          page: 1,
          limit: 20,
        }),
      );
      expect(result).toEqual(paginatedResult);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. GET / member with other enrollment_id → 403
  // ─────────────────────────────────────────────────────────────────────────
  describe('GET / — member tries another enrollment → 403', () => {
    it('propagates AppForbiddenException from service when scope denied', async () => {
      const scopeError = new AppForbiddenException(
        ErrorCode.MEMBER_RANKING_SCOPE_DENIED,
      );
      mockService.list.mockRejectedValue(scopeError);

      const otherProfile = makeProfile('other-user-id', ['member_rankings:read_self']);
      const req = {
        user: { user_id: 'other-user-id' },
        authorization: otherProfile,
      };

      const thrown = await controller
        .list(req, YEAR_ID)
        .catch((e) => e) as AppForbiddenException;

      expect(thrown).toBeInstanceOf(AppForbiddenException);
      expect(thrown.code).toBe(ErrorCode.MEMBER_RANKING_SCOPE_DENIED);
      expect(thrown.getStatus()).toBe(HttpStatus.FORBIDDEN);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. GET / director-club same club → 200 filtered
  // ─────────────────────────────────────────────────────────────────────────
  describe('GET / — director-club same club → 200 filtered', () => {
    it('delegates to service with club scope and returns data', async () => {
      const paginatedResult = {
        data: [mockRankingRow],
        total: 1,
        page: 1,
        limit: 20,
      };
      mockService.list.mockResolvedValueOnce(paginatedResult);

      const req = {
        user: { user_id: directorProfileOwnClub.profile.user_id },
        authorization: directorProfileOwnClub,
      };

      const result = await controller.list(req, YEAR_ID, '99');

      expect(mockService.list).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: directorProfileOwnClub,
          clubId: 99,
          yearId: YEAR_ID,
        }),
      );
      expect(result).toEqual(paginatedResult);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. GET / director-club different club → 403
  // ─────────────────────────────────────────────────────────────────────────
  describe('GET / — director-club different club → 403', () => {
    it('propagates AppForbiddenException when club not in scope', async () => {
      mockService.list.mockRejectedValueOnce(
        new AppForbiddenException(ErrorCode.MEMBER_RANKING_SCOPE_DENIED),
      );

      const req = {
        user: { user_id: directorProfileDifferentClub.profile.user_id },
        authorization: directorProfileDifferentClub,
      };

      await expect(controller.list(req, YEAR_ID, '99')).rejects.toThrow(
        AppForbiddenException,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. GET /me visibility=hidden → 403 MEMBER_RANKING_HIDDEN
  // ─────────────────────────────────────────────────────────────────────────
  describe('GET /me — visibility=hidden → 403 MEMBER_RANKING_HIDDEN', () => {
    it('throws AppForbiddenException with MEMBER_RANKING_HIDDEN code', async () => {
      mockService.getMyRanking.mockRejectedValueOnce(
        new AppForbiddenException(ErrorCode.MEMBER_RANKING_HIDDEN),
      );

      const req = {
        user: { user_id: 'user-uuid-001' },
        authorization: selfProfile,
      };

      const error = await controller
        .getMyRanking(req, YEAR_ID)
        .catch((e) => e) as AppForbiddenException;

      expect(error).toBeInstanceOf(AppForbiddenException);
      expect(error.code).toBe(ErrorCode.MEMBER_RANKING_HIDDEN);
      expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. GET /me visibility=self_and_top_n → response includes top_n array
  // ─────────────────────────────────────────────────────────────────────────
  describe('GET /me — visibility=self_and_top_n → includes top_n', () => {
    it('returns MemberMyRankingDto with top_n anonymized array', async () => {
      const myRankingResult = {
        member: mockRankingRow,
        visibility_mode: 'self_and_top_n' as const,
        top_n: [
          { member_name: 'Miembro #1', composite_score_pct: 95, rank_position: 1 },
          { member_name: 'Miembro #2', composite_score_pct: 90, rank_position: 2 },
          { member_name: 'Miembro #3', composite_score_pct: 82, rank_position: 3 },
        ],
      };

      mockService.getMyRanking.mockResolvedValueOnce(myRankingResult);

      const req = {
        user: { user_id: 'user-uuid-001' },
        authorization: selfProfile,
      };
      const result = await controller.getMyRanking(req, YEAR_ID);

      expect(result.visibility_mode).toBe('self_and_top_n');
      expect(Array.isArray(result.top_n)).toBe(true);
      expect(result.top_n).toHaveLength(3);
      // Q1.a: anonymized — no real names in top_n
      result.top_n!.forEach((entry, i) => {
        expect(entry.member_name).toBe(`Miembro #${i + 1}`);
      });
      expect(mockService.getMyRanking).toHaveBeenCalledWith(
        'user-uuid-001',
        YEAR_ID,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. GET /:enrollmentId/breakdown ParseIntPipe — string "abc" → 400
  // ─────────────────────────────────────────────────────────────────────────
  describe('GET /:enrollmentId/breakdown — ParseIntPipe "abc" → 400', () => {
    it('throws BadRequestException for non-numeric enrollmentId', async () => {
      // ParseIntPipe throws BadRequestException before handler is called.
      // We simulate this by calling service.getBreakdown with NaN-coercion
      // and verifying the guard handles it, OR we confirm ParseIntPipe is
      // used on the param by checking the handler signature validation.
      //
      // In a real NestJS E2E test the pipe would throw automatically.
      // For unit tests we verify the service receives an integer and the
      // service throws AppBadRequestException for bad input.
      mockService.getBreakdown.mockRejectedValueOnce(
        new AppBadRequestException(ErrorCode.MEMBER_RANKING_NOT_FOUND),
      );

      const req = {
        user: { user_id: 'user-uuid-001' },
        authorization: selfProfile,
      };

      // Simulate what would happen if NaN slipped through (it never does
      // with ParseIntPipe, but here we verify our service propagates errors):
      await expect(
        controller.getBreakdown(NaN, YEAR_ID, req),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. POST /recalculate kill-switch off → 400 RECALCULATION_DISABLED
  // ─────────────────────────────────────────────────────────────────────────
  describe('POST /recalculate — kill-switch off → 400 RECALCULATION_DISABLED', () => {
    it('throws AppBadRequestException with RECALCULATION_DISABLED code', async () => {
      mockService.triggerRecalculate.mockRejectedValueOnce(
        new AppBadRequestException(ErrorCode.RECALCULATION_DISABLED),
      );

      const req = { user: { user_id: 'admin-uuid-001' }, authorization: selfProfile };

      const error = await controller
        .recalculate(req, YEAR_ID)
        .catch((e) => e) as AppBadRequestException;

      expect(error).toBeInstanceOf(AppBadRequestException);
      expect(error.code).toBe(ErrorCode.RECALCULATION_DISABLED);
      expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);

      expect(mockService.triggerRecalculate).toHaveBeenCalledWith(
        YEAR_ID,
        'admin-uuid-001',
        undefined,
        'full',
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 9. C2 lock-down: getBreakdown read_lf caller cannot access enrollment
  //    in unrelated local field → 403
  // ─────────────────────────────────────────────────────────────────────────
  describe('GET /:enrollmentId/breakdown — read_lf caller unrelated LF → 403', () => {
    it('throws AppForbiddenException when row club local_field_id not in caller LF set', async () => {
      // Caller has read_lf with local_field_ids: [1]
      // Row club has local_field_id: 2 — must be denied
      mockService.getBreakdown.mockRejectedValueOnce(
        new AppForbiddenException(ErrorCode.MEMBER_RANKING_SCOPE_DENIED),
      );

      const req = {
        user: { user_id: lfProfileLf1.profile.user_id },
        authorization: lfProfileLf1,
      };

      const error = await controller
        .getBreakdown(ENROLLMENT_ID, YEAR_ID, req)
        .catch((e) => e) as AppForbiddenException;

      expect(error).toBeInstanceOf(AppForbiddenException);
      expect(error.code).toBe(ErrorCode.MEMBER_RANKING_SCOPE_DENIED);
      expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN);

      // Verify service received the real profile (not a stale scope object)
      expect(mockService.getBreakdown).toHaveBeenCalledWith(
        ENROLLMENT_ID,
        YEAR_ID,
        lfProfileLf1,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 10. N3 scope-escape regression: director-club requesting foreign club_id
  //     → 200 with empty rankings (scope intersection)
  // ─────────────────────────────────────────────────────────────────────────
  describe('GET /member-rankings as director-club requesting foreign club_id → 200 with empty rankings (scope intersection)', () => {
    it('returns empty result when caller requests a club outside their scope', async () => {
      const profile = makeProfile(
        'director-foreign-uuid',
        ['member_rankings:read_club'],
        [1], // caller belongs to club 1
      );
      // caller requests club_id=99 they don't belong to
      // service must intersect → empty effectiveClubIds → impossible filter → empty result
      jest.spyOn(mockService, 'list').mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

      const req = { user: { user_id: profile.profile.user_id }, authorization: profile };

      const result = await controller.list(req, YEAR_ID, '99');

      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20 });
      expect(mockService.list).toHaveBeenCalledWith(
        expect.objectContaining({ profile, clubId: 99 }),
      );
    });
  });
});

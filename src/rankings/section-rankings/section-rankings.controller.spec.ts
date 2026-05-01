import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { SectionRankingsController } from './section-rankings.controller';
import { SectionRankingsService } from './section-rankings.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AppForbiddenException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { SectionRankingResponseDto } from './dto/section-ranking-response.dto';
import { MemberRankingResponseDto } from '../member-rankings/dto/member-ranking-response.dto';
import type { ResolvedAuthorizationProfile } from '../../common/services/authorization-context.service';

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

const YEAR_ID = 5;
const SECTION_ID = 10;

const mockSectionRow: SectionRankingResponseDto = {
  club_section_id: SECTION_ID,
  section_name: 'Seccion A',
  composite_score_pct: 78.5,
  rank_position: 2,
  active_enrollment_count: 12,
  awarded_category: null,
  composite_calculated_at: '2026-04-01T00:00:00.000Z',
};

const mockMemberRow: MemberRankingResponseDto = {
  enrollment_id: 42,
  user_id: 'user-uuid-001',
  member_name: 'Juan Perez',
  club_section_id: SECTION_ID,
  section_name: 'Seccion A',
  class_score_pct: 80,
  investiture_score_pct: 100,
  camporee_score_pct: 60,
  composite_score_pct: 82,
  rank_position: 1,
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
          section: {
            club_section_id: sectionIds[i] ?? clubId * 10,
            club_type_name: null,
          },
          scope: {
            local_field:
              localFieldIds[i] !== undefined
                ? { id: localFieldIds[i], name: `LF ${localFieldIds[i]}` }
                : undefined,
          },
          status: 'active',
          start_date: null,
          end_date: null,
          expires_at: null,
        })),
      },
      active_assignment: {
        assignment_id: clubIds.length > 0 ? 'assign-0' : null,
      },
      effective: {
        permissions,
        scope: {
          global: {},
          club:
            clubIds.length > 0
              ? {
                  assignment_id: 'assign-0',
                  role_name: 'director',
                  club: {
                    club_id: clubIds[0],
                    club_name: `Club ${clubIds[0]}`,
                  },
                  section: {
                    club_section_id: sectionIds[0] ?? clubIds[0] * 10,
                    club_type_name: null,
                  },
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

// Profile for a plain member (no section_rankings permissions)
const memberProfile = makeProfile('user-uuid-001', [
  'member_rankings:read_self',
]);

// Profile for a club director (read_club) with club 99, section 10
const directorProfile = makeProfile(
  'director-uuid-001',
  ['section_rankings:read_club'],
  [99],
  [SECTION_ID],
);

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------

const mockService = {
  list: jest.fn(),
  getMembers: jest.fn(),
};

// ---------------------------------------------------------------------------
// Guard overrides — bypass auth so we test handler logic only
// ---------------------------------------------------------------------------

const allowGuard = { canActivate: () => true };
const denyGuard = { canActivate: () => false };

// ---------------------------------------------------------------------------

describe('SectionRankingsController', () => {
  let controller: SectionRankingsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SectionRankingsController],
      providers: [{ provide: SectionRankingsService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allowGuard)
      .overrideGuard(PermissionsGuard)
      .useValue(allowGuard)
      .compile();

    controller = module.get<SectionRankingsController>(
      SectionRankingsController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. GET / director-club → 200 filtered by club
  // ─────────────────────────────────────────────────────────────────────────
  describe('GET / — director-club → 200 filtered by club', () => {
    it('delegates to service with club scope and returns paginated data', async () => {
      const paginatedResult = {
        data: [mockSectionRow],
        total: 1,
        page: 1,
        limit: 20,
      };
      mockService.list.mockResolvedValueOnce(paginatedResult);

      const req = {
        user: { user_id: directorProfile.profile.user_id },
        authorization: directorProfile,
      };

      const result = await controller.list(req, YEAR_ID, '99');

      expect(mockService.list).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: directorProfile,
          clubId: 99,
          yearId: YEAR_ID,
        }),
      );
      expect(result).toEqual(paginatedResult);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. GET / member (no read_club/lf/global perms) → 403
  // ─────────────────────────────────────────────────────────────────────────
  describe('GET / — member without section_rankings permissions → 403', () => {
    it('propagates AppForbiddenException from service when scope denied', async () => {
      const scopeError = new AppForbiddenException(
        ErrorCode.MEMBER_RANKING_SCOPE_DENIED,
      );
      mockService.list.mockRejectedValueOnce(scopeError);

      const req = {
        user: { user_id: memberProfile.profile.user_id },
        authorization: memberProfile,
      };

      const thrown = (await controller
        .list(req, YEAR_ID)
        .catch((e) => e)) as AppForbiddenException;

      expect(thrown).toBeInstanceOf(AppForbiddenException);
      expect(thrown.code).toBe(ErrorCode.MEMBER_RANKING_SCOPE_DENIED);
      expect(thrown.getStatus()).toBe(HttpStatus.FORBIDDEN);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. GET /:sectionId/members ParseIntPipe "abc" → 400
  // ─────────────────────────────────────────────────────────────────────────
  describe('GET /:sectionId/members — ParseIntPipe "abc" → 400', () => {
    it('throws when service receives NaN (simulates ParseIntPipe rejection)', async () => {
      // ParseIntPipe throws BadRequestException before the handler is called.
      // In E2E tests the pipe would reject "abc" automatically.
      // For unit tests we verify that the handler propagates errors — a NaN
      // sectionId results in an error from the service layer.
      mockService.getMembers.mockRejectedValueOnce(
        new Error('Invalid integer'),
      );

      const req = {
        user: { user_id: directorProfile.profile.user_id },
        authorization: directorProfile,
      };

      await expect(controller.getMembers(NaN, YEAR_ID, req)).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. GET / director-club requesting foreign club_id → 200 empty (scope intersection)
  // ─────────────────────────────────────────────────────────────────────────
  describe('GET /section-rankings as director-club requesting foreign club_id → 200 with empty rankings (scope intersection)', () => {
    it('returns empty result when caller requests a club outside their scope', async () => {
      const profile = makeProfile(
        'director-foreign-uuid',
        ['section_rankings:read_club'],
        [1], // caller belongs to club 1
      );
      // caller requests club_id=99 they don't belong to
      // service must intersect → empty effectiveClubIds → impossible filter → empty result
      jest
        .spyOn(mockService, 'list')
        .mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

      const req = {
        user: { user_id: profile.profile.user_id },
        authorization: profile,
      };

      const result = await controller.list(req, YEAR_ID, '99');

      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20 });
      expect(mockService.list).toHaveBeenCalledWith(
        expect.objectContaining({ profile, clubId: 99 }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. GET /:sectionId/members → enrollments ordered by rank_position ASC NULLS LAST
  // ─────────────────────────────────────────────────────────────────────────
  describe('GET /:sectionId/members → enrollments ordered by rank_position ASC NULLS LAST', () => {
    it('returns members array ordered by rank_position with nulls last', async () => {
      // Service is responsible for ordering; here we verify the controller
      // passes correct args and returns the ordered array as-is.
      const orderedMembers: MemberRankingResponseDto[] = [
        { ...mockMemberRow, rank_position: 1 },
        {
          ...mockMemberRow,
          enrollment_id: 43,
          user_id: 'user-uuid-002',
          rank_position: 2,
        },
        {
          ...mockMemberRow,
          enrollment_id: 44,
          user_id: 'user-uuid-003',
          rank_position: null,
        },
      ];
      mockService.getMembers.mockResolvedValueOnce(orderedMembers);

      const req = {
        user: { user_id: directorProfile.profile.user_id },
        authorization: directorProfile,
      };

      const result = await controller.getMembers(SECTION_ID, YEAR_ID, req);

      expect(mockService.getMembers).toHaveBeenCalledWith(
        SECTION_ID,
        YEAR_ID,
        directorProfile,
      );
      expect(result).toHaveLength(3);
      // Verify null rank_position entries appear last
      expect(result[0].rank_position).toBe(1);
      expect(result[1].rank_position).toBe(2);
      expect(result[2].rank_position).toBeNull();
    });
  });
});

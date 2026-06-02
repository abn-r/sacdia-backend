import { Test, TestingModule } from '@nestjs/testing';
import { RankingsController } from '../rankings.controller';
import { RankingsService } from '../rankings.service';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import {
  AuthorizationContextService,
  type ResolvedAuthorizationProfile,
} from '../../common/services/authorization-context.service';
import { InstitutionalHierarchyService } from '../../common/services/institutional-hierarchy.service';
import { AppForbiddenException } from '../../common/errors/app.exception';

/**
 * Unit tests for RankingsController.
 *
 * Guards are overridden so no real auth infrastructure is needed.
 * The test exercises handler methods directly without HTTP overhead.
 */
describe('RankingsController', () => {
  let controller: RankingsController;
  let rankingsService: jest.Mocked<
    Pick<
      RankingsService,
      | 'getRankings'
      | 'getRankingForClub'
      | 'getBreakdown'
      | 'recalculateRankings'
    >
  >;
  let authorizationContext: jest.Mocked<
    Pick<AuthorizationContextService, 'canAccessHierarchyScope'>
  >;
  let hierarchy: jest.Mocked<
    Pick<InstitutionalHierarchyService, 'resolveCurrent'>
  >;

  beforeEach(async () => {
    rankingsService = {
      getRankings: jest.fn(),
      getRankingForClub: jest.fn(),
      getBreakdown: jest.fn(),
      recalculateRankings: jest.fn(),
    };
    authorizationContext = {
      canAccessHierarchyScope: jest.fn(),
    };
    hierarchy = {
      resolveCurrent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RankingsController],
      providers: [
        {
          provide: RankingsService,
          useValue: rankingsService,
        },
        {
          provide: AuthorizationContextService,
          useValue: authorizationContext,
        },
        {
          provide: InstitutionalHierarchyService,
          useValue: hierarchy,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<RankingsController>(RankingsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('controller is defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET rankings', () => {
    it('passes optional local_field_id to the rankings service', async () => {
      rankingsService.getRankings.mockResolvedValueOnce([]);

      const result = await controller.getRankings('2', '2026', undefined, '10');

      expect(result).toEqual({ status: 'success', data: [] });
      expect(rankingsService.getRankings).toHaveBeenCalledWith(
        2,
        2026,
        undefined,
        10,
      );
    });

    it('defaults rankings to the authenticated local field scope when local_field_id is omitted', async () => {
      rankingsService.getRankings.mockResolvedValueOnce([]);

      const result = await controller.getRankings(
        '2',
        '2026',
        undefined,
        undefined,
        {
          authorizationProfile: makeAuthorizationProfile({ localFieldId: 10 }),
        },
      );

      expect(result).toEqual({ status: 'success', data: [] });
      expect(rankingsService.getRankings).toHaveBeenCalledWith(
        2,
        2026,
        undefined,
        10,
      );
      expect(hierarchy.resolveCurrent).not.toHaveBeenCalled();
    });

    it('defaults rankings to the active club assignment local field before the profile local field', async () => {
      rankingsService.getRankings.mockResolvedValueOnce([]);

      const result = await controller.getRankings(
        '2',
        '2026',
        undefined,
        undefined,
        {
          authorizationProfile: makeAuthorizationProfile({
            localFieldId: 99,
            activeClubLocalFieldId: 10,
          }),
        },
      );

      expect(result).toEqual({ status: 'success', data: [] });
      expect(rankingsService.getRankings).toHaveBeenCalledWith(
        2,
        2026,
        undefined,
        10,
      );
      expect(hierarchy.resolveCurrent).not.toHaveBeenCalled();
    });

    it('allows an explicit local_field_id when the authenticated profile can read that hierarchy scope', async () => {
      rankingsService.getRankings.mockResolvedValueOnce([]);
      hierarchy.resolveCurrent.mockResolvedValueOnce({
        division_id: 1,
        union_id: 5,
        local_field_id: 99,
        as_of: new Date('2026-01-01T00:00:00Z'),
        source: 'current',
        precision: 'exact',
      });
      authorizationContext.canAccessHierarchyScope.mockReturnValueOnce(true);

      await controller.getRankings('2', '2026', undefined, '99', {
        authorizationProfile: makeAuthorizationProfile({ unionId: 5 }),
      });

      expect(hierarchy.resolveCurrent).toHaveBeenCalledWith({
        localFieldId: 99,
      });
      expect(authorizationContext.canAccessHierarchyScope).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ local_field_id: 99, union_id: 5 }),
        'historical-read',
      );
      expect(rankingsService.getRankings).toHaveBeenCalledWith(
        2,
        2026,
        undefined,
        99,
      );
    });

    it('allows an explicit local_field_id matching the active club assignment field', async () => {
      rankingsService.getRankings.mockResolvedValueOnce([]);

      await controller.getRankings('2', '2026', undefined, '10', {
        authorizationProfile: makeAuthorizationProfile({
          localFieldId: 99,
          activeClubLocalFieldId: 10,
        }),
      });

      expect(rankingsService.getRankings).toHaveBeenCalledWith(
        2,
        2026,
        undefined,
        10,
      );
      expect(hierarchy.resolveCurrent).not.toHaveBeenCalled();
      expect(
        authorizationContext.canAccessHierarchyScope,
      ).not.toHaveBeenCalled();
    });

    it('rejects an explicit local_field_id outside the authenticated hierarchy scope', async () => {
      hierarchy.resolveCurrent.mockResolvedValueOnce({
        division_id: 1,
        union_id: 5,
        local_field_id: 99,
        as_of: new Date('2026-01-01T00:00:00Z'),
        source: 'current',
        precision: 'exact',
      });
      authorizationContext.canAccessHierarchyScope.mockReturnValueOnce(false);

      await expect(
        controller.getRankings('2', '2026', undefined, '99', {
          authorizationProfile: makeAuthorizationProfile({ localFieldId: 10 }),
        }),
      ).rejects.toBeInstanceOf(AppForbiddenException);

      expect(rankingsService.getRankings).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // getBreakdown
  // ---------------------------------------------------------------
  describe('GET :enrollmentId/breakdown', () => {
    it('returns composite + 4 components and delegates to rankingsService.getBreakdown', async () => {
      const breakdown = {
        enrollment_id: 'enrollment-uuid',
        year_id: 1,
        composite_score_pct: 80,
        weights_applied: {
          folder: 60,
          finance: 15,
          camporee: 15,
          evidence: 10,
          source: 'default' as const,
        },
        components: {
          folder: {
            score_pct: 80,
            earned_points: 80,
            max_points: 100,
            sections_evaluated: 5,
          },
          finance: {
            score_pct: 100,
            months_closed_on_time: 12,
            months_total: 12,
            deadline_day: 5,
            missed_months: [],
          },
          camporee: {
            score_pct: 50,
            attended: 1,
            available_in_scope: 2,
            events: [],
          },
          evidence: {
            score_pct: 100,
            validated: 10,
            rejected: 0,
            pending_excluded: 0,
          },
        },
      };

      rankingsService.getBreakdown.mockResolvedValueOnce(breakdown);

      const result = await controller.getBreakdown('enrollment-uuid', 1);

      expect(result.composite_score_pct).toBe(80);
      expect(result.components.folder.score_pct).toBe(80);
      expect(result.components.finance.missed_months).toEqual([]);
      expect(result.components.camporee.attended).toBe(1);
      expect(result.components.evidence.validated).toBe(10);
      expect(result.weights_applied.source).toBe('default');
      expect(rankingsService.getBreakdown).toHaveBeenCalledWith(
        'enrollment-uuid',
        1,
      );
    });

    it('propagates errors thrown by rankingsService.getBreakdown', async () => {
      rankingsService.getBreakdown.mockRejectedValueOnce(
        new Error('enrollment not found'),
      );

      await expect(controller.getBreakdown('missing-uuid', 99)).rejects.toThrow(
        'enrollment not found',
      );
    });
  });
});

function makeAuthorizationProfile({
  localFieldId = null,
  unionId = null,
  roleName = 'director-lf',
  activeClubLocalFieldId = null,
}: {
  localFieldId?: number | null;
  unionId?: number | null;
  roleName?: string;
  activeClubLocalFieldId?: number | null;
}): ResolvedAuthorizationProfile {
  const activeClubAssignment =
    activeClubLocalFieldId === null
      ? null
      : {
          assignment_id: 'active-assignment-1',
          role_name: 'director',
          permissions: ['rankings:read'],
          club: {
            club_id: 1,
            club_name: 'Club Amanecer',
          },
          section: {
            club_section_id: 2,
            club_type_name: 'Conquistadores',
          },
          scope: {
            local_field: { id: activeClubLocalFieldId, name: 'Campo activo' },
          },
          status: 'active',
          start_date: null,
          end_date: null,
        };
  const legacyActiveClubAssignment = activeClubAssignment
    ? {
        assignment_id: activeClubAssignment.assignment_id,
        role_name: activeClubAssignment.role_name,
        club_section_id: activeClubAssignment.section.club_section_id,
        club_id: activeClubAssignment.club.club_id,
        club_name: activeClubAssignment.club.club_name,
        club_type: activeClubAssignment.section.club_type_name,
      }
    : null;

  return {
    profile: {
      user_id: 'user-id',
      email: 'director@example.com',
      name: 'Directora',
      paternal_last_name: null,
      maternal_last_name: null,
      gender: null,
      birthday: null,
      baptism: false,
      baptism_date: null,
      blood: null,
      user_image: null,
      country_id: null,
      union_id: unionId,
      local_field_id: localFieldId,
      created_at: new Date('2026-01-01T00:00:00Z'),
    },
    post_register_complete: true,
    authorization: {
      grants: {
        global_roles: [
          {
            role_name: roleName,
            permissions: ['rankings:read'],
            scope: {
              ...(unionId !== null
                ? { union: { id: unionId, name: 'Unión' } }
                : {}),
              ...(localFieldId !== null
                ? { local_field: { id: localFieldId, name: 'Campo' } }
                : {}),
            },
          },
        ],
        club_assignments: activeClubAssignment ? [activeClubAssignment] : [],
      },
      active_assignment: {
        assignment_id: activeClubAssignment?.assignment_id ?? null,
      },
      effective: {
        permissions: ['rankings:read'],
        scope: {
          global: {
            ...(unionId !== null
              ? { union: { id: unionId, name: 'Unión' } }
              : {}),
            ...(localFieldId !== null
              ? { local_field: { id: localFieldId, name: 'Campo' } }
              : {}),
          },
          club: activeClubAssignment
            ? {
                assignment_id: activeClubAssignment.assignment_id,
                role_name: activeClubAssignment.role_name,
                club: activeClubAssignment.club,
                section: activeClubAssignment.section,
              }
            : null,
        },
      },
    },
    legacy: {
      roles: [roleName],
      permissions: ['rankings:read'],
      club: activeClubAssignment
        ? {
            club_id: activeClubAssignment.club.club_id,
            club_name: activeClubAssignment.club.club_name,
            club_type: activeClubAssignment.section.club_type_name,
          }
        : null,
      club_context: {
        active_assignment_id: activeClubAssignment?.assignment_id ?? null,
        active: legacyActiveClubAssignment,
        available: legacyActiveClubAssignment
          ? [legacyActiveClubAssignment]
          : [],
      },
    },
  };
}

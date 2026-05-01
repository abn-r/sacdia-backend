import { Test, TestingModule } from '@nestjs/testing';
import { RankingsController } from '../rankings.controller';
import { RankingsService } from '../rankings.service';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';

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

  beforeEach(async () => {
    rankingsService = {
      getRankings: jest.fn(),
      getRankingForClub: jest.fn(),
      getBreakdown: jest.fn(),
      recalculateRankings: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RankingsController],
      providers: [
        {
          provide: RankingsService,
          useValue: rankingsService,
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

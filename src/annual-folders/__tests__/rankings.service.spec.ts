import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { RankingsService, GENERAL_CATEGORY_ID } from '../rankings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DistributedLockService } from '../../common/services/distributed-lock.service';
import { CronRunLogger } from '../../common/services/cron-run-logger.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { MemberCompositeScoreService } from '../../rankings/member-rankings/services/member-composite-score.service';
import { SectionAggregationService } from '../../rankings/section-rankings/services/section-aggregation.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { FolderScoreService } from '../score-calculators/folder-score';
import { FinanceScoreService } from '../score-calculators/finance-score';
import { CamporeeScoreService } from '../score-calculators/camporee-score';
import { EvidenceScoreService } from '../score-calculators/evidence-score';
import { WeightsResolverService } from '../score-calculators/weights-resolver';
import { CompositeScoreService } from '../score-calculators/composite-score';

describe('RankingsService', () => {
  let service: RankingsService;

  // Forward-declare so we can reference it inside $transaction
  let mockPrismaService: {
    $transaction: jest.Mock;
    $executeRaw: jest.Mock;
    ecclesiastical_years: { findUnique: jest.Mock; findFirst: jest.Mock };
    annual_folders: { findMany: jest.Mock };
    award_categories: { findMany: jest.Mock };
    system_config: { findUnique: jest.Mock };
    club_annual_rankings: {
      upsert: jest.Mock;
      deleteMany: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    club_enrollments: { findUnique: jest.Mock };
    clubs: { findMany: jest.Mock };
    club_sections: { findMany: jest.Mock };
    classes: { findMany: jest.Mock };
    enrollments: { findMany: jest.Mock };
    enrollmentRanking: { upsert: jest.Mock; aggregate: jest.Mock };
    sectionRanking: { upsert: jest.Mock };
  };

  let mockMemberCompositeScore: { calculate: jest.Mock };
  let mockSectionAggregation: { aggregate: jest.Mock };
  let mockSystemConfig: { get: jest.Mock };

  // $transaction passes the same mock as the transaction client so all
  // individual table mocks are accessible inside the callback.
  mockPrismaService = {
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrismaService)),
    $executeRaw: jest.fn().mockResolvedValue(0),
    ecclesiastical_years: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    annual_folders: {
      findMany: jest.fn(),
    },
    award_categories: {
      findMany: jest.fn(),
    },
    system_config: {
      findUnique: jest.fn(),
    },
    club_annual_rankings: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    club_enrollments: {
      findUnique: jest.fn(),
    },
    clubs: {
      findMany: jest.fn(),
    },
    club_sections: {
      findMany: jest.fn(),
    },
    classes: {
      findMany: jest.fn(),
    },
    enrollments: {
      findMany: jest.fn(),
    },
    enrollmentRanking: {
      upsert: jest.fn(),
      aggregate: jest.fn(),
    },
    sectionRanking: {
      upsert: jest.fn(),
    },
  };

  mockMemberCompositeScore = { calculate: jest.fn() };
  mockSectionAggregation = { aggregate: jest.fn() };
  // Default: get() returns null → kill-switches disabled (feature ON by default)
  mockSystemConfig = { get: jest.fn().mockResolvedValue(null) };

  // Score calculator mocks — defaults reset in beforeEach after clearAllMocks
  const folderScore = { calc: jest.fn() };
  const financeScore = { calc: jest.fn() };
  const camporeeScore = { calc: jest.fn() };
  const evidenceScore = { calc: jest.fn() };
  const weightsResolver = { resolve: jest.fn() };
  const compositeScore = { compose: jest.fn() };

  // ---------------------------------------------------------------
  // Active year fixture reused across multiple tests
  // ---------------------------------------------------------------
  const mockActiveYear = {
    year_id: 2026,
    name: '2026',
    active: true,
    start_date: new Date('2026-01-01'),
  };

  // ---------------------------------------------------------------
  // Club hierarchy fixture reused across folder builders
  // ---------------------------------------------------------------
  const clubHierarchy = {
    club_enrollment_id: 'enroll-1',
    club_section: {
      club_type_id: 2,
      main_club_id: 10,
      clubs: {
        club_id: 10,
        local_field_id: 1,
        local_fields: {
          local_field_id: 1,
          union_id: 5,
        },
      },
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Reset new service mocks to their defaults after clearAllMocks
    mockMemberCompositeScore.calculate.mockResolvedValue(null);
    mockSectionAggregation.aggregate.mockResolvedValue({
      composite_score_pct: null,
      active_enrollment_count: 0,
    });
    mockSystemConfig.get.mockResolvedValue(null);
    mockPrismaService.$executeRaw.mockResolvedValue(0);

    // Re-establish default return values for score calculator mocks
    folderScore.calc.mockResolvedValue(0);
    financeScore.calc.mockResolvedValue(0);
    camporeeScore.calc.mockResolvedValue(0);
    evidenceScore.calc.mockResolvedValue(0);
    weightsResolver.resolve.mockResolvedValue({
      folder: 60,
      finance: 15,
      camporee: 15,
      evidence: 10,
      source: 'default',
    });
    compositeScore.compose.mockReturnValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RankingsService,
        { provide: PrismaService, useValue: mockPrismaService },
        // SchedulerRegistry is needed by @Cron decorator (NestJS schedule)
        {
          provide: SchedulerRegistry,
          useValue: { addCronJob: jest.fn(), getCronJob: jest.fn() },
        },
        {
          provide: DistributedLockService,
          useValue: {
            tryAcquire: jest.fn().mockResolvedValue(true),
            release: jest.fn(),
          },
        },
        {
          provide: CronRunLogger,
          useValue: {
            track: jest
              .fn()
              .mockImplementation((_key: string, fn: () => Promise<unknown>) =>
                fn(),
              ),
          },
        },
        {
          provide: MemberCompositeScoreService,
          useValue: mockMemberCompositeScore,
        },
        {
          provide: SectionAggregationService,
          useValue: mockSectionAggregation,
        },
        {
          provide: SystemConfigService,
          useValue: mockSystemConfig,
        },
        { provide: FolderScoreService, useValue: folderScore },
        { provide: FinanceScoreService, useValue: financeScore },
        { provide: CamporeeScoreService, useValue: camporeeScore },
        { provide: EvidenceScoreService, useValue: evidenceScore },
        { provide: WeightsResolverService, useValue: weightsResolver },
        { provide: CompositeScoreService, useValue: compositeScore },
      ],
    }).compile();

    service = module.get<RankingsService>(RankingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ================================================================
  // recalculateRankings
  // ================================================================

  describe('recalculateRankings', () => {
    const buildFolder = (
      id: string,
      clubEnrollmentId: string,
      earned: number,
      max: number,
      pct: number,
      clubTypeId = 2,
    ) => ({
      annual_folder_id: id,
      club_enrollment_id: clubEnrollmentId,
      total_earned_points: earned,
      total_max_points: max,
      progress_percentage: pct,
      folder_template: {
        club_type_id: clubTypeId,
        ecclesiastical_year_id: 2026,
      },
      club_enrollment: {
        ...clubHierarchy,
        club_enrollment_id: clubEnrollmentId,
      },
    });

    it('should use current active year when yearId not provided', async () => {
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(
        mockActiveYear,
      );
      mockPrismaService.annual_folders.findMany.mockResolvedValue([]);

      await service.recalculateRankings();

      expect(
        mockPrismaService.ecclesiastical_years.findFirst,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ where: { active: true } }),
      );
    });

    it('should use provided yearId when given', async () => {
      mockPrismaService.ecclesiastical_years.findUnique.mockResolvedValue(
        mockActiveYear,
      );
      mockPrismaService.annual_folders.findMany.mockResolvedValue([]);

      await service.recalculateRankings(2026);

      expect(
        mockPrismaService.ecclesiastical_years.findUnique,
      ).toHaveBeenCalledWith({
        where: { year_id: 2026 },
      });
    });

    it('should throw NotFoundException when provided yearId does not exist', async () => {
      mockPrismaService.ecclesiastical_years.findUnique.mockResolvedValue(null);

      await expect(service.recalculateRankings(9999)).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_YEAR_NOT_FOUND,
      });
    });

    it('should throw NotFoundException when no active year exists', async () => {
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(null);

      await expect(service.recalculateRankings()).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_YEAR_NOT_FOUND,
      });
    });

    it('should return { updated: 0 } when no evaluated/closed folders exist', async () => {
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(
        mockActiveYear,
      );
      mockPrismaService.annual_folders.findMany.mockResolvedValue([]);

      const result = await service.recalculateRankings();

      expect(result).toEqual({ updated: 0 });
      expect(
        mockPrismaService.club_annual_rankings.upsert,
      ).not.toHaveBeenCalled();
    });

    it('should create general ranking (no category) for each evaluated folder', async () => {
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(
        mockActiveYear,
      );
      mockPrismaService.annual_folders.findMany.mockResolvedValue([
        buildFolder('folder-1', 'enroll-1', 90, 100, 90),
      ]);
      mockPrismaService.award_categories.findMany.mockResolvedValue([]);
      mockPrismaService.club_annual_rankings.upsert.mockResolvedValue({});
      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue([]);

      const result = await service.recalculateRankings();

      // One general ranking upsert
      expect(
        mockPrismaService.club_annual_rankings.upsert,
      ).toHaveBeenCalledTimes(1);
      // General rankings now use the sentinel UUID instead of NULL
      expect(
        mockPrismaService.club_annual_rankings.upsert,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            club_enrollment_id_ecclesiastical_year_id_award_category_id:
              expect.objectContaining({
                award_category_id: GENERAL_CATEGORY_ID,
              }),
          }),
          create: expect.objectContaining({
            award_category_id: GENERAL_CATEGORY_ID,
            club_enrollment_id: 'enroll-1',
          }),
        }),
      );
      expect(result.updated).toBe(1);
    });

    it('should create category-specific rankings when composite qualifies (non-legacy)', async () => {
      compositeScore.compose.mockReturnValue(85);
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(
        mockActiveYear,
      );
      mockPrismaService.annual_folders.findMany.mockResolvedValue([
        buildFolder('folder-1', 'enroll-1', 90, 100, 90, 2),
      ]);
      mockPrismaService.award_categories.findMany.mockResolvedValue([
        {
          award_category_id: 'cat-gold',
          name: 'Oro',
          min_points: 0,
          max_points: null,
          min_composite_pct: 80,
          max_composite_pct: null,
          is_legacy: false,
          club_type_id: null, // applies to all club types
        },
      ]);
      mockPrismaService.club_annual_rankings.upsert.mockResolvedValue({});
      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue([]);

      const result = await service.recalculateRankings();

      // 1 general + 1 category = 2 upserts
      expect(
        mockPrismaService.club_annual_rankings.upsert,
      ).toHaveBeenCalledTimes(2);
      const categoryUpsert =
        mockPrismaService.club_annual_rankings.upsert.mock.calls.find(
          ([call]) => call.create?.award_category_id === 'cat-gold',
        );
      expect(categoryUpsert).toBeDefined();
      expect(result.updated).toBe(2);
    });

    it('should create legacy category rankings when points qualify (is_legacy = true)', async () => {
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(
        mockActiveYear,
      );
      mockPrismaService.annual_folders.findMany.mockResolvedValue([
        buildFolder('folder-1', 'enroll-1', 90, 100, 90, 2),
      ]);
      mockPrismaService.award_categories.findMany.mockResolvedValue([
        {
          award_category_id: 'cat-legacy',
          name: 'Legacy Oro',
          min_points: 80,
          max_points: null,
          min_composite_pct: null,
          max_composite_pct: null,
          is_legacy: true,
          club_type_id: null,
        },
      ]);
      mockPrismaService.club_annual_rankings.upsert.mockResolvedValue({});
      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue([]);

      const result = await service.recalculateRankings();

      // 1 general + 1 legacy category = 2 upserts
      expect(result.updated).toBe(2);
    });

    it('should delete category rankings when points no longer qualify (idempotent)', async () => {
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(
        mockActiveYear,
      );
      mockPrismaService.annual_folders.findMany.mockResolvedValue([
        buildFolder('folder-1', 'enroll-1', 50, 100, 50, 2), // 50 points — below min_points=80
      ]);
      mockPrismaService.award_categories.findMany.mockResolvedValue([
        {
          award_category_id: 'cat-gold',
          name: 'Oro',
          min_points: 80,
          max_points: null,
          min_composite_pct: null,
          max_composite_pct: null,
          is_legacy: true,
          club_type_id: null,
        },
      ]);
      mockPrismaService.club_annual_rankings.upsert.mockResolvedValue({});
      mockPrismaService.club_annual_rankings.deleteMany.mockResolvedValue({
        count: 0,
      });
      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue([]);

      await service.recalculateRankings();

      // Should deleteMany stale category ranking
      expect(
        mockPrismaService.club_annual_rankings.deleteMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            club_enrollment_id: 'enroll-1',
            award_category_id: 'cat-gold',
          }),
        }),
      );
    });

    it('should NOT create category ranking when club_type_id does not match category', async () => {
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(
        mockActiveYear,
      );
      mockPrismaService.annual_folders.findMany.mockResolvedValue([
        buildFolder('folder-1', 'enroll-1', 90, 100, 90, 2), // club type = 2
      ]);
      mockPrismaService.award_categories.findMany.mockResolvedValue([
        {
          award_category_id: 'cat-specific',
          name: 'Solo Aventureros',
          min_points: 80,
          max_points: null,
          min_composite_pct: null,
          max_composite_pct: null,
          is_legacy: true,
          club_type_id: 3, // only applies to club type 3
        },
      ]);
      mockPrismaService.club_annual_rankings.upsert.mockResolvedValue({});
      mockPrismaService.club_annual_rankings.deleteMany.mockResolvedValue({
        count: 0,
      });
      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue([]);

      const result = await service.recalculateRankings();

      // Only 1 upsert: the general ranking; category is filtered out
      expect(
        mockPrismaService.club_annual_rankings.upsert,
      ).toHaveBeenCalledTimes(1);
      expect(result.updated).toBe(1);
    });

    it('should assign dense rank positions using composite_score_pct (ties get same rank)', async () => {
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(
        mockActiveYear,
      );
      mockPrismaService.annual_folders.findMany.mockResolvedValue([
        buildFolder('folder-1', 'enroll-1', 90, 100, 90, 2),
        buildFolder('folder-2', 'enroll-2', 90, 100, 90, 2), // tied with folder-1
        buildFolder('folder-3', 'enroll-3', 70, 100, 70, 2),
      ]);
      mockPrismaService.award_categories.findMany.mockResolvedValue([]);
      mockPrismaService.club_annual_rankings.upsert.mockResolvedValue({});

      // assignRankPositions now fetches composite_score_pct, ordered desc
      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue([
        {
          ranking_id: 'r-1',
          club_type_id: 2,
          award_category_id: GENERAL_CATEGORY_ID,
          composite_score_pct: 90,
        },
        {
          ranking_id: 'r-2',
          club_type_id: 2,
          award_category_id: GENERAL_CATEGORY_ID,
          composite_score_pct: 90,
        },
        {
          ranking_id: 'r-3',
          club_type_id: 2,
          award_category_id: GENERAL_CATEGORY_ID,
          composite_score_pct: 70,
        },
      ]);
      mockPrismaService.club_annual_rankings.update.mockResolvedValue({});

      await service.recalculateRankings();

      // All three ranking records should be updated with rank positions
      expect(
        mockPrismaService.club_annual_rankings.update,
      ).toHaveBeenCalledTimes(3);

      const updateCalls =
        mockPrismaService.club_annual_rankings.update.mock.calls.map(
          ([call]) => ({
            ranking_id: call.where.ranking_id,
            rank_position: call.data.rank_position,
          }),
        );

      // Dense ranking: r-1 and r-2 tied → both rank 1; r-3 is next → rank 2 (not 3)
      const r1 = updateCalls.find((c) => c.ranking_id === 'r-1');
      const r2 = updateCalls.find((c) => c.ranking_id === 'r-2');
      const r3 = updateCalls.find((c) => c.ranking_id === 'r-3');

      expect(r1?.rank_position).toBe(1);
      expect(r2?.rank_position).toBe(1);
      expect(r3?.rank_position).toBe(2); // dense: 2, not 3
    });

    it('should handle max_points boundary (points equal to max_points still qualify) for legacy categories', async () => {
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(
        mockActiveYear,
      );
      mockPrismaService.annual_folders.findMany.mockResolvedValue([
        buildFolder('folder-1', 'enroll-1', 100, 100, 100, 2), // exactly at max
      ]);
      mockPrismaService.award_categories.findMany.mockResolvedValue([
        {
          award_category_id: 'cat-max',
          name: 'Perfecta',
          min_points: 80,
          max_points: 100,
          min_composite_pct: null,
          max_composite_pct: null,
          is_legacy: true,
          club_type_id: null,
        },
      ]);
      mockPrismaService.club_annual_rankings.upsert.mockResolvedValue({});
      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue([]);

      const result = await service.recalculateRankings();

      // 1 general + 1 category upsert (points = 100, max_points = 100 → qualifies)
      expect(result.updated).toBe(2);
    });

    it('should NOT qualify when points exceed max_points boundary for legacy categories', async () => {
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(
        mockActiveYear,
      );
      mockPrismaService.annual_folders.findMany.mockResolvedValue([
        buildFolder('folder-1', 'enroll-1', 110, 100, 110, 2), // above max
      ]);
      mockPrismaService.award_categories.findMany.mockResolvedValue([
        {
          award_category_id: 'cat-capped',
          name: 'Capped',
          min_points: 80,
          max_points: 100, // ceiling
          min_composite_pct: null,
          max_composite_pct: null,
          is_legacy: true,
          club_type_id: null,
        },
      ]);
      mockPrismaService.club_annual_rankings.upsert.mockResolvedValue({});
      mockPrismaService.club_annual_rankings.deleteMany.mockResolvedValue({
        count: 0,
      });
      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue([]);

      const result = await service.recalculateRankings();

      // Only 1 upsert: general ranking; category deleted because out of range
      expect(result.updated).toBe(1);
      expect(
        mockPrismaService.club_annual_rankings.deleteMany,
      ).toHaveBeenCalled();
    });

    // ================================================================
    // NEW TEST 1: Kill-switch returns early
    // ================================================================

    it('should return early when kill-switch is enabled (ranking.recalculation_enabled = false)', async () => {
      mockPrismaService.system_config.findUnique.mockResolvedValue({
        config_key: 'ranking.recalculation_enabled',
        config_value: 'false',
      });

      // Kill-switch now lives in recalculateRankings so both the cron path
      // and the manual HTTP path honor it.
      const result = await service.recalculateRankings();

      expect(result).toEqual({
        updated: 0,
        skipped: true,
        reason: 'kill-switch',
      });
      // Nothing should have been fetched or upserted
      expect(
        mockPrismaService.ecclesiastical_years.findFirst,
      ).not.toHaveBeenCalled();
      expect(
        mockPrismaService.club_annual_rankings.upsert,
      ).not.toHaveBeenCalled();
    });

    it('should NOT skip when kill-switch is absent (no system_config row)', async () => {
      mockPrismaService.system_config.findUnique.mockResolvedValue(null);
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(
        mockActiveYear,
      );
      mockPrismaService.annual_folders.findMany.mockResolvedValue([]);

      // Should proceed normally — no throw, no early return
      await expect(
        service.handleRankingsRecalculation(),
      ).resolves.not.toThrow();
    });

    // ================================================================
    // NEW TEST 2: Composite computation invokes the right services
    // ================================================================

    it('should invoke weightsResolver and compositeScore with correct args', async () => {
      folderScore.calc.mockResolvedValue(80);
      financeScore.calc.mockResolvedValue(70);
      camporeeScore.calc.mockResolvedValue(60);
      evidenceScore.calc.mockResolvedValue(90);
      weightsResolver.resolve.mockResolvedValue({
        folder: 40,
        finance: 20,
        camporee: 20,
        evidence: 20,
        source: 'club_type_override',
      });
      compositeScore.compose.mockReturnValue(76);

      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(
        mockActiveYear,
      );
      mockPrismaService.annual_folders.findMany.mockResolvedValue([
        buildFolder('folder-1', 'enroll-1', 90, 100, 90, 2),
      ]);
      mockPrismaService.award_categories.findMany.mockResolvedValue([]);
      mockPrismaService.club_annual_rankings.upsert.mockResolvedValue({});
      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue([]);

      await service.recalculateRankings();

      // weightsResolver called with the club type ID from folder_template
      expect(weightsResolver.resolve).toHaveBeenCalledWith(2);

      // compositeScore called with the 4 component scores + resolved weights
      expect(compositeScore.compose).toHaveBeenCalledWith(
        { folder: 80, finance: 70, camporee: 60, evidence: 90 },
        expect.objectContaining({
          folder: 40,
          finance: 20,
          camporee: 20,
          evidence: 20,
          source: 'club_type_override',
        }),
      );

      // The upsert should contain the composite result
      expect(
        mockPrismaService.club_annual_rankings.upsert,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            composite_score_pct: 76,
            folder_score_pct: 80,
            finance_score_pct: 70,
            camporee_score_pct: 60,
            evidence_score_pct: 90,
          }),
        }),
      );
    });
  });

  // ================================================================
  // getRankings
  // ================================================================

  describe('getRankings', () => {
    const mockRankingRecords = [
      {
        ranking_id: 'r-1',
        rank_position: 1,
        club_type_id: 2,
        ecclesiastical_year_id: 2026,
        award_category_id: null,
        total_earned_points: 90,
        total_max_points: 100,
        progress_percentage: 90,
        folder_score_pct: 88,
        finance_score_pct: 75,
        camporee_score_pct: 60,
        evidence_score_pct: 95,
        composite_score_pct: 82,
        composite_calculated_at: new Date('2026-01-15T10:00:00Z'),
        award_category: null,
        club_enrollment: {
          club_section: {
            clubs: { name: 'Club Alfa' },
          },
        },
      },
      {
        ranking_id: 'r-2',
        rank_position: 2,
        club_type_id: 2,
        ecclesiastical_year_id: 2026,
        award_category_id: null,
        total_earned_points: 70,
        total_max_points: 100,
        progress_percentage: 70,
        folder_score_pct: 65,
        finance_score_pct: 50,
        camporee_score_pct: 40,
        evidence_score_pct: 70,
        composite_score_pct: 60,
        composite_calculated_at: null,
        award_category: null,
        club_enrollment: {
          club_section: {
            clubs: { name: 'Club Beta' },
          },
        },
      },
    ];

    it('should return ranked clubs ordered by rank_position', async () => {
      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue(
        mockRankingRecords,
      );

      const result = await service.getRankings(2, 2026);

      expect(result).toHaveLength(2);
      expect(result[0].rank_position).toBe(1);
      expect(result[0].club_name).toBe('Club Alfa');
      expect(result[1].rank_position).toBe(2);
    });

    it('should include component and composite score fields in each entry', async () => {
      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue(
        mockRankingRecords,
      );

      const result = await service.getRankings(2, 2026);

      // First record has all score fields populated
      expect(result[0].folder_score_pct).toBe(88);
      expect(result[0].finance_score_pct).toBe(75);
      expect(result[0].camporee_score_pct).toBe(60);
      expect(result[0].evidence_score_pct).toBe(95);
      expect(result[0].composite_score_pct).toBe(82);
      expect(result[0].composite_calculated_at).toBe(
        '2026-01-15T10:00:00.000Z',
      );
      // Second record has null composite_calculated_at
      expect(result[1].composite_calculated_at).toBeNull();
    });

    it('should filter by club_type_id and year_id', async () => {
      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue(
        mockRankingRecords,
      );

      await service.getRankings(2, 2026);

      expect(
        mockPrismaService.club_annual_rankings.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            club_type_id: 2,
            ecclesiastical_year_id: 2026,
          }),
        }),
      );
    });

    it('should return general rankings when no category_id provided (uses sentinel UUID)', async () => {
      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue(
        mockRankingRecords,
      );

      await service.getRankings(2, 2026);

      // No categoryId → resolves to GENERAL_CATEGORY_ID sentinel, never NULL
      expect(
        mockPrismaService.club_annual_rankings.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            award_category_id: GENERAL_CATEGORY_ID,
          }),
        }),
      );
    });

    it('should filter by category_id when provided', async () => {
      const categoryRecords = [
        {
          ...mockRankingRecords[0],
          award_category_id: 'cat-gold',
          award_category: { name: 'Oro' },
        },
      ];
      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue(
        categoryRecords,
      );

      await service.getRankings(2, 2026, 'cat-gold');

      expect(
        mockPrismaService.club_annual_rankings.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ award_category_id: 'cat-gold' }),
        }),
      );
    });

    it('should map award_category_name from included relation', async () => {
      const recordsWithCategory = [
        {
          ...mockRankingRecords[0],
          award_category_id: 'cat-gold',
          award_category: { name: 'Oro' },
        },
      ];
      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue(
        recordsWithCategory,
      );

      const result = await service.getRankings(2, 2026, 'cat-gold');

      expect(result[0].award_category_name).toBe('Oro');
    });

    it('should return empty array when no rankings exist', async () => {
      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue([]);

      const result = await service.getRankings(2, 2026);

      expect(result).toHaveLength(0);
    });
  });

  // ================================================================
  // getRankingForClub
  // ================================================================

  describe('getRankingForClub', () => {
    const enrollmentId = 'enroll-uuid-1';

    it('should return general and category rankings for a club', async () => {
      mockPrismaService.club_enrollments.findUnique.mockResolvedValue({
        club_enrollment_id: enrollmentId,
      });

      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue([
        {
          ranking_id: 'r-gen',
          award_category_id: GENERAL_CATEGORY_ID, // sentinel UUID = "general" record
          rank_position: 2,
          total_earned_points: 85,
          total_max_points: 100,
          progress_percentage: 85,
          folder_score_pct: 80,
          finance_score_pct: 70,
          camporee_score_pct: 65,
          evidence_score_pct: 90,
          composite_score_pct: 77,
          composite_calculated_at: new Date('2026-02-01T08:00:00Z'),
          award_category: null,
        },
        {
          ranking_id: 'r-gold',
          award_category_id: 'cat-gold',
          rank_position: 1,
          total_earned_points: 85,
          total_max_points: 100,
          progress_percentage: 85,
          folder_score_pct: 80,
          finance_score_pct: 70,
          camporee_score_pct: 65,
          evidence_score_pct: 90,
          composite_score_pct: 77,
          composite_calculated_at: new Date('2026-02-01T08:00:00Z'),
          award_category: { award_category_id: 'cat-gold', name: 'Oro' },
        },
      ]);

      const result = await service.getRankingForClub(enrollmentId, 2026);

      expect(result.general).not.toBeNull();
      expect(result.general?.rank_position).toBe(2);
      expect(result.general?.folder_score_pct).toBe(80);
      expect(result.general?.composite_score_pct).toBe(77);
      expect(result.general?.composite_calculated_at).toBe(
        '2026-02-01T08:00:00.000Z',
      );
      expect(result.by_category).toHaveLength(1);
      expect(result.by_category[0].award_category_name).toBe('Oro');
      expect(result.by_category[0].folder_score_pct).toBe(80);
      expect(result.by_category[0].composite_score_pct).toBe(77);
    });

    it('should return null for general ranking when no general record exists', async () => {
      mockPrismaService.club_enrollments.findUnique.mockResolvedValue({
        club_enrollment_id: enrollmentId,
      });

      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue([
        {
          ranking_id: 'r-gold',
          award_category_id: 'cat-gold',
          rank_position: 1,
          total_earned_points: 90,
          total_max_points: 100,
          progress_percentage: 90,
          folder_score_pct: 88,
          finance_score_pct: 72,
          camporee_score_pct: 55,
          evidence_score_pct: 80,
          composite_score_pct: 81,
          composite_calculated_at: null,
          award_category: { award_category_id: 'cat-gold', name: 'Oro' },
        },
      ]);

      const result = await service.getRankingForClub(enrollmentId, 2026);

      expect(result.general).toBeNull();
      expect(result.by_category).toHaveLength(1);
    });

    it('should return empty by_category when no category rankings exist', async () => {
      mockPrismaService.club_enrollments.findUnique.mockResolvedValue({
        club_enrollment_id: enrollmentId,
      });

      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue([
        {
          ranking_id: 'r-gen',
          award_category_id: GENERAL_CATEGORY_ID, // sentinel UUID = "general" record
          rank_position: 3,
          total_earned_points: 60,
          total_max_points: 100,
          progress_percentage: 60,
          folder_score_pct: 55,
          finance_score_pct: 40,
          camporee_score_pct: 30,
          evidence_score_pct: 50,
          composite_score_pct: 48,
          composite_calculated_at: null,
          award_category: null,
        },
      ]);

      const result = await service.getRankingForClub(enrollmentId, 2026);

      expect(result.general).not.toBeNull();
      expect(result.by_category).toHaveLength(0);
    });

    it('should throw NotFoundException when enrollment does not exist', async () => {
      mockPrismaService.club_enrollments.findUnique.mockResolvedValue(null);

      await expect(
        service.getRankingForClub('non-existent', 2026),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_ENROLLMENT_FOR_RANKING_NOT_FOUND,
      });
    });

    it('should return both general and empty by_category when no rankings at all', async () => {
      mockPrismaService.club_enrollments.findUnique.mockResolvedValue({
        club_enrollment_id: enrollmentId,
      });

      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue([]);

      const result = await service.getRankingForClub(enrollmentId, 2026);

      expect(result.general).toBeNull();
      expect(result.by_category).toHaveLength(0);
    });
  });

  // ================================================================
  // 8.4-A integration — recalculateAll kill-switch + error propagation
  // ================================================================

  describe('rankings.service — 8.4-A integration', () => {
    beforeEach(() => {
      // Provide a default active year for resolveYear fallback
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(
        mockActiveYear,
      );
    });

    it('recalculateAll: skips enrollments+sections if global kill-switch off', async () => {
      mockSystemConfig.get.mockImplementation((key: string) => {
        if (key === 'ranking.recalculation_enabled')
          return Promise.resolve('false');
        return Promise.resolve(null);
      });

      // recalculateRankings requires these for its own execution — if it IS called
      // it would call findMany for folders. We spy on service methods instead.
      const recalcRankingsSpy = jest
        .spyOn(service, 'recalculateRankings')
        .mockResolvedValue({ updated: 0 });
      const recalcEnrollmentSpy = jest
        .spyOn(service, 'recalculateEnrollmentRankings')
        .mockResolvedValue(undefined);
      const recalcSectionSpy = jest
        .spyOn(service, 'recalculateSectionAggregates')
        .mockResolvedValue(undefined);

      await service.recalculateAll(2026);

      expect(recalcRankingsSpy).not.toHaveBeenCalled();
      expect(recalcEnrollmentSpy).not.toHaveBeenCalled();
      expect(recalcSectionSpy).not.toHaveBeenCalled();
    });

    it('recalculateAll: skips ONLY steps 2 and 3 if member kill-switch off', async () => {
      mockSystemConfig.get.mockImplementation((key: string) => {
        if (key === 'ranking.recalculation_enabled')
          return Promise.resolve('true');
        if (key === 'member_ranking.recalculation_enabled')
          return Promise.resolve('false');
        return Promise.resolve(null);
      });

      const recalcRankingsSpy = jest
        .spyOn(service, 'recalculateRankings')
        .mockResolvedValue({ updated: 5 });
      const recalcEnrollmentSpy = jest
        .spyOn(service, 'recalculateEnrollmentRankings')
        .mockResolvedValue(undefined);
      const recalcSectionSpy = jest
        .spyOn(service, 'recalculateSectionAggregates')
        .mockResolvedValue(undefined);

      await service.recalculateAll(2026);

      expect(recalcRankingsSpy).toHaveBeenCalledWith(2026);
      expect(recalcEnrollmentSpy).not.toHaveBeenCalled();
      expect(recalcSectionSpy).not.toHaveBeenCalled();
    });

    it('recalculateAll: continues to step 3 if step 2 throws', async () => {
      // Kill-switches both enabled (default null → feature on)
      jest
        .spyOn(service, 'recalculateRankings')
        .mockResolvedValue({ updated: 0 });
      jest
        .spyOn(service, 'recalculateEnrollmentRankings')
        .mockRejectedValue(new Error('step 2 boom'));
      const recalcSectionSpy = jest
        .spyOn(service, 'recalculateSectionAggregates')
        .mockResolvedValue(undefined);

      await expect(service.recalculateAll(2026)).resolves.toBeUndefined();
      expect(recalcSectionSpy).toHaveBeenCalled();
    });

    it('recalculateEnrollmentRankings: per-enrollment error skips, does not throw', async () => {
      mockPrismaService.ecclesiastical_years.findUnique.mockResolvedValue(
        mockActiveYear,
      );
      // 1 active club, 1 section with club_type_id 2
      mockPrismaService.clubs.findMany.mockResolvedValue([{ club_id: 10 }]);
      mockPrismaService.club_sections.findMany.mockResolvedValue([
        { club_section_id: 100, club_type_id: 2 },
      ]);
      mockPrismaService.classes.findMany.mockResolvedValue([
        { class_id: 5, club_type_id: 2 },
      ]);
      // 2 enrollments: first throws, second succeeds
      mockPrismaService.enrollments.findMany.mockResolvedValue([
        { enrollment_id: 1, user_id: 'uid-1', class_id: 5 },
        { enrollment_id: 2, user_id: 'uid-2', class_id: 5 },
      ]);
      mockMemberCompositeScore.calculate
        .mockRejectedValueOnce(new Error('enrollment 1 error'))
        .mockResolvedValueOnce({
          class_score_pct: 80,
          investiture_score_pct: 70,
          camporee_score_pct: 60,
          composite_score_pct: 72,
        });
      mockPrismaService.enrollmentRanking.upsert.mockResolvedValue({});

      await expect(
        service.recalculateEnrollmentRankings(2026),
      ).resolves.toBeUndefined();

      // Only the successful enrollment triggers an upsert
      expect(mockPrismaService.enrollmentRanking.upsert).toHaveBeenCalledTimes(
        1,
      );
    });

    it('recalculateSectionAggregates: per-section error skips', async () => {
      mockPrismaService.ecclesiastical_years.findUnique.mockResolvedValue(
        mockActiveYear,
      );
      mockPrismaService.club_sections.findMany.mockResolvedValue([
        { club_section_id: 200, main_club_id: 10 },
        { club_section_id: 201, main_club_id: 10 },
      ]);
      mockSectionAggregation.aggregate
        .mockRejectedValueOnce(new Error('section 200 error'))
        .mockResolvedValueOnce({
          composite_score_pct: 75,
          active_enrollment_count: 3,
        });
      mockPrismaService.sectionRanking.upsert.mockResolvedValue({});

      await expect(
        service.recalculateSectionAggregates(2026),
      ).resolves.toBeUndefined();

      // Only the successful section triggers an upsert
      expect(mockPrismaService.sectionRanking.upsert).toHaveBeenCalledTimes(1);
    });
  });

  // ================================================================
  // Task 27 — recalculateEnrollmentRankings delta mode
  // ================================================================

  describe('recalculateEnrollmentRankings — delta mode', () => {
    // Shared setup: 1 club → 1 section (type 2) → 1 class (id 5) → enrolled members
    const setupClubChain = () => {
      mockPrismaService.ecclesiastical_years.findUnique.mockResolvedValue(
        mockActiveYear,
      );
      mockPrismaService.clubs.findMany.mockResolvedValue([{ club_id: 10 }]);
      mockPrismaService.club_sections.findMany.mockResolvedValue([
        { club_section_id: 100, club_type_id: 2 },
      ]);
      mockPrismaService.classes.findMany.mockResolvedValue([
        { class_id: 5, club_type_id: 2 },
      ]);
      mockPrismaService.enrollmentRanking.upsert.mockResolvedValue({});
      mockMemberCompositeScore.calculate.mockResolvedValue({
        class_score_pct: 80,
        investiture_score_pct: 70,
        camporee_score_pct: 60,
        composite_score_pct: 72,
      });
    };

    it('mode=delta + previousRecalc set + enrollment last_progress > previousRecalc → processes enrollment', async () => {
      setupClubChain();
      const prevRecalc = new Date('2026-04-01T02:00:00Z');

      // Aggregate returns a previous recalc timestamp
      mockPrismaService.enrollmentRanking.aggregate.mockResolvedValue({
        _max: { composite_calculated_at: prevRecalc },
      });

      // findMany simulates DB returning only enrollments with last_progress_change > prevRecalc
      mockPrismaService.enrollments.findMany.mockResolvedValue([
        { enrollment_id: 1, user_id: 'uid-1', class_id: 5 },
      ]);

      await service.recalculateEnrollmentRankings(2026, 'delta');

      // Verify aggregate was called to determine previousRecalc
      expect(
        mockPrismaService.enrollmentRanking.aggregate,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ecclesiastical_year_id: 2026 },
          _max: { composite_calculated_at: true },
        }),
      );

      // Verify findMany was called with gt filter on last_progress_change
      expect(mockPrismaService.enrollments.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            last_progress_change: { gt: prevRecalc },
          }),
        }),
      );

      // The eligible enrollment was processed
      expect(mockPrismaService.enrollmentRanking.upsert).toHaveBeenCalledTimes(
        1,
      );
    });

    it('mode=delta + previousRecalc set + no enrollments pass filter → skips (upsert not called)', async () => {
      setupClubChain();
      const prevRecalc = new Date('2026-04-01T02:00:00Z');

      mockPrismaService.enrollmentRanking.aggregate.mockResolvedValue({
        _max: { composite_calculated_at: prevRecalc },
      });

      // findMany returns empty — no enrollment changed since prevRecalc
      mockPrismaService.enrollments.findMany.mockResolvedValue([]);

      await service.recalculateEnrollmentRankings(2026, 'delta');

      // Filter was applied
      expect(mockPrismaService.enrollments.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            last_progress_change: { gt: prevRecalc },
          }),
        }),
      );

      // Nothing to process — upsert never called
      expect(mockPrismaService.enrollmentRanking.upsert).not.toHaveBeenCalled();
    });

    it('mode=delta + previousRecalc null → falls back to full (no last_progress_change filter)', async () => {
      setupClubChain();

      // No prior recalc exists for this year
      mockPrismaService.enrollmentRanking.aggregate.mockResolvedValue({
        _max: { composite_calculated_at: null },
      });

      mockPrismaService.enrollments.findMany.mockResolvedValue([
        { enrollment_id: 1, user_id: 'uid-1', class_id: 5 },
      ]);

      await service.recalculateEnrollmentRankings(2026, 'delta');

      // findMany must NOT include last_progress_change filter (full mode fallback)
      const findManyCall =
        mockPrismaService.enrollments.findMany.mock.calls[0][0];
      expect(findManyCall.where).not.toHaveProperty('last_progress_change');

      // Enrollment was still processed (full mode behaviour)
      expect(mockPrismaService.enrollmentRanking.upsert).toHaveBeenCalledTimes(
        1,
      );
    });

    it('mode=full (default) → ignores last_progress_change, processes all enrollments', async () => {
      setupClubChain();

      // aggregate should NOT be called in full mode
      mockPrismaService.enrollments.findMany.mockResolvedValue([
        { enrollment_id: 1, user_id: 'uid-1', class_id: 5 },
        { enrollment_id: 2, user_id: 'uid-2', class_id: 5 },
      ]);

      await service.recalculateEnrollmentRankings(2026); // default mode = 'full'

      // aggregate is never called in full mode
      expect(
        mockPrismaService.enrollmentRanking.aggregate,
      ).not.toHaveBeenCalled();

      // findMany has no last_progress_change filter
      const findManyCall =
        mockPrismaService.enrollments.findMany.mock.calls[0][0];
      expect(findManyCall.where).not.toHaveProperty('last_progress_change');

      // Both enrollments processed
      expect(mockPrismaService.enrollmentRanking.upsert).toHaveBeenCalledTimes(
        2,
      );
    });

    it('mode=delta filter applied at Prisma query — WHERE clause includes gt: previousRecalc', async () => {
      setupClubChain();
      const prevRecalc = new Date('2026-03-15T02:00:00Z');

      mockPrismaService.enrollmentRanking.aggregate.mockResolvedValue({
        _max: { composite_calculated_at: prevRecalc },
      });
      mockPrismaService.enrollments.findMany.mockResolvedValue([
        { enrollment_id: 42, user_id: 'uid-42', class_id: 5 },
      ]);

      await service.recalculateEnrollmentRankings(2026, 'delta');

      // Verify the exact WHERE clause shape passed to Prisma
      expect(mockPrismaService.enrollments.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ecclesiastical_year_id: 2026,
            active: true,
            class_id: { in: [5] },
            last_progress_change: { gt: prevRecalc },
          }),
        }),
      );
    });
  });

  // ================================================================
  // DENSE_RANK — unit tests asserting $executeRaw call shape
  // ================================================================

  describe('rankings.service — DENSE_RANK', () => {
    it('updateEnrollmentRankPositions: calls $executeRaw with DENSE_RANK + NULLS LAST + enrollment_rankings table', async () => {
      await service['updateEnrollmentRankPositions'](2026);

      expect(mockPrismaService.$executeRaw).toHaveBeenCalledTimes(1);

      // Prisma $executeRaw is called with a tagged template literal — the first
      // argument is a TemplateStringsArray. We stringify the call args to inspect
      // the SQL fragments embedded in the template strings array.
      const callArgs = mockPrismaService.$executeRaw.mock.calls[0];
      const sqlStrings: string = (callArgs[0] as TemplateStringsArray).join(
        '__PARAM__',
      );

      expect(sqlStrings).toContain('DENSE_RANK()');
      expect(sqlStrings).toContain('NULLS LAST');
      expect(sqlStrings).toContain('enrollment_rankings');
      expect(sqlStrings).toContain('ecclesiastical_year_id');
      // Verify yearId 2026 is passed as a bound parameter (second element of call args)
      expect(callArgs[1]).toBe(2026);
    });

    it('updateSectionRankPositions: calls $executeRaw with DENSE_RANK + NULLS LAST + section_rankings table', async () => {
      await service['updateSectionRankPositions'](2026);

      expect(mockPrismaService.$executeRaw).toHaveBeenCalledTimes(1);

      const callArgs = mockPrismaService.$executeRaw.mock.calls[0];
      const sqlStrings: string = (callArgs[0] as TemplateStringsArray).join(
        '__PARAM__',
      );

      expect(sqlStrings).toContain('DENSE_RANK()');
      expect(sqlStrings).toContain('NULLS LAST');
      expect(sqlStrings).toContain('section_rankings');
      expect(sqlStrings).toContain('ecclesiastical_year_id');
      expect(callArgs[1]).toBe(2026);
    });
  });
});

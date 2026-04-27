import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { RankingsService, GENERAL_CATEGORY_ID } from '../rankings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DistributedLockService } from '../../common/services/distributed-lock.service';
import { CronRunLogger } from '../../common/services/cron-run-logger.service';
import { ErrorCode } from '../../common/errors/error-codes';

describe('RankingsService', () => {
  let service: RankingsService;

  // Forward-declare so we can reference it inside $transaction

  let mockPrismaService: {
    $transaction: jest.Mock;
    ecclesiastical_years: { findUnique: jest.Mock; findFirst: jest.Mock };
    annual_folders: { findMany: jest.Mock };
    award_categories: { findMany: jest.Mock };
    club_annual_rankings: {
      upsert: jest.Mock;
      deleteMany: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    club_enrollments: { findUnique: jest.Mock };
  };

  // $transaction passes the same mock as the transaction client so all
  // individual table mocks are accessible inside the callback.
  mockPrismaService = {
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrismaService)),
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
    club_annual_rankings: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    club_enrollments: {
      findUnique: jest.fn(),
    },
  };

  // ---------------------------------------------------------------
  // Active year fixture reused across multiple tests
  // ---------------------------------------------------------------
  const mockActiveYear = { year_id: 2026, name: '2026', active: true };

  beforeEach(async () => {
    jest.clearAllMocks();

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

    it('should create category-specific rankings when points qualify', async () => {
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
          min_points: 80,
          max_points: null,
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

    it('should assign dense rank positions (ties get same rank)', async () => {
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

      // assignRankPositions fetches all records for the year
      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue([
        {
          ranking_id: 'r-1',
          club_type_id: 2,
          award_category_id: GENERAL_CATEGORY_ID,
          total_earned_points: 90,
        },
        {
          ranking_id: 'r-2',
          club_type_id: 2,
          award_category_id: GENERAL_CATEGORY_ID,
          total_earned_points: 90,
        },
        {
          ranking_id: 'r-3',
          club_type_id: 2,
          award_category_id: GENERAL_CATEGORY_ID,
          total_earned_points: 70,
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
      // Dense:       [90, 90, 70] → [1, 1, 2]
      // Competition: [90, 90, 70] → [1, 1, 3]  ← NOT what we want
      const r1 = updateCalls.find((c) => c.ranking_id === 'r-1');
      const r2 = updateCalls.find((c) => c.ranking_id === 'r-2');
      const r3 = updateCalls.find((c) => c.ranking_id === 'r-3');

      expect(r1?.rank_position).toBe(1);
      expect(r2?.rank_position).toBe(1);
      expect(r3?.rank_position).toBe(2); // dense: 2, not 3
    });

    it('should handle max_points boundary (points equal to max_points still qualify)', async () => {
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
          club_type_id: null,
        },
      ]);
      mockPrismaService.club_annual_rankings.upsert.mockResolvedValue({});
      mockPrismaService.club_annual_rankings.findMany.mockResolvedValue([]);

      const result = await service.recalculateRankings();

      // 1 general + 1 category upsert (points = 100, max_points = 100 → qualifies)
      expect(result.updated).toBe(2);
    });

    it('should NOT qualify when points exceed max_points boundary', async () => {
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
          award_category: null,
        },
        {
          ranking_id: 'r-gold',
          award_category_id: 'cat-gold',
          rank_position: 1,
          total_earned_points: 85,
          total_max_points: 100,
          progress_percentage: 85,
          award_category: { award_category_id: 'cat-gold', name: 'Oro' },
        },
      ]);

      const result = await service.getRankingForClub(enrollmentId, 2026);

      expect(result.general).not.toBeNull();
      expect(result.general?.rank_position).toBe(2);
      expect(result.by_category).toHaveLength(1);
      expect(result.by_category[0].award_category_name).toBe('Oro');
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
});

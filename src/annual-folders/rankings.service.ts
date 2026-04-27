import {
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { DistributedLockService } from '../common/services/distributed-lock.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';
import {
  AppConflictException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { RANKINGS_QUEUE, RankingsTriggerJobData } from './rankings.processor';

/**
 * Sentinel UUID used as the award_category_id for "general" (no specific
 * category) ranking records.
 *
 * Background: award_category_id is non-nullable in the DB (default =
 * this UUID).  Using NULL was the original design but PostgreSQL treats
 * NULL != NULL, which breaks the @@unique constraint and makes Prisma
 * upsert impossible for the general case.  The sentinel UUID solves both
 * problems cleanly.
 */
export const GENERAL_CATEGORY_ID = '00000000-0000-0000-0000-000000000000';

export interface RankingEntry {
  rank_position: number | null;
  club_name: string;
  total_earned_points: number;
  total_max_points: number;
  progress_percentage: number;
  award_category_name: string | null;
}

export interface ClubRankingResult {
  general: {
    rank_position: number | null;
    total_earned_points: number;
    total_max_points: number;
    progress_percentage: number;
  } | null;
  by_category: {
    award_category_id: string;
    award_category_name: string;
    rank_position: number | null;
    total_earned_points: number;
    total_max_points: number;
    progress_percentage: number;
  }[];
}

export interface RecalculateResult {
  updated: number;
}

@Injectable()
export class RankingsService {
  private readonly logger = new Logger(RankingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lockService: DistributedLockService,
    private readonly cronLogger: CronRunLogger,
    @Optional()
    @InjectQueue(RANKINGS_QUEUE)
    private readonly rankingsQueue: Queue | null,
  ) {}

  // ========================================
  // CRON JOB — Nightly at 2:00 AM
  // ========================================

  @Cron('0 2 * * *', { name: 'annual-folders-rankings-recalc', timeZone: 'UTC' })
  async handleRankingsRecalculation() {
    this.logger.log('Rankings cron triggered — enqueuing BullMQ job...');

    if (this.rankingsQueue) {
      const jobData: RankingsTriggerJobData = {
        triggeredAt: new Date().toISOString(),
      };
      await this.rankingsQueue.add('recalculate', jobData, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 }, // 1 min → 2 → 4 → 8 → 16 min
        removeOnComplete: { age: 7 * 86_400 },
        removeOnFail: { age: 30 * 86_400 },
      });
      this.logger.log(
        'annual-folders-rankings-recalc job enqueued with 5 attempts + exponential backoff',
      );
    } else {
      // Redis unavailable — execute directly (no retry fallback)
      this.logger.warn(
        'BullMQ queue unavailable — running rankings recalculation directly (no retry)',
      );
      await this.cronLogger.track('rankings-recalculate', async () => {
        const result = await this.recalculateRankings();
        this.logger.log(`Rankings recalculated: ${result.updated} records`);
        return { itemsProcessed: result.updated };
      });
    }
  }

  // ========================================
  // CORE RECALCULATION
  // ========================================

  /**
   * Recalculate all rankings for a given ecclesiastical year (or the current active year).
   * This is idempotent — running it multiple times produces the same result.
   *
   * Steps:
   * 1. Resolve the year (default = active year).
   * 2. Fetch all annual_folders with status "evaluated" or "closed" for that year.
   * 3. Upsert a "general" ranking (award_category_id = null) for every folder.
   * 4. For each active award_category that matches the club's type (or null = all types):
   *    - Upsert ranking when points are within [min_points, max_points].
   *    - Delete the ranking when points fall outside the range.
   * 5. Assign dense rank_position per (club_type_id, year_id, award_category_id) group.
   * 6. Update calculated_at on all affected records.
   */
  async recalculateRankings(yearId?: number): Promise<RecalculateResult> {
    // 1. Resolve the ecclesiastical year (outside the transaction — read-only)
    const year = await this.resolveYear(yearId);

    // Acquire a per-year distributed lock so concurrent HTTP calls (or a
    // manual trigger that overlaps the nightly cron) cannot run the same
    // full-table transaction twice simultaneously.
    // TTL = 10 minutes — generous upper bound for worst-case runtime across
    // all folders in a single ecclesiastical year.
    const lockKey = `rankings:recalculate:${year.year_id}`;
    const acquired = await this.lockService.tryAcquire(lockKey, 10 * 60 * 1000);

    if (!acquired) {
      throw new AppConflictException(ErrorCode.ANNUAL_FOLDER_RANKINGS_LOCK_CONFLICT);
    }

    try {
      return await this._runRecalculation(year);
    } finally {
      await this.lockService.release(lockKey);
    }
  }

  /**
   * Internal implementation — runs after the lock has been acquired.
   * Separated so the lock acquire/release wrapper stays clean.
   */
  private async _runRecalculation(
    year: { year_id: number },
  ): Promise<RecalculateResult> {
    // 2. Fetch all evaluated/closed folders for that year, with club type
    const folders = await this.prisma.annual_folders.findMany({
      where: {
        status: { in: ['evaluated', 'closed'] },
        folder_template: { ecclesiastical_year_id: year.year_id },
      },
      select: {
        annual_folder_id: true,
        club_enrollment_id: true,
        total_earned_points: true,
        total_max_points: true,
        progress_percentage: true,
        folder_template: {
          select: {
            club_type_id: true,
            ecclesiastical_year_id: true,
          },
        },
      },
    });

    if (folders.length === 0) {
      this.logger.log(
        `No evaluated/closed folders found for year ${year.year_id}. No rankings to compute.`,
      );
      return { updated: 0 };
    }

    // 3. Fetch all active award categories
    const categories = await this.prisma.award_categories.findMany({
      where: { active: true },
      select: {
        award_category_id: true,
        name: true,
        min_points: true,
        max_points: true,
        club_type_id: true,
      },
    });

    // 4–5. All upserts/deletes + rank assignment run inside a single transaction
    //      so a partial failure never leaves rankings in an inconsistent state.
    const totalUpserted = await this.prisma.$transaction(async (tx) => {
      let upserted = 0;

      // 4. Process each folder: upsert general ranking + category-specific rankings
      for (const folder of folders) {
        const clubTypeId = folder.folder_template.club_type_id;
        const yearIdResolved = folder.folder_template.ecclesiastical_year_id;
        const earned = folder.total_earned_points;
        const max = folder.total_max_points;
        const pct = folder.progress_percentage;

        // 4a. General ranking — uses sentinel UUID instead of NULL so that the
        //     @@unique constraint works correctly in PostgreSQL (NULL != NULL).
        await tx.club_annual_rankings.upsert({
          where: {
            club_enrollment_id_ecclesiastical_year_id_award_category_id: {
              club_enrollment_id: folder.club_enrollment_id,
              ecclesiastical_year_id: yearIdResolved,
              award_category_id: GENERAL_CATEGORY_ID,
            },
          },
          update: {
            club_type_id: clubTypeId,
            total_earned_points: earned,
            total_max_points: max,
            progress_percentage: pct,
            calculated_at: new Date(),
          },
          create: {
            club_enrollment_id: folder.club_enrollment_id,
            club_type_id: clubTypeId,
            ecclesiastical_year_id: yearIdResolved,
            award_category_id: GENERAL_CATEGORY_ID,
            total_earned_points: earned,
            total_max_points: max,
            progress_percentage: pct,
            calculated_at: new Date(),
          },
        });
        upserted++;

        // 4b. Category-specific rankings
        const applicableCategories = categories.filter(
          (c) => c.club_type_id === null || c.club_type_id === clubTypeId,
        );

        for (const category of applicableCategories) {
          const qualifies =
            earned >= category.min_points &&
            (category.max_points === null || earned <= category.max_points);

          if (qualifies) {
            await tx.club_annual_rankings.upsert({
              where: {
                club_enrollment_id_ecclesiastical_year_id_award_category_id: {
                  club_enrollment_id: folder.club_enrollment_id,
                  ecclesiastical_year_id: yearIdResolved,
                  award_category_id: category.award_category_id,
                },
              },
              update: {
                club_type_id: clubTypeId,
                total_earned_points: earned,
                total_max_points: max,
                progress_percentage: pct,
                calculated_at: new Date(),
              },
              create: {
                club_enrollment_id: folder.club_enrollment_id,
                club_type_id: clubTypeId,
                ecclesiastical_year_id: yearIdResolved,
                award_category_id: category.award_category_id,
                total_earned_points: earned,
                total_max_points: max,
                progress_percentage: pct,
                calculated_at: new Date(),
              },
            });
            upserted++;
          } else {
            // Club no longer qualifies — remove stale ranking record if it exists
            await tx.club_annual_rankings.deleteMany({
              where: {
                club_enrollment_id: folder.club_enrollment_id,
                ecclesiastical_year_id: yearIdResolved,
                award_category_id: category.award_category_id,
              },
            });
          }
        }
      }

      // 5. Assign dense rank_position per (club_type_id, year_id, award_category_id) group
      await this.assignRankPositions(year.year_id, tx);

      return upserted;
    });

    return { updated: totalUpserted };
  }

  // ========================================
  // GET RANKINGS FOR A YEAR
  // ========================================

  /**
   * Returns the ranked list of clubs for a given club type and year.
   * categoryId = undefined → general rankings (award_category_id IS NULL).
   * categoryId = UUID       → rankings for that specific category.
   */
  async getRankings(
    clubTypeId: number,
    yearId: number,
    categoryId?: string,
  ): Promise<RankingEntry[]> {
    // When no categoryId is provided, filter by the sentinel UUID which
    // represents "general" rankings (formerly NULL).
    const resolvedCategoryId =
      categoryId !== undefined ? categoryId : GENERAL_CATEGORY_ID;

    const records = await this.prisma.club_annual_rankings.findMany({
      where: {
        club_type_id: clubTypeId,
        ecclesiastical_year_id: yearId,
        award_category_id: resolvedCategoryId,
      },
      orderBy: { rank_position: 'asc' },
      include: {
        award_category: {
          select: { name: true },
        },
        club_enrollment: {
          include: {
            club_section: {
              include: {
                clubs: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    return records.map((r) => ({
      rank_position: r.rank_position,
      club_name: r.club_enrollment.club_section.clubs?.name ?? 'Unknown',
      total_earned_points: r.total_earned_points,
      total_max_points: r.total_max_points,
      progress_percentage: r.progress_percentage,
      award_category_name: r.award_category?.name ?? null,
    }));
  }

  // ========================================
  // GET RANKINGS FOR A SINGLE CLUB ENROLLMENT
  // ========================================

  /**
   * Returns all ranking records (general + per category) for a given enrollment and year.
   */
  async getRankingForClub(
    clubEnrollmentId: string,
    yearId: number,
  ): Promise<ClubRankingResult> {
    // Validate enrollment exists
    const enrollment = await this.prisma.club_enrollments.findUnique({
      where: { club_enrollment_id: clubEnrollmentId },
    });

    if (!enrollment) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_ENROLLMENT_FOR_RANKING_NOT_FOUND, { id: clubEnrollmentId });
    }

    const records = await this.prisma.club_annual_rankings.findMany({
      where: {
        club_enrollment_id: clubEnrollmentId,
        ecclesiastical_year_id: yearId,
      },
      include: {
        award_category: { select: { award_category_id: true, name: true } },
      },
    });

    // Records with the sentinel UUID are "general" rankings (no specific category).
    // All other UUIDs are real award category rankings.
    const general =
      records.find((r) => r.award_category_id === GENERAL_CATEGORY_ID) ?? null;
    const byCategory = records.filter(
      (r) => r.award_category_id !== GENERAL_CATEGORY_ID,
    );

    return {
      general: general
        ? {
            rank_position: general.rank_position,
            total_earned_points: general.total_earned_points,
            total_max_points: general.total_max_points,
            progress_percentage: general.progress_percentage,
          }
        : null,
      by_category: byCategory.map((r) => ({
        award_category_id: r.award_category.award_category_id,
        award_category_name: r.award_category.name,
        rank_position: r.rank_position,
        total_earned_points: r.total_earned_points,
        total_max_points: r.total_max_points,
        progress_percentage: r.progress_percentage,
      })),
    };
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  /**
   * Resolves to the active ecclesiastical year if no yearId is provided.
   * Throws 404 if no active year is found when falling back to default.
   */
  private async resolveYear(yearId?: number) {
    if (yearId !== undefined) {
      const year = await this.prisma.ecclesiastical_years.findUnique({
        where: { year_id: yearId },
      });
      if (!year) {
        throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_YEAR_NOT_FOUND, { id: yearId });
      }
      return year;
    }

    const activeYear = await this.prisma.ecclesiastical_years.findFirst({
      where: { active: true },
      orderBy: { year_id: 'desc' },
    });

    if (!activeYear) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_YEAR_NOT_FOUND, { id: 'active' });
    }

    return activeYear;
  }

  /**
   * Assigns dense rank positions for all ranking records belonging to the given year.
   *
   * Groups are defined by (club_type_id, ecclesiastical_year_id, award_category_id).
   * Within each group, clubs are ordered by total_earned_points DESC.
   * Ties receive the same rank — dense ranking: 1, 1, 2, 3 (not competition: 1, 1, 3, 4).
   *
   * Accepts an optional Prisma transaction client so it can run inside the
   * recalculateRankings transaction for full consistency.
   */
  private async assignRankPositions(
    yearId: number,
    tx?: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
  ): Promise<void> {
    const client = tx ?? this.prisma;

    // Fetch all ranking records for this year, grouped
    const allRecords = await client.club_annual_rankings.findMany({
      where: { ecclesiastical_year_id: yearId },
      select: {
        ranking_id: true,
        club_type_id: true,
        award_category_id: true,
        total_earned_points: true,
      },
      orderBy: { total_earned_points: 'desc' },
    });

    if (allRecords.length === 0) return;

    // Group by (club_type_id, award_category_id)
    const groups = new Map<string, typeof allRecords>();
    for (const record of allRecords) {
      const key = `${record.club_type_id}::${record.award_category_id ?? 'null'}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(record);
    }

    // Compute dense ranks per group and collect updates.
    // Dense ranking: after a tie group the next rank is prevRank + 1,
    // NOT i + 1 (which would produce competition/standard ranking).
    // Example with scores [90, 90, 70]: ranks → [1, 1, 2] (dense)
    //                                             not [1, 1, 3] (competition)
    const updates: { ranking_id: string; rank_position: number }[] = [];

    for (const group of groups.values()) {
      // group is already sorted desc by total_earned_points (from the query orderBy)
      let rank = 1;
      let prevPoints: number | null = null;
      let prevRank = 1;

      for (let i = 0; i < group.length; i++) {
        const record = group[i];
        if (prevPoints === null) {
          rank = 1;
        } else if (record.total_earned_points === prevPoints) {
          rank = prevRank; // tie — same rank as previous
        } else {
          rank = prevRank + 1; // dense ranking: next sequential rank after a tie group
        }
        prevPoints = record.total_earned_points;
        prevRank = rank;
        updates.push({ ranking_id: record.ranking_id, rank_position: rank });
      }
    }

    // Batch update rank positions
    await Promise.all(
      updates.map(({ ranking_id, rank_position }) =>
        client.club_annual_rankings.update({
          where: { ranking_id },
          data: { rank_position, calculated_at: new Date() },
        }),
      ),
    );
  }
}

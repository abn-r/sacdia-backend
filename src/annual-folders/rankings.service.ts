import { Injectable, Logger, Optional } from '@nestjs/common';
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
import {
  BACKGROUND_JOBS_QUEUE,
  BackgroundJobName,
  RankingsRecalculatePayload,
} from '../background-jobs/background-jobs.types';
import { FolderScoreService } from './score-calculators/folder-score';
import { FinanceScoreService } from './score-calculators/finance-score';
import { CamporeeScoreService } from './score-calculators/camporee-score';
import { EvidenceScoreService } from './score-calculators/evidence-score';
import { WeightsResolverService } from './score-calculators/weights-resolver';
import { CompositeScoreService } from './score-calculators/composite-score';

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
    @InjectQueue(BACKGROUND_JOBS_QUEUE)
    private readonly rankingsQueue: Queue | null,
    private readonly folderScore: FolderScoreService,
    private readonly financeScore: FinanceScoreService,
    private readonly camporeeScore: CamporeeScoreService,
    private readonly evidenceScore: EvidenceScoreService,
    private readonly weightsResolver: WeightsResolverService,
    private readonly compositeScore: CompositeScoreService,
  ) {}

  // ========================================
  // CRON JOB — Nightly at 2:00 AM
  // ========================================

  @Cron('0 2 * * *', {
    name: 'annual-folders-rankings-recalc',
    timeZone: 'UTC',
  })
  async handleRankingsRecalculation() {
    // Kill-switch: allow ops team to disable recalculation without a deploy
    const killSwitch = await this.prisma.system_config.findUnique({
      where: { config_key: 'ranking.recalculation_enabled' },
    });
    if (killSwitch && killSwitch.config_value === 'false') {
      this.logger.warn('Rankings recalculation skipped: kill-switch enabled');
      return;
    }

    this.logger.log('Rankings cron triggered — enqueuing BullMQ job...');

    if (this.rankingsQueue) {
      const jobData: RankingsRecalculatePayload = {
        triggeredAt: new Date().toISOString(),
      };
      await this.rankingsQueue.add(
        BackgroundJobName.RANKINGS_RECALCULATE,
        jobData,
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 60_000 }, // 1 min → 2 → 4 → 8 → 16 min
          removeOnComplete: { age: 7 * 86_400 },
          removeOnFail: { age: 30 * 86_400 },
        },
      );
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
   * 2. Fetch all annual_folders with status "evaluated" or "closed" for that year,
   *    including the club hierarchy needed for score calculators.
   * 3. Compute 4 component percentages (folder, finance, camporee, evidence) per enrollment.
   * 4. Resolve weights for the club type and compute the composite score.
   * 5. Upsert a "general" ranking (award_category_id = GENERAL_CATEGORY_ID) for every folder.
   * 6. For each non-legacy award_category with composite range [min_composite_pct, max_composite_pct]:
   *    - Upsert ranking when composite_score_pct is within range.
   *    - Delete the ranking when composite_score_pct falls outside the range.
   *    Legacy categories (is_legacy = true) still match on total_earned_points for backward compatibility.
   * 7. Assign dense rank_position per (club_type_id, year_id, award_category_id) group,
   *    ordered by composite_score_pct DESC.
   * 8. Update calculated_at on all affected records.
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
      throw new AppConflictException(
        ErrorCode.ANNUAL_FOLDER_RANKINGS_LOCK_CONFLICT,
      );
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
  private async _runRecalculation(year: {
    year_id: number;
    start_date?: Date | null;
  }): Promise<RecalculateResult> {
    // Derive calendar year for FinanceScoreService.
    // TODO: if the ecclesiastical year spans 2 calendar years (e.g. Sep 2025–Aug 2026),
    // finance_period_closings counted for a single calendar year only covers
    // ~4 of the 12 months. A future improvement should query across both
    // calendar years. For now we use EXTRACT(YEAR FROM start_date) as the
    // simplification — matches dev seed where years are single-calendar-year.
    const calendarYear =
      year.start_date != null
        ? new Date(year.start_date).getUTCFullYear()
        : new Date().getUTCFullYear();

    // 2. Fetch all evaluated/closed folders for that year, with the full
    //    club hierarchy needed to drive the score calculators.
    //    Path: annual_folders → club_enrollment → club_section → clubs → local_fields
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
        club_enrollment: {
          select: {
            club_enrollment_id: true,
            club_section: {
              select: {
                club_type_id: true,
                main_club_id: true,
                clubs: {
                  select: {
                    club_id: true,
                    local_field_id: true,
                    local_fields: {
                      select: {
                        local_field_id: true,
                        union_id: true,
                      },
                    },
                  },
                },
              },
            },
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

    // 3. Fetch all active award categories (both legacy and composite-based)
    const categories = await this.prisma.award_categories.findMany({
      where: { active: true },
      select: {
        award_category_id: true,
        name: true,
        min_points: true,
        max_points: true,
        min_composite_pct: true,
        max_composite_pct: true,
        is_legacy: true,
        club_type_id: true,
      },
    });

    // 4–7. All upserts/deletes + rank assignment run inside a single transaction
    //      so a partial failure never leaves rankings in an inconsistent state.
    const totalUpserted = await this.prisma.$transaction(async (tx) => {
      let upserted = 0;

      // Process each folder: compute scores, upsert general ranking + category-specific rankings
      for (const folder of folders) {
        const clubTypeId = folder.folder_template.club_type_id;
        const yearIdResolved = folder.folder_template.ecclesiastical_year_id;
        const earned = folder.total_earned_points;
        const max = folder.total_max_points;
        const pct = folder.progress_percentage;

        // Extract club hierarchy data for score calculators
        const enrollmentId = folder.club_enrollment_id;
        const clubSection = folder.club_enrollment?.club_section;
        const club = clubSection?.clubs;
        const localField = club?.local_fields;

        // Guard: if club hierarchy is incomplete, skip score computation
        // and fall back to zeroed score columns for this folder.
        if (!club || !localField) {
          this.logger.warn(
            `Skipping composite score for enrollment ${enrollmentId}: missing club/local_field data`,
          );

          await tx.club_annual_rankings.upsert({
            where: {
              club_enrollment_id_ecclesiastical_year_id_award_category_id: {
                club_enrollment_id: enrollmentId,
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
              club_enrollment_id: enrollmentId,
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
          continue;
        }

        const clubId = club.club_id;
        const localFieldId = club.local_field_id;
        // local_fields.union_id is non-nullable in schema (Int, not Int?)
        const unionId = localField.union_id;

        // Compute 4 component percentages in parallel for performance
        const [folderPct, financePct, camporeePct, evidencePct] =
          await Promise.all([
            this.folderScore.calc(enrollmentId, yearIdResolved),
            this.financeScore.calc(clubId, calendarYear),
            this.camporeeScore.calc(
              clubId,
              localFieldId,
              unionId,
              yearIdResolved,
            ),
            this.evidenceScore.calc(clubId, yearIdResolved),
          ]);

        // Resolve weights for this club type
        const weights = await this.weightsResolver.resolve(clubTypeId);

        // Compute weighted composite percentage
        const compositePct = this.compositeScore.compose(
          {
            folder: folderPct,
            finance: financePct,
            camporee: camporeePct,
            evidence: evidencePct,
          },
          weights,
        );

        // Shared score payload spread into both create and update branches
        const scorePayload = {
          folder_score_pct: folderPct,
          finance_score_pct: financePct,
          camporee_score_pct: camporeePct,
          evidence_score_pct: evidencePct,
          composite_score_pct: compositePct,
          composite_calculated_at: new Date(),
        };

        // General ranking — uses sentinel UUID instead of NULL so that the
        // @@unique constraint works correctly in PostgreSQL (NULL != NULL).
        await tx.club_annual_rankings.upsert({
          where: {
            club_enrollment_id_ecclesiastical_year_id_award_category_id: {
              club_enrollment_id: enrollmentId,
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
            ...scorePayload,
          },
          create: {
            club_enrollment_id: enrollmentId,
            club_type_id: clubTypeId,
            ecclesiastical_year_id: yearIdResolved,
            award_category_id: GENERAL_CATEGORY_ID,
            total_earned_points: earned,
            total_max_points: max,
            progress_percentage: pct,
            calculated_at: new Date(),
            ...scorePayload,
          },
        });
        upserted++;

        // Emit structured log per enrollment
        this.logger.log(
          JSON.stringify({
            event: 'ranking_calculated',
            enrollment_id: enrollmentId,
            year_id: yearIdResolved,
            scores: {
              folder: folderPct,
              finance: financePct,
              camporee: camporeePct,
              evidence: evidencePct,
            },
            composite: compositePct,
            weights_source: weights.source,
          }),
        );

        // Category-specific rankings
        const applicableCategories = categories.filter(
          (c) => c.club_type_id === null || c.club_type_id === clubTypeId,
        );

        for (const category of applicableCategories) {
          let qualifies: boolean;

          if (category.is_legacy) {
            // Legacy categories: match on total_earned_points (backward compatibility)
            qualifies =
              earned >= category.min_points &&
              (category.max_points === null || earned <= category.max_points);
          } else {
            // Non-legacy composite-based categories: match on composite_score_pct.
            // min_composite_pct / max_composite_pct are Decimal? — null means unbounded.
            const minPct =
              category.min_composite_pct !== null
                ? Number(category.min_composite_pct)
                : 0;
            const maxPct =
              category.max_composite_pct !== null
                ? Number(category.max_composite_pct)
                : Infinity;
            qualifies = compositePct >= minPct && compositePct <= maxPct;
          }

          if (qualifies) {
            await tx.club_annual_rankings.upsert({
              where: {
                club_enrollment_id_ecclesiastical_year_id_award_category_id: {
                  club_enrollment_id: enrollmentId,
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
                ...scorePayload,
              },
              create: {
                club_enrollment_id: enrollmentId,
                club_type_id: clubTypeId,
                ecclesiastical_year_id: yearIdResolved,
                award_category_id: category.award_category_id,
                total_earned_points: earned,
                total_max_points: max,
                progress_percentage: pct,
                calculated_at: new Date(),
                ...scorePayload,
              },
            });
            upserted++;
          } else {
            // Club no longer qualifies — remove stale ranking record if it exists
            await tx.club_annual_rankings.deleteMany({
              where: {
                club_enrollment_id: enrollmentId,
                ecclesiastical_year_id: yearIdResolved,
                award_category_id: category.award_category_id,
              },
            });
          }
        }
      }

      // Assign dense rank_position per (club_type_id, year_id, award_category_id) group
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
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_ENROLLMENT_FOR_RANKING_NOT_FOUND,
        { id: clubEnrollmentId },
      );
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
        throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_YEAR_NOT_FOUND, {
          id: yearId,
        });
      }
      return year;
    }

    const activeYear = await this.prisma.ecclesiastical_years.findFirst({
      where: { active: true },
      orderBy: { year_id: 'desc' },
    });

    if (!activeYear) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_YEAR_NOT_FOUND, {
        id: 'active',
      });
    }

    return activeYear;
  }

  /**
   * Assigns dense rank positions for all ranking records belonging to the given year.
   *
   * Groups are defined by (club_type_id, ecclesiastical_year_id, award_category_id).
   * Within each group, clubs are ordered by composite_score_pct DESC.
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

    // Fetch all ranking records for this year, ordered by composite_score_pct DESC
    const allRecords = await client.club_annual_rankings.findMany({
      where: { ecclesiastical_year_id: yearId },
      select: {
        ranking_id: true,
        club_type_id: true,
        award_category_id: true,
        composite_score_pct: true,
      },
      orderBy: { composite_score_pct: 'desc' },
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
      // group is already sorted desc by composite_score_pct (from the query orderBy)
      let rank = 1;
      let prevScore: number | null = null;
      let prevRank = 1;

      for (let i = 0; i < group.length; i++) {
        const record = group[i];
        const score = Number(record.composite_score_pct);
        if (prevScore === null) {
          rank = 1;
        } else if (score === prevScore) {
          rank = prevRank; // tie — same rank as previous
        } else {
          rank = prevRank + 1; // dense ranking: next sequential rank after a tie group
        }
        prevScore = score;
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

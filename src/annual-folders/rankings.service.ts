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
import { RANKINGS_QUEUE, RankingsTriggerJobData } from './rankings.types';
import { MemberCompositeScoreService } from '../rankings/member-rankings/services/member-composite-score.service';
import { SectionAggregationService } from '../rankings/section-rankings/services/section-aggregation.service';
import { SystemConfigService } from '../system-config/system-config.service';

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
    // 8.4-A new — member + section ranking pipeline
    private readonly memberCompositeScore: MemberCompositeScoreService,
    private readonly sectionAggregation: SectionAggregationService,
    private readonly systemConfig: SystemConfigService,
  ) {}

  // ========================================
  // CRON JOB — Nightly at 2:00 AM
  // ========================================

  @Cron('0 2 * * *', {
    name: 'annual-folders-rankings-recalc',
    timeZone: 'UTC',
  })
  async handleRankingsRecalculation() {
    this.logger.log('Rankings cron triggered — enqueuing BullMQ job...');

    if (this.rankingsQueue) {
      const jobData: RankingsTriggerJobData = {
        triggeredAt: new Date().toISOString(),
      };
      await this.rankingsQueue.add('recalculate', jobData, {
        jobId: 'rankings-recalculate', // dedup at queue layer — prevents concurrent runs of recalculateAll across BullMQ
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
  }): Promise<RecalculateResult> {
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
  // 8.4-A ORCHESTRATOR
  // ========================================

  /**
   * Full recalculation orchestrator — called by RankingsProcessor (BullMQ)
   * and the HTTP trigger endpoint.
   *
   * Step 1: club-level rankings (8.4-C existing, unchanged)
   * Step 2: per-enrollment member rankings (8.4-A new)
   * Step 3: section aggregate rankings (8.4-A new)
   *
   * Two independent kill-switches:
   *   ranking.recalculation_enabled        → global gate (all steps)
   *   member_ranking.recalculation_enabled → steps 2+3 only
   *
   * Step 3 always runs even if step 2 threw a partial/total error.
   *
   * mode param (Task 27 delta optimization):
   *   'full'  — default; processes ALL active enrollments (sections always run full)
   *   'delta' — processes only enrollments whose last_progress_change > previousRecalcAt;
   *             club rankings (step 1) and section aggregates (step 3) always run full
   *             regardless of mode because they are cheap aggregations, not per-row scans.
   */
  async recalculateAll(yearId?: number, mode: 'full' | 'delta' = 'full'): Promise<void> {
    const globalEnabled = await this.systemConfig.get('ranking.recalculation_enabled');
    if (globalEnabled === 'false') {
      this.logger.warn('[rankings] global kill-switch off — skipping all recalculation');
      return;
    }

    // Step 1: clubs (8.4-C existing — untouched)
    await this.recalculateRankings(yearId);

    // 8.4-A kill-switch
    const memberEnabled = await this.systemConfig.get('member_ranking.recalculation_enabled');
    if (memberEnabled === 'false') {
      this.logger.warn('[rankings] member_ranking kill-switch off — skipping steps 2 and 3');
      return;
    }

    // Step 2: enrollments (continues to step 3 even if step 2 throws)
    try {
      await this.recalculateEnrollmentRankings(yearId, mode);
    } catch (err) {
      this.logger.error(
        '[member-rankings] recalculateEnrollmentRankings failed, continuing to section aggregates',
        (err as Error).stack,
      );
    }

    // Step 3: sections
    try {
      await this.recalculateSectionAggregates(yearId);
    } catch (err) {
      this.logger.error(
        '[section-rankings] recalculateSectionAggregates failed',
        (err as Error).stack,
      );
    }
  }

  // ========================================
  // 8.4-A MEMBER RANKINGS
  // ========================================

  /**
   * Recalculates per-enrollment composite scores for all active enrollments
   * in the given ecclesiastical year, then assigns DENSE_RANK positions.
   *
   * Clubs are processed in chunks of 50 to bound peak memory.
   * Per-enrollment errors log+skip without bubbling — a single corrupt
   * enrollment never aborts the entire pass.
   *
   * mode='delta' (Task 27): only enrollments whose last_progress_change is
   * strictly after the previousRecalcAt timestamp are fetched and processed.
   * If no prior recalc exists (previousRecalcAt = null), falls back to full mode
   * and processes all enrollments. The cron always calls this with mode='full'
   * (default) to preserve existing behaviour.
   */
  async recalculateEnrollmentRankings(
    ecclesiasticalYearId?: number,
    mode: 'full' | 'delta' = 'full',
  ): Promise<void> {
    const year = await this.resolveYear(ecclesiasticalYearId);
    const yearId = year.year_id;

    // Resolve previousRecalcAt upfront — only meaningful in delta mode.
    let previousRecalc: Date | null = null;
    if (mode === 'delta') {
      previousRecalc = await this.getPreviousRecalcAt(yearId);
      if (!previousRecalc) {
        this.logger.log(
          `[member-rankings] mode=delta but no previous recalc found for year ${yearId}; falling back to full mode`,
        );
        // Continue without filter — equivalent to full
      }
    }

    this.logger.log(
      `[member-rankings] Recalc started ecclesiastical_year_id=${yearId} mode=${mode} previousRecalc=${previousRecalc?.toISOString() ?? 'null'}`,
    );

    const clubs = await this.prisma.clubs.findMany({
      where: { active: true },
      select: { club_id: true },
    });

    let totalEnrollments = 0;
    let totalSkipped = 0;

    const chunkSize = 50;
    for (let i = 0; i < clubs.length; i += chunkSize) {
      const chunk = clubs.slice(i, i + chunkSize);
      for (const c of chunk) {
        const sections = await this.prisma.club_sections.findMany({
          where: { main_club_id: c.club_id, active: true },
          select: { club_section_id: true, club_type_id: true },
        });
        if (sections.length === 0) continue;

        const clubTypeIds = [...new Set(sections.map((s) => s.club_type_id))];
        const classes = await this.prisma.classes.findMany({
          where: { club_type_id: { in: clubTypeIds } },
          select: { class_id: true, club_type_id: true },
        });
        const classIdSet = classes.map((cls) => cls.class_id);
        if (classIdSet.length === 0) continue;

        // Map club_type_id → first club_section_id of that type for the club.
        // First-wins is intentional: clubs with multiple sections of the same
        // type use the first section as the ranking anchor (rare in practice).
        // All enrollments in any section of that type share the same anchor.
        const sectionByClubType = new Map<number, number>();
        for (const s of sections) {
          if (!sectionByClubType.has(s.club_type_id)) {
            sectionByClubType.set(s.club_type_id, s.club_section_id);
          }
        }
        const classToClubType = new Map<number, number>();
        for (const cls of classes) {
          classToClubType.set(cls.class_id, cls.club_type_id);
        }

        const enrollments = await this.prisma.enrollments.findMany({
          where: {
            ecclesiastical_year_id: yearId,
            active: true,
            class_id: { in: classIdSet },
            // Delta mode: only enrollments with progress changes since the last recalc.
            // When previousRecalc is null (no prior recalc), the filter is omitted and
            // all enrollments are processed (same as full mode).
            ...(mode === 'delta' && previousRecalc
              ? { last_progress_change: { gt: previousRecalc } }
              : {}),
          },
          select: { enrollment_id: true, user_id: true, class_id: true },
        });

        for (const e of enrollments) {
          try {
            const result = await this.memberCompositeScore.calculate(
              e.enrollment_id,
              yearId,
            );
            if (!result) {
              totalSkipped++;
              continue;
            }

            const clubTypeId = classToClubType.get(e.class_id);
            const clubSectionId = clubTypeId
              ? (sectionByClubType.get(clubTypeId) ?? null)
              : null;

            await this.prisma.enrollmentRanking.upsert({
              where: {
                enrollment_id_ecclesiastical_year_id: {
                  enrollment_id: e.enrollment_id,
                  ecclesiastical_year_id: yearId,
                },
              },
              create: {
                enrollment_id: e.enrollment_id,
                user_id: e.user_id,
                club_id: c.club_id,
                club_section_id: clubSectionId,
                ecclesiastical_year_id: yearId,
                class_score_pct: result.class_score_pct,
                investiture_score_pct: result.investiture_score_pct,
                camporee_score_pct: result.camporee_score_pct,
                composite_score_pct: result.composite_score_pct,
                composite_calculated_at: new Date(),
              },
              update: {
                class_score_pct: result.class_score_pct,
                investiture_score_pct: result.investiture_score_pct,
                camporee_score_pct: result.camporee_score_pct,
                composite_score_pct: result.composite_score_pct,
                composite_calculated_at: new Date(),
                modified_at: new Date(),
              },
            });
            totalEnrollments++;
          } catch (err) {
            this.logger.error({
              msg: '[member-rankings] enrollment skip',
              enrollment_id: e.enrollment_id,
              ecclesiastical_year_id: yearId,
              error: (err as Error).message,
              stack: (err as Error).stack,
            });
            totalSkipped++;
          }
        }
      }
    }

    await this.updateEnrollmentRankPositions(yearId);

    this.logger.log(
      `[member-rankings] Recalc done enrollments=${totalEnrollments} skipped=${totalSkipped}`,
    );
  }

  // ========================================
  // 8.4-A SECTION RANKINGS
  // ========================================

  /**
   * Aggregates per-section composite scores from the enrollment_rankings table,
   * upserts section_rankings rows, then assigns DENSE_RANK positions.
   *
   * Per-section errors log+skip — a single broken section never aborts the pass.
   */
  async recalculateSectionAggregates(ecclesiasticalYearId?: number): Promise<void> {
    const year = await this.resolveYear(ecclesiasticalYearId);
    const yearId = year.year_id;
    this.logger.log(`[section-rankings] Recalc started ecclesiastical_year_id=${yearId}`);

    const sections = await this.prisma.club_sections.findMany({
      where: { active: true },
      select: { club_section_id: true, main_club_id: true },
    });

    let totalSections = 0;
    let totalEmpty = 0;
    let totalErrors = 0;

    for (const s of sections) {
      // Orphan sections without a parent club cannot rank — skip
      if (s.main_club_id === null) continue;

      try {
        const agg = await this.sectionAggregation.aggregate(s.club_section_id, yearId);
        if (agg.composite_score_pct === null) totalEmpty++;

        await this.prisma.sectionRanking.upsert({
          where: {
            club_section_id_ecclesiastical_year_id: {
              club_section_id: s.club_section_id,
              ecclesiastical_year_id: yearId,
            },
          },
          create: {
            club_section_id: s.club_section_id,
            club_id: s.main_club_id,
            ecclesiastical_year_id: yearId,
            composite_score_pct: agg.composite_score_pct,
            active_enrollment_count: agg.active_enrollment_count,
            composite_calculated_at: new Date(),
          },
          update: {
            composite_score_pct: agg.composite_score_pct,
            active_enrollment_count: agg.active_enrollment_count,
            composite_calculated_at: new Date(),
            modified_at: new Date(),
          },
        });
        totalSections++;
      } catch (err) {
        this.logger.error({
          msg: '[section-rankings] section skip',
          club_section_id: s.club_section_id,
          ecclesiastical_year_id: yearId,
          error: (err as Error).message,
          stack: (err as Error).stack,
        });
        totalErrors++;
      }
    }

    await this.updateSectionRankPositions(yearId);

    this.logger.log(
      `[section-rankings] Recalc done sections=${totalSections} empty=${totalEmpty} errors=${totalErrors}`,
    );
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
   * Assigns DENSE_RANK positions for all enrollment_rankings rows belonging
   * to the given ecclesiastical year.
   *
   * Partition: (club_id, ecclesiastical_year_id)
   * Order: composite_score_pct DESC NULLS LAST
   * Semantics: ties share the same rank; NULLs are ranked last (not excluded).
   */
  private async updateEnrollmentRankPositions(yearId: number): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE enrollment_rankings er
      SET rank_position = sub.rnk
      FROM (
        SELECT id,
          DENSE_RANK() OVER (
            PARTITION BY club_id, ecclesiastical_year_id
            ORDER BY composite_score_pct DESC NULLS LAST
          ) AS rnk
        FROM enrollment_rankings
        WHERE ecclesiastical_year_id = ${yearId}
      ) sub
      WHERE er.id = sub.id
    `;
  }

  /**
   * Assigns DENSE_RANK positions for all section_rankings rows belonging
   * to the given ecclesiastical year.
   *
   * Same semantics as updateEnrollmentRankPositions but for sections.
   */
  private async updateSectionRankPositions(yearId: number): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE section_rankings sr
      SET rank_position = sub.rnk
      FROM (
        SELECT id,
          DENSE_RANK() OVER (
            PARTITION BY club_id, ecclesiastical_year_id
            ORDER BY composite_score_pct DESC NULLS LAST
          ) AS rnk
        FROM section_rankings
        WHERE ecclesiastical_year_id = ${yearId}
      ) sub
      WHERE sr.id = sub.id
    `;
  }

  /**
   * Returns the MAX(composite_calculated_at) from enrollment_rankings for
   * the given ecclesiastical year. Used in delta mode to determine which
   * enrollments have had progress changes since the last recalculation.
   *
   * Returns null when no ranking rows exist yet (first-ever recalc for the year),
   * in which case the caller falls back to full mode.
   */
  private async getPreviousRecalcAt(yearId: number): Promise<Date | null> {
    const result = await this.prisma.enrollmentRanking.aggregate({
      where: { ecclesiastical_year_id: yearId },
      _max: { composite_calculated_at: true },
    });
    return result._max.composite_calculated_at ?? null;
  }

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

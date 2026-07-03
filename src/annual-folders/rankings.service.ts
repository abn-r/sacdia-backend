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
import { RankingBreakdownDto } from './dto/ranking-breakdown.dto';
import { MemberCompositeScoreService } from '../rankings/member-rankings/services/member-composite-score.service';
import { SectionAggregationService } from '../rankings/section-rankings/services/section-aggregation.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { InstitutionalHierarchyService } from '../common/services/institutional-hierarchy.service';

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

const SYSTEM_CONFIG_RECALC_ENABLED = 'ranking.recalculation_enabled';
const KILL_SWITCH_VALUE_FALSE = 'false';

export interface RankingEntry {
  rank_position: number | null;
  club_enrollment_id: string;
  ecclesiastical_year_id: number;
  local_field_id: number | null;
  club_name: string;
  total_earned_points: number;
  total_max_points: number;
  progress_percentage: number;
  award_category_name: string | null;
  folder_score_pct: number;
  finance_score_pct: number;
  camporee_score_pct: number;
  evidence_score_pct: number;
  composite_score_pct: number;
  composite_calculated_at: string | null;
}

export interface ClubRankingResult {
  general: {
    rank_position: number | null;
    total_earned_points: number;
    total_max_points: number;
    progress_percentage: number;
    folder_score_pct: number;
    finance_score_pct: number;
    camporee_score_pct: number;
    evidence_score_pct: number;
    composite_score_pct: number;
    composite_calculated_at: string | null;
  } | null;
  by_category: {
    award_category_id: string;
    award_category_name: string;
    rank_position: number | null;
    total_earned_points: number;
    total_max_points: number;
    progress_percentage: number;
    folder_score_pct: number;
    finance_score_pct: number;
    camporee_score_pct: number;
    evidence_score_pct: number;
    composite_score_pct: number;
    composite_calculated_at: string | null;
  }[];
}

export interface RecalculateResult {
  updated: number;
  skipped?: boolean;
  reason?: string;
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
    // 8.4-A new — member + section ranking pipeline
    private readonly memberCompositeScore: MemberCompositeScoreService,
    private readonly sectionAggregation: SectionAggregationService,
    private readonly systemConfig: SystemConfigService,
    private readonly hierarchy: InstitutionalHierarchyService,
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
    // Kill-switch: allow ops team to disable recalculation without a deploy.
    // Checked here so both the cron path and the manual HTTP path honor it.
    const killSwitch = await this.prisma.system_config.findUnique({
      where: { config_key: SYSTEM_CONFIG_RECALC_ENABLED },
    });
    if (killSwitch && killSwitch.config_value === KILL_SWITCH_VALUE_FALSE) {
      this.logger.warn('Rankings recalculation skipped: kill-switch enabled');
      return { updated: 0, skipped: true, reason: 'kill-switch' };
    }

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
    end_date?: Date | null;
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
        submitted_at: true,
        evaluated_at: true,
        closed_at: true,
        created_at: true,
        hierarchy_context_id: true,
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
                club_section_id: true,
                club_type_id: true,
                main_club_id: true,
                clubs: {
                  select: {
                    club_id: true,
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
      const hierarchyCache = new Map<
        string,
        Promise<{ localFieldId: number | null; unionId: number | null }>
      >();
      const contextCache = new Map<
        string,
        Promise<{ localFieldId: number | null; unionId: number | null } | null>
      >();

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

        // Guard: if club relation is incomplete, skip score computation
        // and fall back to zeroed score columns for this folder.
        if (!club) {
          this.logger.warn(
            `Skipping composite score for enrollment ${enrollmentId}: missing club data`,
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
              hierarchy_context_id: folder.hierarchy_context_id ?? null,
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
              hierarchy_context_id: folder.hierarchy_context_id ?? null,
            },
          });
          upserted++;
          continue;
        }

        const clubId = club.club_id;
        const closedOutputContext =
          await this.resolveClosedOutputHierarchyContext(
            {
              annualFolderId: folder.annual_folder_id,
              clubId,
              existingHierarchyContextId: folder.hierarchy_context_id ?? null,
              closedAt: folder.closed_at,
              evaluatedAt: folder.evaluated_at,
              submittedAt: folder.submitted_at,
              createdAt: folder.created_at,
            },
            year,
            tx,
            hierarchyCache,
            contextCache,
          );
        const localFieldId = closedOutputContext.localFieldId;
        const unionId = closedOutputContext.unionId;
        const rankingHierarchyContextId =
          closedOutputContext.hierarchyContextId;

        if (localFieldId == null) {
          this.logger.warn(
            `Skipping composite score for enrollment ${enrollmentId}: missing historical local_field context`,
          );
          continue;
        }

        // Compute 4 component percentages + resolve weights in parallel
        const [folderPct, financePct, camporeePct, evidencePct, weights] =
          await Promise.all([
            this.folderScore.calc(enrollmentId, yearIdResolved),
            this.financeScore.calc(clubId, calendarYear),
            this.camporeeScore.calc(
              clubSection.club_section_id,
              localFieldId,
              unionId,
              yearIdResolved,
            ),
            this.evidenceScore.calc(clubId, yearIdResolved),
            this.weightsResolver.resolve(clubTypeId),
          ]);

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
            hierarchy_context_id: rankingHierarchyContextId,
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
            hierarchy_context_id: rankingHierarchyContextId,
            ...scorePayload,
          },
        });
        upserted++;

        // Emit structured log per enrollment (debug only — avoid stdout flood in production)
        this.logger.debug(
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
                hierarchy_context_id: rankingHierarchyContextId,
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
                hierarchy_context_id: rankingHierarchyContextId,
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
  async recalculateAll(
    yearId?: number,
    mode: 'full' | 'delta' = 'full',
  ): Promise<void> {
    const globalEnabled = await this.systemConfig.get(
      'ranking.recalculation_enabled',
    );
    if (globalEnabled === 'false') {
      this.logger.warn(
        '[rankings] global kill-switch off — skipping all recalculation',
      );
      return;
    }

    // Step 1: clubs (8.4-C existing — untouched)
    await this.recalculateRankings(yearId);

    // 8.4-A kill-switch
    const memberEnabled = await this.systemConfig.get(
      'member_ranking.recalculation_enabled',
    );
    if (memberEnabled === 'false') {
      this.logger.warn(
        '[rankings] member_ranking kill-switch off — skipping steps 2 and 3',
      );
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
    const snapshotContextCache = new Map<string, Promise<string | null>>();

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
            const snapshotContextId =
              await this.resolveSnapshotContextIdForClubYear(
                c.club_id,
                year,
                snapshotContextCache,
              );

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
                hierarchy_context_id: snapshotContextId,
                composite_calculated_at: new Date(),
              },
              update: {
                class_score_pct: result.class_score_pct,
                investiture_score_pct: result.investiture_score_pct,
                camporee_score_pct: result.camporee_score_pct,
                composite_score_pct: result.composite_score_pct,
                hierarchy_context_id: snapshotContextId,
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
  async recalculateSectionAggregates(
    ecclesiasticalYearId?: number,
  ): Promise<void> {
    const year = await this.resolveYear(ecclesiasticalYearId);
    const yearId = year.year_id;
    this.logger.log(
      `[section-rankings] Recalc started ecclesiastical_year_id=${yearId}`,
    );

    const sections = await this.prisma.club_sections.findMany({
      where: { active: true },
      select: { club_section_id: true, main_club_id: true },
    });
    const snapshotContextCache = new Map<string, Promise<string | null>>();

    let totalSections = 0;
    let totalEmpty = 0;
    let totalErrors = 0;

    for (const s of sections) {
      // Orphan sections without a parent club cannot rank — skip
      if (s.main_club_id === null) continue;

      try {
        const agg = await this.sectionAggregation.aggregate(
          s.club_section_id,
          yearId,
        );
        const snapshotContextId =
          await this.resolveSnapshotContextIdForClubYear(
            s.main_club_id,
            year,
            snapshotContextCache,
          );
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
            hierarchy_context_id: snapshotContextId,
            composite_calculated_at: new Date(),
          },
          update: {
            composite_score_pct: agg.composite_score_pct,
            active_enrollment_count: agg.active_enrollment_count,
            hierarchy_context_id: snapshotContextId,
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
    localFieldId?: number,
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
        ...(localFieldId !== undefined
          ? { hierarchy_context: { local_field_id: localFieldId } }
          : {}),
      },
      orderBy: { rank_position: 'asc' },
      include: {
        hierarchy_context: {
          select: { local_field_id: true },
        },
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
      club_enrollment_id: r.club_enrollment_id,
      ecclesiastical_year_id: r.ecclesiastical_year_id,
      local_field_id: r.hierarchy_context?.local_field_id ?? null,
      club_name: r.club_enrollment.club_section.clubs?.name ?? 'Unknown',
      total_earned_points: r.total_earned_points,
      total_max_points: r.total_max_points,
      progress_percentage: r.progress_percentage,
      award_category_name: r.award_category?.name ?? null,
      folder_score_pct: Number(r.folder_score_pct),
      finance_score_pct: Number(r.finance_score_pct),
      camporee_score_pct: Number(r.camporee_score_pct),
      evidence_score_pct: Number(r.evidence_score_pct),
      composite_score_pct: Number(r.composite_score_pct),
      composite_calculated_at: r.composite_calculated_at?.toISOString() ?? null,
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
            folder_score_pct: Number(general.folder_score_pct),
            finance_score_pct: Number(general.finance_score_pct),
            camporee_score_pct: Number(general.camporee_score_pct),
            evidence_score_pct: Number(general.evidence_score_pct),
            composite_score_pct: Number(general.composite_score_pct),
            composite_calculated_at:
              general.composite_calculated_at?.toISOString() ?? null,
          }
        : null,
      by_category: byCategory.map((r) => ({
        award_category_id: r.award_category.award_category_id,
        award_category_name: r.award_category.name,
        rank_position: r.rank_position,
        total_earned_points: r.total_earned_points,
        total_max_points: r.total_max_points,
        progress_percentage: r.progress_percentage,
        folder_score_pct: Number(r.folder_score_pct),
        finance_score_pct: Number(r.finance_score_pct),
        camporee_score_pct: Number(r.camporee_score_pct),
        evidence_score_pct: Number(r.evidence_score_pct),
        composite_score_pct: Number(r.composite_score_pct),
        composite_calculated_at:
          r.composite_calculated_at?.toISOString() ?? null,
      })),
    };
  }

  // ========================================
  // BREAKDOWN — per-component drill-down
  // ========================================

  /**
   * Returns a detailed per-component score breakdown for a single enrollment.
   *
   * Reuses the existing score calculators for the headline percentages, then
   * runs auxiliary detail queries in parallel to populate the drill-down
   * fields (folder sections, finance missed months, camporee event list,
   * evidence validated/rejected/pending counts).
   */
  async getBreakdown(
    enrollmentId: string,
    ecclesiasticalYearId: number,
  ): Promise<RankingBreakdownDto> {
    // 1. Load enrollment + full club hierarchy
    const enrollment = await this.prisma.club_enrollments.findUniqueOrThrow({
      where: { club_enrollment_id: enrollmentId },
      include: {
        club_section: {
          include: {
            clubs: {
              select: {
                club_id: true,
              },
            },
          },
        },
      },
    });

    const clubSection = enrollment.club_section;
    const club = clubSection.clubs;

    if (!club) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_ENROLLMENT_FOR_RANKING_NOT_FOUND,
        { id: enrollmentId },
      );
    }

    const clubId = club.club_id;

    // 2. Resolve calendar year from ecclesiastical year start_date
    const year = await this.prisma.ecclesiastical_years.findUnique({
      where: { year_id: ecclesiasticalYearId },
      select: { start_date: true, end_date: true },
    });
    const generalRanking = await this.prisma.club_annual_rankings.findFirst({
      where: {
        club_enrollment_id: enrollmentId,
        ecclesiastical_year_id: ecclesiasticalYearId,
        award_category_id: GENERAL_CATEGORY_ID,
      },
      select: {
        hierarchy_context: {
          select: {
            local_field_id: true,
            union_id: true,
          },
        },
      },
    });
    const hierarchyAsOfDate =
      year?.end_date ??
      year?.start_date ??
      new Date(`${ecclesiasticalYearId}-12-31T23:59:59.999Z`);
    const hierarchyContext =
      generalRanking?.hierarchy_context ??
      (await this.hierarchy.resolveAsOf(
        { type: 'club', id: clubId },
        hierarchyAsOfDate,
      ));
    const localFieldId = hierarchyContext.local_field_id;
    const unionId: number | null = hierarchyContext.union_id ?? null;

    if (localFieldId == null) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_ENROLLMENT_FOR_RANKING_NOT_FOUND,
        { id: enrollmentId },
      );
    }

    const calendarYear =
      year?.start_date != null
        ? new Date(year.start_date).getUTCFullYear()
        : new Date().getUTCFullYear();

    // 3. Compute 4 component scores + weights in parallel
    const [folderPct, financePct, camporeePct, evidencePct, weights] =
      await Promise.all([
        this.folderScore.calc(enrollmentId, ecclesiasticalYearId),
        this.financeScore.calc(clubId, calendarYear),
        this.camporeeScore.calc(
          clubSection.club_section_id,
          localFieldId,
          unionId,
          ecclesiasticalYearId,
        ),
        this.evidenceScore.calc(clubId, ecclesiasticalYearId),
        this.weightsResolver.resolve(clubSection.club_type_id),
      ]);

    const composite = this.compositeScore.compose(
      {
        folder: folderPct,
        finance: financePct,
        camporee: camporeePct,
        evidence: evidencePct,
      },
      weights,
    );

    // 4a. Resolve finance deadline day first — needed as a SQL parameter
    const deadlineRow = await this.prisma.system_config.findUnique({
      where: { config_key: 'ranking.finance_closing_deadline_day' },
    });
    const deadlineDay = parseInt(deadlineRow?.config_value ?? '5', 10);

    // 4. Auxiliary detail queries — run in parallel
    const [
      folderDetailRows,
      closedMonthsRows,
      localScopeRows,
      unionScopeRows,
      evRows,
    ] = await Promise.all([
      // 4b. Folder: earned/max/sections from VALIDATED evaluations
      this.prisma.$queryRaw<
        { earned: bigint; max: bigint; sections: bigint }[]
      >`
          SELECT COALESCE(SUM(e.earned_points), 0)::bigint AS earned,
                 COALESCE(SUM(e.max_points), 0)::bigint    AS max,
                 COUNT(*)::bigint                          AS sections
          FROM annual_folder_section_evaluations e
          JOIN annual_folders f ON f.annual_folder_id = e.annual_folder_id
          JOIN folder_templates ft ON ft.folder_template_id = f.folder_template_id
          WHERE f.club_enrollment_id = ${enrollmentId}::uuid
            AND ft.ecclesiastical_year_id = ${ecclesiasticalYearId}
            AND e.status = 'VALIDATED'::annual_folder_section_status_enum
        `,

      // 4c. Finance: list of months closed on time
      this.prisma.$queryRaw<{ month: number }[]>`
          SELECT month FROM finance_period_closings
          WHERE club_id = ${clubId}
            AND year = ${calendarYear}
            AND closed_at IS NOT NULL
            AND closed_at <= (make_timestamptz(year, month + 1, ${deadlineDay}, 23, 59, 59, 'UTC') AT TIME ZONE 'UTC')
        `,

      // 4d. Camporee: local events in scope for club's local field
      this.prisma.$queryRaw<{ id: number; name: string; attended: boolean }[]>`
          SELECT lc.local_camporee_id AS id,
                 lc.name              AS name,
                 COALESCE(BOOL_OR(cc.status IN ('registered', 'approved')), false) AS attended
          FROM local_camporees lc
          LEFT JOIN camporee_clubs cc
            ON cc.camporee_id = lc.local_camporee_id
           AND cc.club_id = ${clubId}
          WHERE lc.ecclesiastical_year = ${ecclesiasticalYearId}
            AND lc.active = true
            AND lc.local_field_id = ${localFieldId}
          GROUP BY lc.local_camporee_id, lc.name
        `,

      // 4e. Camporee: union events in scope (skipped when no union)
      unionId == null
        ? Promise.resolve(
            [] as { id: number; name: string; attended: boolean }[],
          )
        : this.prisma.$queryRaw<
            { id: number; name: string; attended: boolean }[]
          >`
              SELECT uc.union_camporee_id AS id,
                     uc.name              AS name,
                     COALESCE(BOOL_OR(cc.union_camporee_id = uc.union_camporee_id AND cc.status IN ('registered', 'approved')), false) AS attended
              FROM union_camporees uc
              LEFT JOIN camporee_clubs cc
                ON cc.union_camporee_id = uc.union_camporee_id
               AND cc.club_id = ${clubId}
              WHERE uc.ecclesiastical_year = ${ecclesiasticalYearId}
                AND uc.active = true
                AND uc.union_id = ${unionId}
              GROUP BY uc.union_camporee_id, uc.name
            `,

      // 4f. Evidence: validated / rejected / pending counts
      this.prisma.$queryRaw<
        { validated: bigint; rejected: bigint; pending: bigint }[]
      >`
          SELECT
            COUNT(*) FILTER (WHERE r.status = 'VALIDATED'::evidence_validation_enum)::bigint AS validated,
            COUNT(*) FILTER (WHERE r.status = 'REJECTED'::evidence_validation_enum)::bigint  AS rejected,
            COUNT(*) FILTER (WHERE r.status = 'PENDING'::evidence_validation_enum)::bigint   AS pending
          FROM folders_section_records r
          JOIN folders f ON f.folder_id = r.folder_id
          JOIN club_sections cs ON cs.club_section_id = r.club_section_id
          WHERE cs.main_club_id = ${clubId}
            AND f.ecclesiastical_year_id = ${ecclesiasticalYearId}
        `,
    ]);

    // Build closed months set from the raw query result
    const closedSet = new Set(closedMonthsRows.map((r) => r.month));
    const missedMonths = Array.from({ length: 12 }, (_, i) => i + 1).filter(
      (m) => !closedSet.has(m),
    );

    // Build camporee events list
    const events = [...localScopeRows, ...unionScopeRows].map((e) => ({
      id: String(e.id),
      name: e.name,
      status: e.attended ? ('approved' as const) : null,
    }));
    const attendedCount = events.filter((e) => e.status === 'approved').length;

    // Build folder detail (first row, fall back to zeros)
    const fd = folderDetailRows[0] ?? { earned: 0n, max: 0n, sections: 0n };
    const ev = evRows[0] ?? { validated: 0n, rejected: 0n, pending: 0n };

    return {
      enrollment_id: enrollmentId,
      year_id: ecclesiasticalYearId,
      composite_score_pct: composite,
      weights_applied: {
        folder: weights.folder,
        finance: weights.finance,
        camporee: weights.camporee,
        evidence: weights.evidence,
        source: weights.source,
      },
      components: {
        folder: {
          score_pct: folderPct,
          earned_points: Number(fd.earned),
          max_points: Number(fd.max),
          sections_evaluated: Number(fd.sections),
        },
        finance: {
          score_pct: financePct,
          months_closed_on_time: closedSet.size,
          months_total: 12,
          deadline_day: deadlineDay,
          missed_months: missedMonths,
        },
        camporee: {
          score_pct: camporeePct,
          attended: attendedCount,
          available_in_scope: events.length,
          events,
        },
        evidence: {
          score_pct: evidencePct,
          validated: Number(ev.validated),
          rejected: Number(ev.rejected),
          pending_excluded: Number(ev.pending),
        },
      },
    };
  }

  private async resolveRankingHierarchyAsOf(
    input: {
      clubId: number;
      closedAt?: Date | null;
      evaluatedAt?: Date | null;
      submittedAt?: Date | null;
      createdAt?: Date | null;
    },
    year: { start_date?: Date | null; end_date?: Date | null },
    cache: Map<
      string,
      Promise<{ localFieldId: number | null; unionId: number | null }>
    >,
  ): Promise<{ localFieldId: number | null; unionId: number | null }> {
    const asOf =
      input.closedAt ??
      input.evaluatedAt ??
      input.submittedAt ??
      input.createdAt ??
      year.end_date ??
      year.start_date ??
      new Date();
    const cacheKey = `${input.clubId}:${asOf.toISOString()}`;

    if (!cache.has(cacheKey)) {
      cache.set(
        cacheKey,
        this.hierarchy
          .resolveAsOf({ type: 'club', id: input.clubId }, asOf)
          .then((context) => ({
            localFieldId: context.local_field_id ?? null,
            unionId: context.union_id ?? null,
          }))
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `Unable to resolve historical hierarchy for club ${input.clubId} as of ${asOf.toISOString()}: ${message}`,
            );
            return {
              localFieldId: null,
              unionId: null,
            };
          }),
      );
    }

    return cache.get(cacheKey)!;
  }

  private async resolveClosedOutputHierarchyContext(
    input: {
      annualFolderId: string;
      clubId: number;
      existingHierarchyContextId?: string | null;
      closedAt?: Date | null;
      evaluatedAt?: Date | null;
      submittedAt?: Date | null;
      createdAt?: Date | null;
    },
    year: { start_date?: Date | null; end_date?: Date | null },
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    hierarchyCache: Map<
      string,
      Promise<{ localFieldId: number | null; unionId: number | null }>
    >,
    contextCache: Map<
      string,
      Promise<{ localFieldId: number | null; unionId: number | null } | null>
    >,
  ): Promise<{
    hierarchyContextId: string | null;
    localFieldId: number | null;
    unionId: number | null;
  }> {
    const asOf =
      input.closedAt ??
      input.evaluatedAt ??
      input.submittedAt ??
      input.createdAt ??
      year.end_date ??
      year.start_date ??
      new Date();

    if (input.existingHierarchyContextId) {
      const existingId = input.existingHierarchyContextId;
      if (!contextCache.has(existingId)) {
        contextCache.set(
          existingId,
          tx.hierarchy_contexts
            .findUnique({
              where: { hierarchy_context_id: existingId },
              select: { local_field_id: true, union_id: true },
            })
            .then((row) =>
              row
                ? {
                    localFieldId: row.local_field_id ?? null,
                    unionId: row.union_id ?? null,
                  }
                : null,
            ),
        );
      }

      const existingContext = await contextCache.get(existingId);
      if (existingContext?.localFieldId != null) {
        return {
          hierarchyContextId: existingId,
          localFieldId: existingContext.localFieldId,
          unionId: existingContext.unionId,
        };
      }
    }

    const fallbackContext = await this.resolveRankingHierarchyAsOf(
      {
        clubId: input.clubId,
        closedAt: input.closedAt,
        evaluatedAt: input.evaluatedAt,
        submittedAt: input.submittedAt,
        createdAt: input.createdAt,
      },
      year,
      hierarchyCache,
    );

    if (fallbackContext.localFieldId == null) {
      return {
        hierarchyContextId: input.existingHierarchyContextId ?? null,
        localFieldId: null,
        unionId: null,
      };
    }

    if (input.existingHierarchyContextId) {
      return {
        hierarchyContextId: input.existingHierarchyContextId,
        localFieldId: fallbackContext.localFieldId,
        unionId: fallbackContext.unionId,
      };
    }

    const snapshot = await this.hierarchy
      .snapshotForClub(input.clubId, asOf)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Unable to persist hierarchy snapshot for folder ${input.annualFolderId}: ${message}`,
        );
        return null;
      });
    const snapshotContextId = snapshot?.hierarchy_context_id ?? null;

    if (snapshotContextId) {
      await tx.annual_folders.update({
        where: { annual_folder_id: input.annualFolderId },
        data: { hierarchy_context_id: snapshotContextId },
      });
    }

    return {
      hierarchyContextId: snapshotContextId,
      localFieldId: fallbackContext.localFieldId,
      unionId: fallbackContext.unionId,
    };
  }

  private async resolveSnapshotContextIdForClubYear(
    clubId: number,
    year: { year_id: number; start_date?: Date | null; end_date?: Date | null },
    cache: Map<string, Promise<string | null>>,
  ): Promise<string | null> {
    const asOf =
      year.end_date ??
      year.start_date ??
      new Date(`${year.year_id}-12-31T23:59:59.999Z`);
    const cacheKey = `${clubId}:${asOf.toISOString()}`;

    if (!cache.has(cacheKey)) {
      cache.set(
        cacheKey,
        this.hierarchy
          .snapshotForClub(clubId, asOf)
          .then((snapshot) => snapshot.hierarchy_context_id ?? null)
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `Unable to persist hierarchy snapshot for club ${clubId} year ${year.year_id}: ${message}`,
            );
            return null;
          }),
      );
    }

    return cache.get(cacheKey)!;
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

    await client.$executeRaw`
      UPDATE club_annual_rankings car
      SET
        rank_position = ranked.rnk,
        calculated_at = NOW()
      FROM (
        SELECT
          car_inner.ranking_id,
          DENSE_RANK() OVER (
            PARTITION BY
              COALESCE(hc.local_field_id::text, 'unscoped'),
              car_inner.club_type_id,
              car_inner.award_category_id
            ORDER BY car_inner.composite_score_pct DESC
          ) AS rnk
        FROM club_annual_rankings car_inner
        LEFT JOIN hierarchy_contexts hc
          ON hc.hierarchy_context_id = car_inner.hierarchy_context_id
        WHERE car_inner.ecclesiastical_year_id = ${yearId}
      ) ranked
      WHERE car.ranking_id = ranked.ranking_id
    `;
  }
}

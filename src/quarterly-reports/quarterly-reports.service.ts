import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceAggregationService } from '../finances/finance-aggregation.service';
import {
  AppBadRequestException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { isCoordinatorOnlyForPeriodicReports } from '../common/authorization/periodic-reports-access';
import {
  buildReportClubWhere,
  resolvePeriodicReportVisibilityScopeForActor,
  type ReportVisibilityFilters,
} from '../reports/report-visibility-scope';
import { PeriodicReportDataService } from '../reports/periodic-report-data.service';
import { resolveHistoryLowerBound } from '../reports/periodic-report-history';
import type { MonthlyTextEntry } from '../reports/periodic-monthly-data';
import {
  isPastGrace,
  quarterOf,
  quarterPeriod,
  reportsToday,
  type YearMonth,
} from '../reports/periodic-report-period';

// ============================================================
// Shape of the computed_data JSON column
// ============================================================

/**
 * Figures that used to be typed by hand, now computed from the SUBMITTED
 * monthly reports of the quarter (all sections of the club). Everything but
 * `camporees_attended` is null when no monthly report of the quarter was
 * submitted (the PDF prints "—").
 */
export interface QuarterlyMonthlyData {
  /** Distinct months of the quarter with a submitted monthly report. */
  months_submitted: number;
  /** Those months, oldest first. */
  months_covered: YearMonth[];
  /** Sum over the submitted months. */
  planning_meetings: number | null;
  parent_meetings: number | null;
  youth_council_attendance: number | null;
  church_board_attendance: number | null;
  /** Value of the latest submitted month. */
  soul_target: number | null;
  /** Sum of `baptized_this_month`. */
  baptized_this_quarter: number | null;
  /** One entry per submitted month with text, oldest first. */
  club_participation_description: MonthlyTextEntry[] | null;
  community_service_description: MonthlyTextEntry[] | null;
  /** true if any submitted month has true; false if none; null without months. */
  certificates_delivered: boolean | null;
  /** Distinct camporees (registered/approved, starting in the quarter); not monthly data. */
  camporees_attended: number;
}

export interface QuarterlyComputedData {
  quarter_label: string;
  year: number;
  quarter: number;
  months_in_quarter: number[];
  /** Distinct people with a club assignment that overlapped the quarter. */
  member_count: number;
  /** Board roles held at any time during the quarter. */
  directiva: { role: string; user_id: string; name: string }[];
  honors: {
    started: number;
    completed: number;
  };
  activities: {
    total: number;
  };
  finances: {
    income: number;
    expenses: number;
    /** Net of the quarter (income - expenses). */
    balance: number;
    /** Cash on hand: all-time cumulative net up to the end of the quarter. */
    total_balance: number;
    transactions: number;
  };
  missionary: {
    /** Same value as `monthly_data.baptized_this_quarter`. */
    baptized_this_quarter: number | null;
  };
  monthly_data: QuarterlyMonthlyData;
}

export type PeriodicReportStatus = 'draft' | 'finalized';

@Injectable()
export class QuarterlyReportsService {
  private readonly logger = new Logger(QuarterlyReportsService.name);
  private readonly financeAggregation: FinanceAggregationService;
  private readonly data: PeriodicReportDataService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    @Optional()
    financeAggregation?: FinanceAggregationService,
    @Optional()
    data?: PeriodicReportDataService,
  ) {
    this.financeAggregation =
      financeAggregation ?? new FinanceAggregationService(prisma);
    this.data =
      data ?? new PeriodicReportDataService(prisma, this.financeAggregation);
  }

  // ========================================
  // GET OR CREATE DRAFT
  // ========================================

  async getOrCreateDraft(clubId: number, year: number, quarter: number) {
    this.validateQuarterYear(quarter, year);
    await this.validateClubExists(clubId);

    const existing = await this.prisma.quarterly_reports.findUnique({
      where: { club_id_year_quarter: { club_id: clubId, year, quarter } },
    });

    if (existing) return existing;

    try {
      return await this.prisma.quarterly_reports.create({
        data: { club_id: clubId, year, quarter, status: 'draft' },
      });
    } catch (error) {
      // Two generate requests for the same period: the loser reads the winner's row.
      if ((error as { code?: string }).code !== 'P2002') throw error;
      return this.prisma.quarterly_reports.findUniqueOrThrow({
        where: { club_id_year_quarter: { club_id: clubId, year, quarter } },
      });
    }
  }

  // ========================================
  // GENERATE ON DEMAND
  // ========================================

  /**
   * Creates the quarterly report for the club/period when it does not exist.
   * A draft is recomputed live; when the quarter ended more than the grace
   * period ago the draft is frozen (finalized, `finalized_by` null). A
   * finalized report is returned untouched. Same shape as `getReport`.
   * Callers must have checked club visibility first.
   */
  async generateOnDemand(clubId: number, year: number, quarter: number) {
    this.validateQuarterYear(quarter, year);
    this.assertQuarterStarted(year, quarter);

    const report = await this.getOrCreateDraft(clubId, year, quarter);

    if (report.status === 'draft') {
      const graceDays = await this.data.getFreezeGraceDays();
      const { endDate } = quarterPeriod(year, quarter);
      if (isPastGrace(endDate, reportsToday(), graceDays)) {
        await this.freezeReport(report.quarterly_report_id);
      } else {
        await this.refreshDraft(report.quarterly_report_id);
      }
    }

    return this.loadReport(report.quarterly_report_id);
  }

  // ========================================
  // COMPUTE (build computed_data)
  // ========================================

  async computeData(
    clubId: number,
    year: number,
    quarter: number,
  ): Promise<QuarterlyComputedData> {
    this.validateQuarterYear(quarter, year);
    await this.validateClubExists(clubId);

    const period = quarterPeriod(year, quarter);
    const base = await this.data.compute(clubId, period);
    const monthly = base.monthly;

    return {
      quarter_label: `Q${quarter} ${year}`,
      year,
      quarter,
      months_in_quarter: period.months.map((m) => m.month),
      member_count: base.memberCount,
      directiva: base.directiva,
      honors: {
        started: base.honors.length,
        completed: base.honors.filter((h) => h.validate).length,
      },
      activities: { total: base.activitiesTotal },
      finances: {
        income: base.finance.income,
        expenses: base.finance.expenses,
        balance: base.finance.net,
        total_balance: base.finance.balance,
        transactions: base.finance.movements,
      },
      missionary: { baptized_this_quarter: monthly.baptized },
      monthly_data: {
        months_submitted: monthly.months_submitted,
        months_covered: monthly.months_covered,
        planning_meetings: monthly.planning_meetings,
        parent_meetings: monthly.parent_meetings,
        youth_council_attendance: monthly.youth_council_attendance,
        church_board_attendance: monthly.church_board_attendance,
        soul_target: monthly.soul_target,
        baptized_this_quarter: monthly.baptized,
        club_participation_description: monthly.club_participation_description,
        community_service_description: monthly.community_service_description,
        certificates_delivered: monthly.certificates_delivered,
        camporees_attended: base.camporeesAttended,
      },
    };
  }

  // ========================================
  // LIFECYCLE: refresh (draft), freeze, regenerate
  // ========================================

  /**
   * Recomputes a draft and stores the result. The write is conditional on the
   * row still being a draft, so a concurrent freeze is never overwritten.
   * Non-drafts are left alone.
   */
  async refreshDraft(reportId: number): Promise<void> {
    const report = await this.prisma.quarterly_reports.findUnique({
      where: { quarterly_report_id: reportId },
      select: { club_id: true, year: true, quarter: true, status: true },
    });
    if (!report) {
      throw new AppNotFoundException(ErrorCode.QUARTERLY_REPORT_NOT_FOUND);
    }
    if (report.status !== 'draft') return;

    const computed = await this.computeData(
      report.club_id,
      report.year,
      report.quarter,
    );
    await this.prisma.quarterly_reports.updateMany({
      where: { quarterly_report_id: reportId, status: 'draft' },
      data: {
        computed_data: computed as unknown as Prisma.InputJsonValue,
        auto_generated_at: new Date(),
      },
    });
  }

  /**
   * Freezes a draft: computes the snapshot and marks it finalized with
   * `finalized_by` null (automatic). Idempotent and conditional on
   * `status = 'draft'`: a report that is already finalized, or frozen by a
   * concurrent run, is not touched. Returns whether this call froze it.
   */
  async freezeReport(reportId: number): Promise<boolean> {
    const report = await this.prisma.quarterly_reports.findUnique({
      where: { quarterly_report_id: reportId },
      select: { club_id: true, year: true, quarter: true, status: true },
    });
    if (!report) {
      throw new AppNotFoundException(ErrorCode.QUARTERLY_REPORT_NOT_FOUND);
    }
    if (report.status !== 'draft') return false;

    const computed = await this.computeData(
      report.club_id,
      report.year,
      report.quarter,
    );
    const now = new Date();
    const result = await this.prisma.quarterly_reports.updateMany({
      where: { quarterly_report_id: reportId, status: 'draft' },
      data: {
        computed_data: computed as unknown as Prisma.InputJsonValue,
        auto_generated_at: now,
        status: 'finalized',
        finalized_at: now,
        finalized_by: null,
      },
    });
    return result.count > 0;
  }

  /**
   * Support escape hatch (global admins only, enforced by the controller):
   * recomputes the report and keeps its status, finalized included. The write
   * is conditional on the status read, with one retry when it changed
   * concurrently (draft frozen meanwhile).
   */
  async regenerate(reportId: number) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const report = await this.prisma.quarterly_reports.findUnique({
        where: { quarterly_report_id: reportId },
      });
      if (!report) {
        throw new AppNotFoundException(ErrorCode.QUARTERLY_REPORT_NOT_FOUND);
      }

      const computed = await this.computeData(
        report.club_id,
        report.year,
        report.quarter,
      );
      const result = await this.prisma.quarterly_reports.updateMany({
        where: { quarterly_report_id: reportId, status: report.status },
        data: {
          computed_data: computed as unknown as Prisma.InputJsonValue,
          auto_generated_at: new Date(),
        },
      });
      if (result.count > 0) break;
    }
    return this.loadReport(reportId);
  }

  // ========================================
  // CATCH-UP FREEZE (called daily by the cron)
  // ========================================

  /**
   * Freezes every quarterly report whose quarter ended more than `graceDays`
   * days ago and is not finalized yet, for every active club. Covers the
   * quarters from the start of the previous ecclesiastical year up to the
   * latest one past grace. Idempotent: finalized reports are skipped.
   */
  async freezeDueReports(
    graceDays: number,
    now: Date = new Date(),
  ): Promise<{ success: number; skipped: number; errors: number }> {
    const result = { success: 0, skipped: 0, errors: 0 };
    const today = reportsToday(now);

    const lowerBound = await resolveHistoryLowerBound(this.prisma, today);
    if (!lowerBound) return result;

    const quarters: { year: number; quarter: number }[] = [];
    let { year, quarter } = quarterOf(lowerBound);
    for (;;) {
      if (
        !isPastGrace(quarterPeriod(year, quarter).endDate, today, graceDays)
      ) {
        break;
      }
      quarters.push({ year, quarter });
      quarter += 1;
      if (quarter > 4) {
        quarter = 1;
        year += 1;
      }
    }
    if (quarters.length === 0) return result;

    const clubs = await this.prisma.clubs.findMany({
      where: { active: true },
      select: { club_id: true, name: true, created_at: true },
    });
    const finalized = await this.prisma.quarterly_reports.findMany({
      where: { status: 'finalized', OR: quarters },
      select: { club_id: true, year: true, quarter: true },
    });
    const done = new Set(
      finalized.map((r) => `${r.club_id}:${r.year}:${r.quarter}`),
    );

    for (const target of quarters) {
      const period = quarterPeriod(target.year, target.quarter);
      for (const club of clubs) {
        if (done.has(`${club.club_id}:${target.year}:${target.quarter}`)) {
          result.skipped += 1;
          continue;
        }
        // A club created after the quarter has nothing to report for it.
        if (
          club.created_at &&
          club.created_at.getTime() >= period.endExclusiveInstant.getTime()
        ) {
          result.skipped += 1;
          continue;
        }
        try {
          const report = await this.getOrCreateDraft(
            club.club_id,
            target.year,
            target.quarter,
          );
          const frozen = await this.freezeReport(report.quarterly_report_id);
          if (frozen) {
            result.success += 1;
            this.logger.log(
              `Froze quarterly report for club ${club.name} (${target.year} Q${target.quarter})`,
            );
          } else {
            result.skipped += 1;
          }
        } catch (err) {
          result.errors += 1;
          this.logger.error(
            `Failed to freeze quarterly report for club ${club.club_id} (${target.year} Q${target.quarter}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    return result;
  }

  // ========================================
  // GET SINGLE
  // ========================================

  /** A draft is recomputed first, so the answer is live; a finalized one is the snapshot. */
  async getReport(reportId: number) {
    await this.refreshDraft(reportId);
    return this.loadReport(reportId);
  }

  private async loadReport(reportId: number) {
    const report = await this.prisma.quarterly_reports.findUnique({
      where: { quarterly_report_id: reportId },
      include: {
        club: {
          include: {
            churches: { select: { name: true } },
            districts: { select: { name: true } },
          },
        },
        finalized_by_user: {
          select: { user_id: true, name: true, paternal_last_name: true },
        },
      },
    });

    if (!report) {
      throw new AppNotFoundException(ErrorCode.QUARTERLY_REPORT_NOT_FOUND);
    }

    return report;
  }

  // ========================================
  // LIST FOR ADMIN
  // ========================================

  async listForAdmin(
    userId: string,
    filters: {
      divisionId?: number;
      unionId?: number;
      localFieldId?: number;
      clubId?: number;
      year?: number;
      quarter?: number;
      status?: PeriodicReportStatus;
      page?: number;
      limit?: number;
    },
  ) {
    const clubWhere = await this.actorReportClubWhere(userId, {
      divisionId: filters.divisionId,
      unionId: filters.unionId,
      localFieldId: filters.localFieldId,
    });

    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 25, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.quarterly_reportsWhereInput = {
      ...(filters.clubId !== undefined && { club_id: filters.clubId }),
      ...(filters.year !== undefined && { year: filters.year }),
      ...(filters.quarter !== undefined && { quarter: filters.quarter }),
      ...(filters.status && { status: filters.status }),
      ...(Object.keys(clubWhere).length > 0 && { club: clubWhere }),
    };

    const [total, items] = await Promise.all([
      this.prisma.quarterly_reports.count({ where }),
      this.prisma.quarterly_reports.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ year: 'desc' }, { quarter: 'desc' }],
        include: {
          club: { select: { club_id: true, name: true } },
          finalized_by_user: {
            select: { user_id: true, name: true, paternal_last_name: true },
          },
        },
      }),
    ]);

    return { total, page, limit, items };
  }

  // ========================================
  // ACTOR VISIBILITY
  // ========================================

  /**
   * Territory for territorial roles, the active club section otherwise.
   * Coordinators (coordinator-only actors) are denied with
   * PERIODIC_REPORTS_FORBIDDEN: quarterly and annual reports are not for them.
   */
  private async actorReportClubWhere(
    userId: string,
    filters: ReportVisibilityFilters = {},
  ): Promise<Prisma.clubsWhereInput> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);
    const reportScope = resolvePeriodicReportVisibilityScopeForActor(
      resolved,
      filters,
    );
    return buildReportClubWhere(reportScope);
  }

  /** Club routes: coordinators are denied like on the admin routes. */
  async assertPeriodicReportsAccess(userId: string): Promise<void> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);
    if (isCoordinatorOnlyForPeriodicReports(resolved)) {
      throw new AppForbiddenException(ErrorCode.PERIODIC_REPORTS_FORBIDDEN);
    }
  }

  /**
   * Every admin route that takes a report id calls this first. A report that
   * does not exist and one outside the actor's visibility both answer 404, so
   * ids outside the scope cannot be probed.
   */
  async assertReportVisibleToActor(
    userId: string,
    reportId: number,
  ): Promise<void> {
    const clubWhere = await this.actorReportClubWhere(userId);
    const report = await this.prisma.quarterly_reports.findFirst({
      where: {
        quarterly_report_id: reportId,
        ...(Object.keys(clubWhere).length > 0 && { club: clubWhere }),
      },
      select: { quarterly_report_id: true },
    });

    if (!report) {
      throw new AppNotFoundException(ErrorCode.QUARTERLY_REPORT_NOT_FOUND);
    }
  }

  /**
   * Admin routes that act on a club (no report id yet) call this first. A
   * missing or inactive club answers 404; an existing club outside the
   * actor's scope 403.
   */
  async assertClubVisibleToActor(
    userId: string,
    clubId: number,
  ): Promise<void> {
    const clubWhere = await this.actorReportClubWhere(userId);

    const club = await this.prisma.clubs.findUnique({
      where: { club_id: clubId },
      select: { club_id: true, active: true },
    });

    if (!club || !club.active) {
      throw new AppNotFoundException(ErrorCode.QUARTERLY_REPORT_CLUB_NOT_FOUND);
    }

    if (Object.keys(clubWhere).length === 0) return;

    const visible = await this.prisma.clubs.findFirst({
      where: { club_id: clubId, ...clubWhere },
      select: { club_id: true },
    });

    if (!visible) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
  }

  /** Club routes: the report must belong to the club in the path (404 otherwise). */
  async assertReportBelongsToClub(
    clubId: number,
    reportId: number,
  ): Promise<void> {
    const report = await this.prisma.quarterly_reports.findFirst({
      where: { quarterly_report_id: reportId, club_id: clubId },
      select: { quarterly_report_id: true },
    });

    if (!report) {
      throw new AppNotFoundException(ErrorCode.QUARTERLY_REPORT_NOT_FOUND);
    }
  }

  // ========================================
  // LIST FOR CLUB (user-facing)
  // ========================================

  async listForClub(clubId: number, year?: number) {
    await this.validateClubExists(clubId);

    return this.prisma.quarterly_reports.findMany({
      where: {
        club_id: clubId,
        ...(year !== undefined && { year }),
      },
      orderBy: [{ year: 'desc' }, { quarter: 'desc' }],
      include: {
        finalized_by_user: {
          select: { user_id: true, name: true, paternal_last_name: true },
        },
      },
    });
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  /** A quarter that starts after today (Mexico City civil day) has no data yet. */
  private assertQuarterStarted(year: number, quarter: number) {
    const quarterStart = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
    if (quarterStart.getTime() > reportsToday().getTime()) {
      throw new AppBadRequestException(ErrorCode.REPORT_PERIOD_IN_FUTURE);
    }
  }

  private validateQuarterYear(quarter: number, year: number) {
    if (quarter < 1 || quarter > 4) {
      throw new AppBadRequestException(
        ErrorCode.QUARTERLY_REPORT_INVALID_QUARTER,
      );
    }
    if (year < 2020 || year > 2100) {
      throw new AppBadRequestException(ErrorCode.QUARTERLY_REPORT_INVALID_YEAR);
    }
  }

  private async validateClubExists(clubId: number) {
    const club = await this.prisma.clubs.findUnique({
      where: { club_id: clubId },
    });
    if (!club) {
      throw new AppNotFoundException(ErrorCode.QUARTERLY_REPORT_CLUB_NOT_FOUND);
    }
    return club;
  }
}

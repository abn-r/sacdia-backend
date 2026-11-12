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
  addDaysUtc,
  ecclesiasticalYearPeriod,
  isPastGrace,
  reportsToday,
  type YearMonth,
} from '../reports/periodic-report-period';
import { formatYearLabel } from './year-label';
import type { PeriodicReportStatus } from '../quarterly-reports/quarterly-reports.service';

// ============================================================
// Shape of the computed_data JSON column
// ============================================================

/**
 * Figures that used to be typed by hand, now computed from the SUBMITTED
 * monthly reports of the ecclesiastical year (all sections of the club).
 * Everything but `camporees_attended` is null when no monthly report of the
 * year was submitted (the PDF prints "—").
 */
export interface AnnualMonthlyData {
  /** Distinct months of the year with a submitted monthly report. */
  months_submitted: number;
  /** Those months, oldest first. */
  months_covered: YearMonth[];
  /** Sum over the submitted months. */
  planning_meetings: number | null;
  parent_meetings: number | null;
  /** Sum of `baptized_this_month`. */
  baptized_this_year: number | null;
  /** Value of the latest submitted month. */
  total_baptized: number | null;
  /** No monthly source: always null for now (the PDF prints a dash). */
  annual_achievements_description: MonthlyTextEntry[] | null;
  /** One entry per submitted month with text, oldest first. */
  community_service_description: MonthlyTextEntry[] | null;
  /** No monthly source: always null for now (the PDF prints a dash). */
  all_investitures_completed: boolean | null;
  /** Distinct camporees (registered/approved, starting in the year); not monthly data. */
  camporees_attended: number;
}

export interface AnnualComputedData {
  ecclesiastical_year_id: number;
  year_label: string;
  /** Distinct people with a club assignment that overlapped the year. */
  member_count: number;
  /** Distinct months with a monthly report that is not a draft. */
  months_reported: number;
  /** Board roles held at any time during the year. */
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
    /** Net of the year (income - expenses). */
    balance: number;
    /** Cash on hand: all-time cumulative net up to the end of the year. */
    total_balance: number;
    transactions: number;
  };
  missionary: {
    /** Same value as `monthly_data.baptized_this_year`. */
    baptized_total: number | null;
  };
  top_achievers: { user_id: string; name: string; honors_count: number }[];
  monthly_data: AnnualMonthlyData;
}

@Injectable()
export class AnnualReportsService {
  private readonly logger = new Logger(AnnualReportsService.name);
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

  async getOrCreateDraft(clubId: number, ecclesiasticalYearId: number) {
    await this.validateClubExists(clubId);
    await this.validateEcclesiasticalYearExists(ecclesiasticalYearId);

    const existing = await this.prisma.annual_reports.findUnique({
      where: {
        club_id_ecclesiastical_year_id: {
          club_id: clubId,
          ecclesiastical_year_id: ecclesiasticalYearId,
        },
      },
    });

    if (existing) return existing;

    try {
      return await this.prisma.annual_reports.create({
        data: {
          club_id: clubId,
          ecclesiastical_year_id: ecclesiasticalYearId,
          status: 'draft',
        },
      });
    } catch (error) {
      // Two generate requests for the same year: the loser reads the winner's row.
      if ((error as { code?: string }).code !== 'P2002') throw error;
      return this.prisma.annual_reports.findUniqueOrThrow({
        where: {
          club_id_ecclesiastical_year_id: {
            club_id: clubId,
            ecclesiastical_year_id: ecclesiasticalYearId,
          },
        },
      });
    }
  }

  // ========================================
  // GENERATE ON DEMAND
  // ========================================

  /**
   * Creates the annual report for the club/ecclesiastical year when it does
   * not exist. A draft is recomputed live; when the year ended more than the
   * grace period ago the draft is frozen (finalized, `finalized_by` null). A
   * finalized report is returned untouched. Same shape as `getReport`.
   * Callers must have checked club visibility first.
   */
  async generateOnDemand(clubId: number, ecclesiasticalYearId: number) {
    const eccYear =
      await this.validateEcclesiasticalYearExists(ecclesiasticalYearId);

    // The year must have started (Mexico City civil day); nothing to report before.
    const today = reportsToday();
    if (eccYear.start_date.getTime() > today.getTime()) {
      throw new AppBadRequestException(ErrorCode.REPORT_PERIOD_IN_FUTURE);
    }

    const report = await this.getOrCreateDraft(clubId, ecclesiasticalYearId);

    if (report.status === 'draft') {
      const graceDays = await this.data.getFreezeGraceDays();
      if (isPastGrace(eccYear.end_date, today, graceDays)) {
        await this.freezeReport(report.annual_report_id);
      } else {
        await this.refreshDraft(report.annual_report_id);
      }
    }

    return this.loadReport(report.annual_report_id);
  }

  // ========================================
  // COMPUTE (build computed_data from the full ecclesiastical year)
  // ========================================

  async computeData(
    clubId: number,
    ecclesiasticalYearId: number,
  ): Promise<AnnualComputedData> {
    await this.validateClubExists(clubId);
    const eccYear =
      await this.validateEcclesiasticalYearExists(ecclesiasticalYearId);

    // The year's own months (DATE columns are UTC midnights), so the finance
    // range covers exactly the ecclesiastical year, whatever its calendar span.
    const period = ecclesiasticalYearPeriod(eccYear);
    const base = await this.data.compute(clubId, period);
    const monthly = base.monthly;
    const monthsReported = await this.data.countReportedMonths(
      base.sectionIds,
      period,
    );

    const achievers = new Map<
      string,
      { user_id: string; name: string; honors_count: number }
    >();
    for (const h of base.honors) {
      if (!h.validate) continue;
      const entry = achievers.get(h.user_id) ?? {
        user_id: h.user_id,
        name: [h.users.name, h.users.paternal_last_name]
          .filter(Boolean)
          .join(' '),
        honors_count: 0,
      };
      entry.honors_count += 1;
      achievers.set(h.user_id, entry);
    }
    const topAchievers = Array.from(achievers.values())
      .sort((a, b) => b.honors_count - a.honors_count)
      .slice(0, 10);

    return {
      ecclesiastical_year_id: ecclesiasticalYearId,
      year_label: formatYearLabel(
        eccYear.start_date.getUTCFullYear(),
        eccYear.end_date.getUTCFullYear(),
      ),
      member_count: base.memberCount,
      months_reported: monthsReported,
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
      missionary: { baptized_total: monthly.baptized },
      top_achievers: topAchievers,
      monthly_data: {
        months_submitted: monthly.months_submitted,
        months_covered: monthly.months_covered,
        planning_meetings: monthly.planning_meetings,
        parent_meetings: monthly.parent_meetings,
        baptized_this_year: monthly.baptized,
        total_baptized: monthly.total_baptized,
        annual_achievements_description: null,
        community_service_description: monthly.community_service_description,
        all_investitures_completed: null,
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
    const report = await this.prisma.annual_reports.findUnique({
      where: { annual_report_id: reportId },
      select: { club_id: true, ecclesiastical_year_id: true, status: true },
    });
    if (!report) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_REPORT_NOT_FOUND);
    }
    if (report.status !== 'draft') return;

    const computed = await this.computeData(
      report.club_id,
      report.ecclesiastical_year_id,
    );
    await this.prisma.annual_reports.updateMany({
      where: { annual_report_id: reportId, status: 'draft' },
      data: {
        computed_data: computed as unknown as Prisma.InputJsonValue,
        auto_generated_at: new Date(),
      },
    });
  }

  /**
   * Freezes a draft: computes the snapshot and marks it finalized with
   * `finalized_by` null (automatic). Idempotent and conditional on
   * `status = 'draft'`. Returns whether this call froze it.
   */
  async freezeReport(reportId: number): Promise<boolean> {
    const report = await this.prisma.annual_reports.findUnique({
      where: { annual_report_id: reportId },
      select: { club_id: true, ecclesiastical_year_id: true, status: true },
    });
    if (!report) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_REPORT_NOT_FOUND);
    }
    if (report.status !== 'draft') return false;

    const computed = await this.computeData(
      report.club_id,
      report.ecclesiastical_year_id,
    );
    const now = new Date();
    const result = await this.prisma.annual_reports.updateMany({
      where: { annual_report_id: reportId, status: 'draft' },
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
   * concurrently.
   */
  async regenerate(reportId: number) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const report = await this.prisma.annual_reports.findUnique({
        where: { annual_report_id: reportId },
      });
      if (!report) {
        throw new AppNotFoundException(ErrorCode.ANNUAL_REPORT_NOT_FOUND);
      }

      const computed = await this.computeData(
        report.club_id,
        report.ecclesiastical_year_id,
      );
      const result = await this.prisma.annual_reports.updateMany({
        where: { annual_report_id: reportId, status: report.status },
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
   * Freezes the annual report of every active club for every ecclesiastical
   * year whose `end_date` is more than `graceDays` days ago and that has no
   * finalized report yet. Years are the ecclesiastical ones (they need not
   * match calendar years); history older than the previous ecclesiastical
   * year is not regenerated. Idempotent.
   */
  async freezeDueReports(
    graceDays: number,
    now: Date = new Date(),
  ): Promise<{ success: number; skipped: number; errors: number }> {
    const result = { success: 0, skipped: 0, errors: 0 };
    const today = reportsToday(now);

    const lowerBound = await resolveHistoryLowerBound(this.prisma, today);
    if (!lowerBound) return result;

    const years = await this.prisma.ecclesiastical_years.findMany({
      where: {
        start_date: { gte: lowerBound },
        end_date: { lt: addDaysUtc(today, -graceDays) },
      },
      orderBy: { start_date: 'asc' },
      select: { year_id: true, start_date: true, end_date: true },
    });
    if (years.length === 0) return result;

    const clubs = await this.prisma.clubs.findMany({
      where: { active: true },
      select: { club_id: true, name: true, created_at: true },
    });
    const finalized = await this.prisma.annual_reports.findMany({
      where: {
        status: 'finalized',
        ecclesiastical_year_id: { in: years.map((y) => y.year_id) },
      },
      select: { club_id: true, ecclesiastical_year_id: true },
    });
    const done = new Set(
      finalized.map((r) => `${r.club_id}:${r.ecclesiastical_year_id}`),
    );

    for (const year of years) {
      const period = ecclesiasticalYearPeriod(year);
      for (const club of clubs) {
        if (done.has(`${club.club_id}:${year.year_id}`)) {
          result.skipped += 1;
          continue;
        }
        // A club created after the year ended has nothing to report for it.
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
            year.year_id,
          );
          const frozen = await this.freezeReport(report.annual_report_id);
          if (frozen) {
            result.success += 1;
            this.logger.log(
              `Froze annual report for club ${club.name} (year ${year.year_id})`,
            );
          } else {
            result.skipped += 1;
          }
        } catch (err) {
          result.errors += 1;
          this.logger.error(
            `Failed to freeze annual report for club ${club.club_id} (year ${year.year_id}): ${err instanceof Error ? err.message : String(err)}`,
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
    const report = await this.prisma.annual_reports.findUnique({
      where: { annual_report_id: reportId },
      include: {
        club: {
          include: {
            churches: { select: { name: true } },
            districts: { select: { name: true } },
          },
        },
        ecclesiastical_year: true,
        finalized_by_user: {
          select: { user_id: true, name: true, paternal_last_name: true },
        },
      },
    });

    if (!report) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_REPORT_NOT_FOUND);
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
      ecclesiasticalYearId?: number;
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

    const where: Prisma.annual_reportsWhereInput = {
      ...(filters.clubId !== undefined && { club_id: filters.clubId }),
      ...(filters.ecclesiasticalYearId !== undefined && {
        ecclesiastical_year_id: filters.ecclesiasticalYearId,
      }),
      ...(filters.status && { status: filters.status }),
      ...(Object.keys(clubWhere).length > 0 && { club: clubWhere }),
    };

    const [total, items] = await Promise.all([
      this.prisma.annual_reports.count({ where }),
      this.prisma.annual_reports.findMany({
        where,
        skip,
        take: limit,
        orderBy: { ecclesiastical_year_id: 'desc' },
        include: {
          club: { select: { club_id: true, name: true } },
          ecclesiastical_year: {
            select: { year_id: true, start_date: true, end_date: true },
          },
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
    const report = await this.prisma.annual_reports.findFirst({
      where: {
        annual_report_id: reportId,
        ...(Object.keys(clubWhere).length > 0 && { club: clubWhere }),
      },
      select: { annual_report_id: true },
    });

    if (!report) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_REPORT_NOT_FOUND);
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
      throw new AppNotFoundException(ErrorCode.ANNUAL_REPORT_CLUB_NOT_FOUND);
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
    const report = await this.prisma.annual_reports.findFirst({
      where: { annual_report_id: reportId, club_id: clubId },
      select: { annual_report_id: true },
    });

    if (!report) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_REPORT_NOT_FOUND);
    }
  }

  // ========================================
  // LIST FOR CLUB (user-facing)
  // ========================================

  async listForClub(clubId: number) {
    await this.validateClubExists(clubId);

    return this.prisma.annual_reports.findMany({
      where: { club_id: clubId },
      orderBy: { ecclesiastical_year_id: 'desc' },
      include: {
        ecclesiastical_year: {
          select: { year_id: true, start_date: true, end_date: true },
        },
        finalized_by_user: {
          select: { user_id: true, name: true, paternal_last_name: true },
        },
      },
    });
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  private async validateClubExists(clubId: number) {
    const club = await this.prisma.clubs.findUnique({
      where: { club_id: clubId },
    });
    if (!club) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_REPORT_CLUB_NOT_FOUND);
    }
    return club;
  }

  private async validateEcclesiasticalYearExists(yearId: number) {
    const year = await this.prisma.ecclesiastical_years.findUnique({
      where: { year_id: yearId },
    });
    if (!year) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_REPORT_YEAR_NOT_FOUND);
    }
    return year;
  }
}

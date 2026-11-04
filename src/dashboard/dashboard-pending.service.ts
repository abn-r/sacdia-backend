import { Inject, Injectable, Logger } from '@nestjs/common';
import { annual_folder_section_status_enum } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthorizationContextService,
  type AuthorizationSnapshot,
} from '../common/services/authorization-context.service';
import { CatalogsService } from '../catalogs/catalogs.service';
import { MembershipRequestsService } from '../membership-requests/membership-requests.service';
import { InvestitureAuthorizationRequestService } from '../investiture-requests/investiture-authorization-requests.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { CLOCK, type Clock } from '../common/clock/clock';
import {
  calendarDateInZone,
  resolveMonthlyReportDue,
} from './dashboard-pending.period';
import type {
  DashboardPendingDto,
  DashboardPendingItem,
  MonthlyReportPendingStatus,
  PendingEvidenceFolderItem,
  PendingInvestitureAuthorizationsItem,
  PendingMembershipRequestsItem,
  PendingMonthlyReportItem,
  PendingSeverity,
} from './dashboard-pending.types';

const APPROVE_PERMISSION = 'club_members:approve';
const CONSENT_VERIFY_PERMISSION = 'consent:verify';
const EVIDENCE_READ_PERMISSION = 'evidence_folders:read';
const REPORT_SUBMIT_PERMISSION = 'reports:submit';

/** Same key, default and bounds as MonthlyReportsService / ReportsComplianceService. */
const DUE_DAY_CONFIG_KEY = 'reports.auto_generate_day';
const DEFAULT_DUE_DAY = 5;

/** `days_left` at or below this is urgent. */
const URGENT_DAYS_LEFT = 3;

const SEVERITY_RANK: Record<PendingSeverity, number> = {
  urgent: 0,
  warning: 1,
  info: 2,
};

export interface DashboardPendingOptions {
  /** Same meaning as in DashboardSummaryOptions: false => no club data at all. */
  includeClubData?: boolean;
}

type ActiveSection = {
  sectionId: number;
  /** Permissions of the ACTIVE club assignment only (never global/direct ones). */
  permissions: Set<string>;
};

type EnrollmentContext = {
  enrollmentId: string;
  status: string;
};

@Injectable()
export class DashboardPendingService {
  private readonly logger = new Logger(DashboardPendingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly catalogs: CatalogsService,
    private readonly membershipRequests: MembershipRequestsService,
    private readonly investitureRequests: InvestitureAuthorizationRequestService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getPending(
    userId: string,
    options: DashboardPendingOptions = {},
  ): Promise<DashboardPendingDto> {
    const now = this.clock.now();
    if (!(options.includeClubData ?? true)) {
      return this.build(null, [], now);
    }

    const { authorization } =
      await this.authorizationContext.resolveUserAuthorization(userId);
    const section = this.resolveActiveSection(authorization);

    // The enrollment of the active section in the current year is shared by the
    // folder and the monthly report: read it once, lazily.
    let enrollment: Promise<EnrollmentContext | null> | null = null;
    const loadEnrollment = (): Promise<EnrollmentContext | null> => {
      enrollment ??= this.loadEnrollment(section!.sectionId);
      return enrollment;
    };

    const tasks: Array<[string, () => Promise<DashboardPendingItem | null>]> = [
      [
        'membership_requests',
        () => this.membershipRequestsItem(userId, section),
      ],
      [
        'evidence_folder',
        () => this.evidenceFolderItem(section, loadEnrollment),
      ],
      ['monthly_report', () => this.monthlyReportItem(section, now)],
      [
        'investiture_authorizations',
        () => this.investitureItem(userId, authorization),
      ],
    ];

    const settled = await Promise.allSettled(tasks.map(([, run]) => run()));
    const items: DashboardPendingItem[] = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (result.value) items.push(result.value);
        return;
      }
      const reason: unknown = result.reason;
      this.logger.error(
        `Dashboard pending: "${tasks[index][0]}" failed for user ${userId}; item omitted.`,
        reason instanceof Error ? reason.stack : String(reason),
      );
    });

    return this.build(section?.sectionId ?? null, items, now);
  }

  // ----------------------------------------
  // Assembly
  // ----------------------------------------

  private build(
    sectionId: number | null,
    items: DashboardPendingItem[],
    now: Date,
  ): DashboardPendingDto {
    // Array.prototype.sort is stable: ties keep the contract order.
    const ordered = [...items].sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
    );
    return {
      section_id: sectionId,
      generated_at: now.toISOString(),
      total: ordered.reduce((sum, item) => sum + item.count, 0),
      urgent: ordered.filter((item) => item.severity === 'urgent').length,
      items: ordered,
    };
  }

  /**
   * Active section = the one of the user's effective active club assignment
   * (users_pr.active_club_assignment_id, falling back to the first operational
   * grant): the same resolution AuthorizationContextService gives PermissionsGuard
   * for `active_assignment` routes.
   */
  private resolveActiveSection(
    authorization: AuthorizationSnapshot,
  ): ActiveSection | null {
    const active = authorization.effective?.scope?.club;
    if (!active) return null;
    const grant = authorization.grants.club_assignments.find(
      (candidate) => candidate.assignment_id === active.assignment_id,
    );
    return {
      sectionId: active.section.club_section_id,
      permissions: new Set(grant?.permissions ?? []),
    };
  }

  // ----------------------------------------
  // membership_requests
  // ----------------------------------------

  private async membershipRequestsItem(
    userId: string,
    section: ActiveSection | null,
  ): Promise<PendingMembershipRequestsItem | null> {
    if (!section) return null;
    const canApprove = section.permissions.has(APPROVE_PERMISSION);
    const canVerify = section.permissions.has(CONSENT_VERIFY_PERMISSION);
    if (!canApprove && !canVerify) return null;

    // Reuse the list endpoint's service so the count is exactly what
    // GET /club-sections/:sectionId/membership-requests returns for this user
    // (approve => every pending request; verify-only => only the ones with
    // verify work). A direct club_role_assignments COUNT would add a predicate
    // to the frozen club-assignment-effectivity inventory for no real gain: a
    // section's pending queue is small.
    const rows = await this.membershipRequests.listPending(
      section.sectionId,
      userId,
      { verifyOnly: !canApprove },
    );
    const count = rows.length;
    return count > 0
      ? { type: 'membership_requests', count, severity: 'warning' }
      : null;
  }

  // ----------------------------------------
  // evidence_folder
  // ----------------------------------------

  private async evidenceFolderItem(
    section: ActiveSection | null,
    loadEnrollment: () => Promise<EnrollmentContext | null>,
  ): Promise<PendingEvidenceFolderItem | null> {
    if (!section?.permissions.has(EVIDENCE_READ_PERMISSION)) return null;
    const enrollment = await loadEnrollment();
    if (!enrollment) return null;

    const folder = await this.prisma.annual_folders.findUnique({
      where: { club_enrollment_id: enrollment.enrollmentId },
      select: {
        annual_folder_id: true,
        status: true,
        folder_template: {
          select: { _count: { select: { sections: true } } },
        },
      },
    });
    if (!folder || folder.status === 'closed') return null;

    // Section status = status of its evaluation row (created eagerly, PENDING,
    // with the folder). A template section without a row counts as PENDING.
    const grouped = await this.prisma.annual_folder_section_evaluations.groupBy(
      {
        by: ['status'],
        where: { annual_folder_id: folder.annual_folder_id },
        _count: { _all: true },
      },
    );
    const countOf = (status: annual_folder_section_status_enum): number =>
      grouped.find((row) => row.status === status)?._count._all ?? 0;
    const evaluated = grouped.reduce((sum, row) => sum + row._count._all, 0);
    const rejected = countOf(annual_folder_section_status_enum.REJECTED);
    const notSubmitted =
      countOf(annual_folder_section_status_enum.PENDING) +
      Math.max(0, folder.folder_template._count.sections - evaluated);

    const count = rejected + notSubmitted;
    if (count === 0) return null;
    return {
      type: 'evidence_folder',
      count,
      rejected_count: rejected,
      not_submitted_count: notSubmitted,
      severity: rejected > 0 ? 'urgent' : 'warning',
    };
  }

  // ----------------------------------------
  // monthly_report
  // ----------------------------------------

  private async monthlyReportItem(
    section: ActiveSection | null,
    now: Date,
  ): Promise<PendingMonthlyReportItem | null> {
    if (!section?.permissions.has(REPORT_SUBMIT_PERMISSION)) return null;

    const dueDay = await this.resolveDueDay();
    const due = resolveMonthlyReportDue(calendarDateInZone(now), dueDay);

    // The report belongs to the enrollment of the ecclesiastical year the
    // PERIOD falls in, which across a year boundary is not the current year
    // (e.g. a December period read in January). The latest-starting year wins
    // when two overlap the month.
    const periodStart = new Date(
      Date.UTC(due.period_year, due.period_month - 1, 1),
    );
    const periodEnd = new Date(Date.UTC(due.period_year, due.period_month, 0));
    const periodYear = await this.prisma.ecclesiastical_years.findFirst({
      where: { start_date: { lte: periodEnd }, end_date: { gte: periodStart } },
      orderBy: { start_date: 'desc' },
      select: { year_id: true, start_date: true, end_date: true },
    });
    if (!periodYear) return null;

    const enrollment = await this.findEnrollment(
      section.sectionId,
      periodYear.year_id,
    );
    // Auto-generation only covers active enrollments.
    if (!enrollment || enrollment.status !== 'active') return null;

    // The period month must lie inside that year's months.
    const periodIndex = due.period_year * 12 + (due.period_month - 1);
    const startIndex =
      periodYear.start_date.getUTCFullYear() * 12 +
      periodYear.start_date.getUTCMonth();
    const endIndex =
      periodYear.end_date.getUTCFullYear() * 12 +
      periodYear.end_date.getUTCMonth();
    if (periodIndex < startIndex || periodIndex > endIndex) return null;

    const report = await this.prisma.monthly_reports.findUnique({
      where: {
        club_enrollment_id_month_year: {
          club_enrollment_id: enrollment.enrollmentId,
          month: due.period_month,
          year: due.period_year,
        },
      },
      select: { status: true },
    });

    let reportStatus: MonthlyReportPendingStatus;
    if (!report) {
      reportStatus = 'missing';
    } else if (
      report.status === 'draft' ||
      report.status === 'generated' ||
      report.status === 'rejected'
    ) {
      reportStatus = report.status;
    } else {
      // submitted / approved (or any future closed state): nothing to do.
      return null;
    }

    return {
      type: 'monthly_report',
      count: 1,
      period_month: due.period_month,
      period_year: due.period_year,
      report_status: reportStatus,
      due_date: due.due_date,
      days_left: due.days_left,
      severity:
        due.days_left <= URGENT_DAYS_LEFT || reportStatus === 'rejected'
          ? 'urgent'
          : 'warning',
    };
  }

  private async resolveDueDay(): Promise<number> {
    const config = await this.prisma.system_config.findUnique({
      where: { config_key: DUE_DAY_CONFIG_KEY },
      select: { config_value: true },
    });
    const parsed = config ? Number(config.config_value) : DEFAULT_DUE_DAY;
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 28
      ? parsed
      : DEFAULT_DUE_DAY;
  }

  // ----------------------------------------
  // investiture_authorizations (NOT section-scoped)
  // ----------------------------------------

  private async investitureItem(
    userId: string,
    authorization: AuthorizationSnapshot,
  ): Promise<PendingInvestitureAuthorizationsItem | null> {
    const year = await this.catalogs.getCurrentEcclesiasticalYear();
    if (!year) return null;

    let requests: Awaited<
      ReturnType<InvestitureAuthorizationRequestService['listForAuthorizer']>
    >;
    try {
      // Same call as GET /investiture-requests?ecclesiastical_year_id=<current>.
      requests = await this.investitureRequests.listForAuthorizer(
        authorization,
        userId,
        year.ecclesiastical_year_id,
      );
    } catch (error) {
      // Not an authorizer (not pastor / director-lf / assistant-lf with scope):
      // the endpoint answers 403; here it just means "no item".
      if (
        error instanceof AppException &&
        error.code === ErrorCode.INVESTITURE_REQUEST_FORBIDDEN
      ) {
        return null;
      }
      throw error;
    }

    const count = requests.reduce(
      (sum, request) => sum + (request.pending_count ?? 0),
      0,
    );
    return count > 0
      ? { type: 'investiture_authorizations', count, severity: 'info' }
      : null;
  }

  // ----------------------------------------
  // Shared
  // ----------------------------------------

  private async loadEnrollment(
    sectionId: number,
  ): Promise<EnrollmentContext | null> {
    const year = await this.catalogs.getCurrentEcclesiasticalYear();
    if (!year) return null;
    return this.findEnrollment(sectionId, year.ecclesiastical_year_id);
  }

  private async findEnrollment(
    sectionId: number,
    yearId: number,
  ): Promise<EnrollmentContext | null> {
    const enrollment = await this.prisma.club_enrollments.findUnique({
      where: {
        club_section_id_ecclesiastical_year_id: {
          club_section_id: sectionId,
          ecclesiastical_year_id: yearId,
        },
      },
      select: { club_enrollment_id: true, status: true },
    });
    if (!enrollment) return null;
    return {
      enrollmentId: enrollment.club_enrollment_id,
      status: enrollment.status,
    };
  }
}

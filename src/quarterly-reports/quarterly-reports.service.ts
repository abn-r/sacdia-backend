import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppBadRequestException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { DEFAULT_AGE_TIMEZONE, calendarDateIn } from '../common/age/age.util';
import { ErrorCode } from '../common/errors/error-codes';
import { UpdateQuarterlyManualDataDto } from './dto';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { CoordinationService } from '../coordination/coordination.service';
import {
  buildReportClubWhere,
  resolveReportVisibilityScopeForActor,
  type ReportVisibilityFilters,
} from '../reports/report-visibility-scope';
import {
  CLUB_DIRECTIVA_ROLES,
  directivaRoleOrder,
} from '../common/constants/club-directiva-roles';

// ============================================================
// Shape of the computed_data JSON column
// ============================================================

export interface QuarterlyComputedData {
  quarter_label: string;
  year: number;
  quarter: number;
  months_in_quarter: number[];
  member_count: number;
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
    balance: number;
    transactions: number;
  };
  missionary: {
    baptized_this_quarter: number;
  };
}

@Injectable()
export class QuarterlyReportsService {
  private readonly logger = new Logger(QuarterlyReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly coordinationService: CoordinationService,
  ) {}

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

    return this.prisma.quarterly_reports.create({
      data: { club_id: clubId, year, quarter, status: 'draft' },
    });
  }

  // ========================================
  // GENERATE ON DEMAND (admin: create the row if missing, compute if draft)
  // ========================================

  /**
   * Creates the quarterly report for the club/period when it does not exist and
   * recomputes its data while it is a draft. A finalized or archived report is
   * returned untouched (its snapshot is frozen). Returns the same shape as
   * `getReport`. Callers must have checked club visibility first.
   */
  async generateOnDemand(clubId: number, year: number, quarter: number) {
    this.validateQuarterYear(quarter, year);
    this.assertQuarterStarted(year, quarter);

    const report = await this.getOrCreateDraft(clubId, year, quarter);

    if (report.status === 'draft') {
      await this.regenerate(report.quarterly_report_id);
    }

    return this.getReport(report.quarterly_report_id);
  }

  // ========================================
  // COMPUTE (build computed_data from monthly data)
  // ========================================

  async computeData(
    clubId: number,
    year: number,
    quarter: number,
  ): Promise<QuarterlyComputedData> {
    this.validateQuarterYear(quarter, year);
    await this.validateClubExists(clubId);

    const months = this.getMonthsForQuarter(quarter);

    // Find club sections for this club
    const sections = await this.prisma.club_sections.findMany({
      where: { main_club_id: clubId, active: true },
      select: { club_section_id: true },
    });

    // Also try direct sections where club owns them (via clubs relation)
    const sectionsFromClub = await this.prisma.club_sections.findMany({
      where: {
        clubs: { club_id: clubId },
        active: true,
      },
      select: { club_section_id: true },
    });

    const allSectionIds = [
      ...new Set([
        ...sections.map((s) => s.club_section_id),
        ...sectionsFromClub.map((s) => s.club_section_id),
      ]),
    ];

    // Find active ecclesiastical year for this calendar year range
    const ecclesiasticalYear = await this.prisma.ecclesiastical_years.findFirst(
      {
        where: { active: true },
      },
    );

    const yearId = ecclesiasticalYear?.year_id;

    // ── Member count (from active assignments across sections) ──
    let memberCount = 0;
    if (allSectionIds.length > 0 && yearId) {
      memberCount = await this.prisma.club_role_assignments.count({
        where: {
          club_section_id: { in: allSectionIds },
          ecclesiastical_year_id: yearId,
          active: true,
        },
      });
    }

    // ── Directiva ──
    const directiva: { role: string; user_id: string; name: string }[] = [];
    if (allSectionIds.length > 0 && yearId) {
      const directivaRoles = [...CLUB_DIRECTIVA_ROLES];
      const assignments = await this.prisma.club_role_assignments.findMany({
        where: {
          club_section_id: { in: allSectionIds },
          ecclesiastical_year_id: yearId,
          active: true,
          roles: { role_name: { in: directivaRoles } },
        },
        include: {
          users: {
            select: {
              user_id: true,
              name: true,
              paternal_last_name: true,
              maternal_last_name: true,
            },
          },
          roles: { select: { role_name: true } },
        },
        distinct: ['user_id'],
      });

      for (const a of assignments) {
        directiva.push({
          role: a.roles.role_name,
          user_id: a.users.user_id,
          name: [
            a.users.name,
            a.users.paternal_last_name,
            a.users.maternal_last_name,
          ]
            .filter(Boolean)
            .join(' '),
        });
      }
      directiva.sort(
        (a, b) => directivaRoleOrder(a.role) - directivaRoleOrder(b.role),
      );
    }

    // ── Honors aggregation across the 3 months ──
    const startDate = new Date(year, months[0] - 1, 1);
    const endDate = new Date(
      year,
      months[months.length - 1],
      0,
      23,
      59,
      59,
      999,
    );

    let honorsStarted = 0;
    let honorsCompleted = 0;

    if (allSectionIds.length > 0 && yearId) {
      const memberIds = await this.prisma.club_role_assignments.findMany({
        where: {
          club_section_id: { in: allSectionIds },
          ecclesiastical_year_id: yearId,
          active: true,
        },
        select: { user_id: true },
        distinct: ['user_id'],
      });

      const ids = memberIds.map((m) => m.user_id);
      if (ids.length > 0) {
        const honors = await this.prisma.users_honors.findMany({
          where: {
            user_id: { in: ids },
            active: true,
            date: { gte: startDate, lte: endDate },
          },
          select: { validate: true },
        });
        honorsStarted = honors.length;
        honorsCompleted = honors.filter((h) => h.validate).length;
      }
    }

    // ── Activities aggregation ──
    let activitiesTotal = 0;
    if (allSectionIds.length > 0) {
      activitiesTotal = await this.prisma.activities.count({
        where: {
          club_section_id: { in: allSectionIds },
          created_at: { gte: startDate, lte: endDate },
        },
      });
    }

    // ── Finances aggregation across the 3 months ──
    let totalIncome = 0;
    let totalExpenses = 0;
    let financesTransactions = 0;

    if (allSectionIds.length > 0) {
      for (const month of months) {
        const finances = await this.prisma.finances.findMany({
          where: {
            club_section_id: { in: allSectionIds },
            month,
            year,
            active: true,
          },
          include: { finances_categories: { select: { type: true } } },
        });
        for (const f of finances) {
          if (f.finances_categories.type === 0) totalIncome += f.amount;
          else totalExpenses += f.amount;
          financesTransactions++;
        }
      }
    }

    const quarterLabel = `Q${quarter} ${year}`;

    return {
      quarter_label: quarterLabel,
      year,
      quarter,
      months_in_quarter: months,
      member_count: memberCount,
      directiva,
      honors: { started: honorsStarted, completed: honorsCompleted },
      activities: { total: activitiesTotal },
      finances: {
        income: totalIncome,
        expenses: totalExpenses,
        balance: totalIncome - totalExpenses,
        transactions: financesTransactions,
      },
      missionary: { baptized_this_quarter: 0 },
    };
  }

  // ========================================
  // GENERATE (freeze computed_data)
  // ========================================

  async generate(reportId: number, _triggeredBy: string) {
    const report = await this.prisma.quarterly_reports.findUnique({
      where: { quarterly_report_id: reportId },
    });

    if (!report) {
      throw new AppNotFoundException(ErrorCode.QUARTERLY_REPORT_NOT_FOUND);
    }

    if (report.status !== 'draft') {
      throw new AppBadRequestException(ErrorCode.QUARTERLY_REPORT_NOT_DRAFT);
    }

    const computed = await this.computeData(
      report.club_id,
      report.year,
      report.quarter,
    );

    return this.prisma.quarterly_reports.update({
      where: { quarterly_report_id: reportId },
      data: {
        computed_data: computed as any,
        auto_generated_at: new Date(),
        status: 'draft', // remains draft until explicitly finalized
      },
    });
  }

  // ========================================
  // UPDATE MANUAL DATA
  // ========================================

  async updateManualData(reportId: number, dto: UpdateQuarterlyManualDataDto) {
    const report = await this.prisma.quarterly_reports.findUnique({
      where: { quarterly_report_id: reportId },
    });

    if (!report) {
      throw new AppNotFoundException(ErrorCode.QUARTERLY_REPORT_NOT_FOUND);
    }

    if (report.status !== 'draft') {
      throw new AppBadRequestException(ErrorCode.QUARTERLY_REPORT_NOT_DRAFT);
    }

    const existing = (report.manual_data as Record<string, unknown>) ?? {};
    const merged = { ...existing, ...this.buildManualPayload(dto) };

    return this.prisma.quarterly_reports.update({
      where: { quarterly_report_id: reportId },
      data: { manual_data: merged as any },
    });
  }

  // ========================================
  // FINALIZE
  // ========================================

  async finalize(reportId: number, userId: string) {
    const report = await this.prisma.quarterly_reports.findUnique({
      where: { quarterly_report_id: reportId },
    });

    if (!report) {
      throw new AppNotFoundException(ErrorCode.QUARTERLY_REPORT_NOT_FOUND);
    }

    if (report.status !== 'draft') {
      throw new AppBadRequestException(ErrorCode.QUARTERLY_REPORT_NOT_DRAFT);
    }

    return this.prisma.quarterly_reports.update({
      where: { quarterly_report_id: reportId },
      data: {
        status: 'finalized',
        finalized_at: new Date(),
        finalized_by: userId,
      },
    });
  }

  // ========================================
  // GET SINGLE
  // ========================================

  async getReport(reportId: number) {
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
      status?: string;
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

    const where: any = {
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
  // ACTOR VISIBILITY (admin routes)
  // ========================================

  /**
   * Same visibility as the admin list: territory for territorial roles, the
   * coordinator's assigned sections (coordinator_assignments) for coordinators,
   * the active club section otherwise. A club is visible to a coordinator when
   * one of its sections is in their scope.
   */
  private async actorReportClubWhere(
    userId: string,
    filters: ReportVisibilityFilters = {},
  ): Promise<Prisma.clubsWhereInput> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);
    const reportScope = await resolveReportVisibilityScopeForActor(
      resolved,
      filters,
      () => this.coordinationService.getEffectiveCoordinatorSectionIds(userId),
    );
    return buildReportClubWhere(reportScope);
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
   * Admin routes that act on a club (no report id yet) call this first. Uses
   * the same territorial scope as the list and the by-id routes. A missing or
   * inactive club answers 404; an existing club outside the actor's scope 403.
   */
  async assertClubVisibleToActor(
    userId: string,
    clubId: number,
  ): Promise<void> {
    const club = await this.prisma.clubs.findUnique({
      where: { club_id: clubId },
      select: { club_id: true, active: true },
    });

    if (!club || !club.active) {
      throw new AppNotFoundException(ErrorCode.QUARTERLY_REPORT_CLUB_NOT_FOUND);
    }

    const clubWhere = await this.actorReportClubWhere(userId);
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
  // REGENERATE (re-run compute, admin only)
  // ========================================

  async regenerate(reportId: number) {
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

    return this.prisma.quarterly_reports.update({
      where: { quarterly_report_id: reportId },
      data: {
        computed_data: computed as any,
        auto_generated_at: new Date(),
        // Keep existing status — regenerate only refreshes data
      },
    });
  }

  // ========================================
  // AUTO-GENERATE (called by cron)
  // ========================================

  async autoGenerateForAllClubs(
    year: number,
    quarter: number,
  ): Promise<{ success: number; skipped: number; errors: number }> {
    const clubs = await this.prisma.clubs.findMany({
      where: { active: true },
      select: { club_id: true, name: true },
    });

    let success = 0;
    let skipped = 0;
    let errors = 0;

    for (const club of clubs) {
      try {
        const existing = await this.prisma.quarterly_reports.findUnique({
          where: {
            club_id_year_quarter: { club_id: club.club_id, year, quarter },
          },
        });

        if (existing && existing.status !== 'draft') {
          skipped++;
          continue;
        }

        let report = existing;
        if (!report) {
          report = await this.prisma.quarterly_reports.create({
            data: { club_id: club.club_id, year, quarter, status: 'draft' },
          });
        }

        const computed = await this.computeData(club.club_id, year, quarter);

        await this.prisma.quarterly_reports.update({
          where: { quarterly_report_id: report.quarterly_report_id },
          data: {
            computed_data: computed as any,
            auto_generated_at: new Date(),
          },
        });

        success++;
        this.logger.log(
          `Auto-generated quarterly report for club ${club.name} (${year} Q${quarter})`,
        );
      } catch (err) {
        errors++;
        this.logger.error(
          `Failed to auto-generate quarterly report for club ${club.club_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { success, skipped, errors };
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  private getMonthsForQuarter(quarter: number): number[] {
    return [quarter * 3 - 2, quarter * 3 - 1, quarter * 3];
  }

  /** A quarter that starts after today (Mexico City civil day) has no data yet. */
  private assertQuarterStarted(year: number, quarter: number) {
    const quarterStart = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
    const today = calendarDateIn(DEFAULT_AGE_TIMEZONE);
    if (quarterStart.getTime() > today.getTime()) {
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

  private buildManualPayload(
    dto: UpdateQuarterlyManualDataDto,
  ): Record<string, unknown> {
    const fields: (keyof UpdateQuarterlyManualDataDto)[] = [
      'planning_meetings',
      'parent_meetings',
      'youth_council_attendance',
      'church_board_attendance',
      'soul_target',
      'baptized_this_quarter',
      'club_participation_description',
      'community_service_description',
      'camporees_attended',
      'certificates_delivered',
    ];

    const payload: Record<string, unknown> = {};
    for (const field of fields) {
      if (dto[field] !== undefined) {
        payload[field] = dto[field];
      }
    }
    return payload;
  }
}

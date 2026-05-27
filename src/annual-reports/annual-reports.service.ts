import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppBadRequestException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { UpdateAnnualManualDataDto } from './dto';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import {
  buildReportClubWhere,
  resolveReportVisibilityScope,
} from '../reports/report-visibility-scope';

// ============================================================
// Shape of the computed_data JSON column
// ============================================================

export interface AnnualComputedData {
  ecclesiastical_year_id: number;
  year_label: string;
  member_count: number;
  months_reported: number;
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
    baptized_total: number;
  };
  ranking_percentile: number | null;
  top_achievers: { user_id: string; name: string; honors_count: number }[];
}

@Injectable()
export class AnnualReportsService {
  private readonly logger = new Logger(AnnualReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

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

    return this.prisma.annual_reports.create({
      data: {
        club_id: clubId,
        ecclesiastical_year_id: ecclesiasticalYearId,
        status: 'draft',
      },
    });
  }

  // ========================================
  // COMPUTE (build computed_data from full ecclesiastical year)
  // ========================================

  async computeData(
    clubId: number,
    ecclesiasticalYearId: number,
  ): Promise<AnnualComputedData> {
    await this.validateClubExists(clubId);
    const eccYear =
      await this.validateEcclesiasticalYearExists(ecclesiasticalYearId);

    const startDate = eccYear.start_date;
    const endDate = eccYear.end_date;

    // Find active club sections for this club
    const sectionsFromClub = await this.prisma.club_sections.findMany({
      where: {
        clubs: { club_id: clubId },
        active: true,
      },
      select: { club_section_id: true },
    });

    const allSectionIds = sectionsFromClub.map((s) => s.club_section_id);

    // ── Member count ──
    let memberCount = 0;
    if (allSectionIds.length > 0) {
      memberCount = await this.prisma.club_role_assignments.count({
        where: {
          club_section_id: { in: allSectionIds },
          ecclesiastical_year_id: ecclesiasticalYearId,
          active: true,
        },
      });
    }

    // ── Directiva ──
    const directiva: { role: string; user_id: string; name: string }[] = [];
    if (allSectionIds.length > 0) {
      const directivaRoles = [
        'director',
        'subdirector',
        'secretario',
        'tesorero',
      ];
      const assignments = await this.prisma.club_role_assignments.findMany({
        where: {
          club_section_id: { in: allSectionIds },
          ecclesiastical_year_id: ecclesiasticalYearId,
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
    }

    // ── Honors ──
    let honorsStarted = 0;
    let honorsCompleted = 0;
    const topAchieversMap = new Map<
      string,
      { user_id: string; name: string; honors_count: number }
    >();

    if (allSectionIds.length > 0) {
      const memberIds = await this.prisma.club_role_assignments.findMany({
        where: {
          club_section_id: { in: allSectionIds },
          ecclesiastical_year_id: ecclesiasticalYearId,
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
          include: {
            users: {
              select: { user_id: true, name: true, paternal_last_name: true },
            },
          },
        });

        honorsStarted = honors.length;
        honorsCompleted = honors.filter((h) => h.validate).length;

        // Build top achievers map
        for (const h of honors) {
          if (!h.validate) continue;
          const uid = h.user_id;
          if (!topAchieversMap.has(uid)) {
            topAchieversMap.set(uid, {
              user_id: uid,
              name: [h.users.name, h.users.paternal_last_name]
                .filter(Boolean)
                .join(' '),
              honors_count: 0,
            });
          }
          topAchieversMap.get(uid)!.honors_count++;
        }
      }
    }

    const topAchievers = Array.from(topAchieversMap.values())
      .sort((a, b) => b.honors_count - a.honors_count)
      .slice(0, 10);

    // ── Activities ──
    let activitiesTotal = 0;
    if (allSectionIds.length > 0) {
      activitiesTotal = await this.prisma.activities.count({
        where: {
          club_section_id: { in: allSectionIds },
          created_at: { gte: startDate, lte: endDate },
        },
      });
    }

    // ── Finances ──
    let totalIncome = 0;
    let totalExpenses = 0;
    let financesTransactions = 0;

    if (allSectionIds.length > 0) {
      // Aggregate all finance records in the year range by iterating months
      const startYear = startDate.getFullYear();
      const endYear = endDate.getFullYear();
      const startMonth = startDate.getMonth() + 1;
      const endMonth = endDate.getMonth() + 1;

      for (let y = startYear; y <= endYear; y++) {
        const monthStart = y === startYear ? startMonth : 1;
        const monthEnd = y === endYear ? endMonth : 12;

        for (let m = monthStart; m <= monthEnd; m++) {
          const finances = await this.prisma.finances.findMany({
            where: {
              club_section_id: { in: allSectionIds },
              month: m,
              year: y,
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
    }

    // ── Months reported (count monthly_reports with status != draft for this club's enrollments) ──
    let monthsReported = 0;
    if (allSectionIds.length > 0) {
      const enrollments = await this.prisma.club_enrollments.findMany({
        where: {
          club_section_id: { in: allSectionIds },
          ecclesiastical_year_id: ecclesiasticalYearId,
        },
        select: { club_enrollment_id: true },
      });
      const enrollmentIds = enrollments.map((e) => e.club_enrollment_id);

      if (enrollmentIds.length > 0) {
        monthsReported = await this.prisma.monthly_reports.count({
          where: {
            club_enrollment_id: { in: enrollmentIds },
            status: { not: 'draft' },
          },
        });
      }
    }

    // ── Ranking percentile (from club_annual_rankings if exists) ──
    let rankingPercentile: number | null = null;
    const rankingRow = await this.prisma.club_annual_rankings.findFirst({
      where: {
        club_enrollment: { club_section_id: { in: allSectionIds } },
        ecclesiastical_year_id: ecclesiasticalYearId,
      },
      select: { progress_percentage: true, rank_position: true },
    });

    if (rankingRow) {
      // Use progress_percentage as a proxy for percentile until full ranking table is queried
      rankingPercentile = rankingRow.progress_percentage ?? null;
    }

    return {
      ecclesiastical_year_id: ecclesiasticalYearId,
      year_label: `${startDate.getFullYear()}–${endDate.getFullYear()}`,
      member_count: memberCount,
      months_reported: monthsReported,
      directiva,
      honors: { started: honorsStarted, completed: honorsCompleted },
      activities: { total: activitiesTotal },
      finances: {
        income: totalIncome,
        expenses: totalExpenses,
        balance: totalIncome - totalExpenses,
        transactions: financesTransactions,
      },
      missionary: { baptized_total: 0 },
      ranking_percentile: rankingPercentile,
      top_achievers: topAchievers,
    };
  }

  // ========================================
  // GENERATE (freeze computed_data)
  // ========================================

  async generate(reportId: number, _triggeredBy: string) {
    const report = await this.prisma.annual_reports.findUnique({
      where: { annual_report_id: reportId },
    });

    if (!report) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_REPORT_NOT_FOUND);
    }

    if (report.status !== 'draft') {
      throw new AppBadRequestException(ErrorCode.ANNUAL_REPORT_NOT_DRAFT);
    }

    const computed = await this.computeData(
      report.club_id,
      report.ecclesiastical_year_id,
    );

    return this.prisma.annual_reports.update({
      where: { annual_report_id: reportId },
      data: {
        computed_data: computed as any,
        auto_generated_at: new Date(),
        status: 'draft',
      },
    });
  }

  // ========================================
  // UPDATE MANUAL DATA
  // ========================================

  async updateManualData(reportId: number, dto: UpdateAnnualManualDataDto) {
    const report = await this.prisma.annual_reports.findUnique({
      where: { annual_report_id: reportId },
    });

    if (!report) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_REPORT_NOT_FOUND);
    }

    if (report.status !== 'draft') {
      throw new AppBadRequestException(ErrorCode.ANNUAL_REPORT_NOT_DRAFT);
    }

    const existing = (report.manual_data as Record<string, unknown>) ?? {};
    const merged = { ...existing, ...this.buildManualPayload(dto) };

    return this.prisma.annual_reports.update({
      where: { annual_report_id: reportId },
      data: { manual_data: merged as any },
    });
  }

  // ========================================
  // FINALIZE
  // ========================================

  async finalize(reportId: number, userId: string) {
    const report = await this.prisma.annual_reports.findUnique({
      where: { annual_report_id: reportId },
    });

    if (!report) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_REPORT_NOT_FOUND);
    }

    if (report.status !== 'draft') {
      throw new AppBadRequestException(ErrorCode.ANNUAL_REPORT_NOT_DRAFT);
    }

    return this.prisma.annual_reports.update({
      where: { annual_report_id: reportId },
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
      status?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);
    const reportScope = resolveReportVisibilityScope(resolved, {
      divisionId: filters.divisionId,
      unionId: filters.unionId,
      localFieldId: filters.localFieldId,
    });
    const clubWhere = buildReportClubWhere(reportScope);

    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 25, 100);
    const skip = (page - 1) * limit;

    const where: any = {
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
  // REGENERATE
  // ========================================

  async regenerate(reportId: number) {
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

    return this.prisma.annual_reports.update({
      where: { annual_report_id: reportId },
      data: {
        computed_data: computed as any,
        auto_generated_at: new Date(),
      },
    });
  }

  // ========================================
  // AUTO-GENERATE (called by cron)
  // ========================================

  async autoGenerateForAllClubs(
    ecclesiasticalYearId: number,
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
        const existing = await this.prisma.annual_reports.findUnique({
          where: {
            club_id_ecclesiastical_year_id: {
              club_id: club.club_id,
              ecclesiastical_year_id: ecclesiasticalYearId,
            },
          },
        });

        if (existing && existing.status !== 'draft') {
          skipped++;
          continue;
        }

        let report = existing;
        if (!report) {
          report = await this.prisma.annual_reports.create({
            data: {
              club_id: club.club_id,
              ecclesiastical_year_id: ecclesiasticalYearId,
              status: 'draft',
            },
          });
        }

        const computed = await this.computeData(
          club.club_id,
          ecclesiasticalYearId,
        );

        await this.prisma.annual_reports.update({
          where: { annual_report_id: report.annual_report_id },
          data: {
            computed_data: computed as any,
            auto_generated_at: new Date(),
          },
        });

        success++;
        this.logger.log(
          `Auto-generated annual report for club ${club.name} (year ${ecclesiasticalYearId})`,
        );
      } catch (err) {
        errors++;
        this.logger.error(
          `Failed to auto-generate annual report for club ${club.club_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { success, skipped, errors };
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

  private buildManualPayload(
    dto: UpdateAnnualManualDataDto,
  ): Record<string, unknown> {
    const fields: (keyof UpdateAnnualManualDataDto)[] = [
      'planning_meetings',
      'parent_meetings',
      'baptized_this_year',
      'total_baptized',
      'camporees_attended',
      'annual_achievements_description',
      'community_service_description',
      'all_investitures_completed',
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

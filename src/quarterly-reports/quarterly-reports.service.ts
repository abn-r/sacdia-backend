import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppBadRequestException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { UpdateQuarterlyManualDataDto } from './dto';

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

  constructor(private readonly prisma: PrismaService) {}

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
  // COMPUTE (build computed_data from monthly data)
  // ========================================

  async computeData(
    clubId: number,
    year: number,
    quarter: number,
  ): Promise<QuarterlyComputedData> {
    this.validateQuarterYear(quarter, year);
    const club = await this.validateClubExists(clubId);

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
    const ecclesiasticalYear = await this.prisma.ecclesiastical_years.findFirst({
      where: { active: true },
    });

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
      const directivaRoles = ['director', 'subdirector', 'secretario', 'tesorero'];
      const assignments = await this.prisma.club_role_assignments.findMany({
        where: {
          club_section_id: { in: allSectionIds },
          ecclesiastical_year_id: yearId,
          active: true,
          roles: { role_name: { in: directivaRoles } },
        },
        include: {
          users: { select: { user_id: true, name: true, paternal_last_name: true, maternal_last_name: true } },
          roles: { select: { role_name: true } },
        },
        distinct: ['user_id'],
      });

      for (const a of assignments) {
        directiva.push({
          role: a.roles.role_name,
          user_id: a.users.user_id,
          name: [a.users.name, a.users.paternal_last_name, a.users.maternal_last_name]
            .filter(Boolean)
            .join(' '),
        });
      }
    }

    // ── Honors aggregation across the 3 months ──
    const startDate = new Date(year, months[0] - 1, 1);
    const endDate = new Date(year, months[months.length - 1], 0, 23, 59, 59, 999);

    let honorsStarted = 0;
    let honorsCompleted = 0;

    if (allSectionIds.length > 0 && yearId) {
      const memberIds = await this.prisma.club_role_assignments.findMany({
        where: { club_section_id: { in: allSectionIds }, ecclesiastical_year_id: yearId, active: true },
        select: { user_id: true },
        distinct: ['user_id'],
      });

      const ids = memberIds.map((m) => m.user_id);
      if (ids.length > 0) {
        const honors = await this.prisma.users_honors.findMany({
          where: { user_id: { in: ids }, active: true, date: { gte: startDate, lte: endDate } },
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
          where: { club_section_id: { in: allSectionIds }, month, year, active: true },
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

  async generate(reportId: number, triggeredBy: string) {
    const report = await this.prisma.quarterly_reports.findUnique({
      where: { quarterly_report_id: reportId },
    });

    if (!report) {
      throw new AppNotFoundException(ErrorCode.QUARTERLY_REPORT_NOT_FOUND);
    }

    if (report.status !== 'draft') {
      throw new AppBadRequestException(ErrorCode.QUARTERLY_REPORT_NOT_DRAFT);
    }

    const computed = await this.computeData(report.club_id, report.year, report.quarter);

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
        finalized_by_user: { select: { user_id: true, name: true, paternal_last_name: true } },
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

  async listForAdmin(filters: {
    clubId?: number;
    year?: number;
    quarter?: number;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 25, 100);
    const skip = (page - 1) * limit;

    const where: any = {
      ...(filters.clubId !== undefined && { club_id: filters.clubId }),
      ...(filters.year !== undefined && { year: filters.year }),
      ...(filters.quarter !== undefined && { quarter: filters.quarter }),
      ...(filters.status && { status: filters.status }),
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
          finalized_by_user: { select: { user_id: true, name: true, paternal_last_name: true } },
        },
      }),
    ]);

    return { total, page, limit, items };
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
        finalized_by_user: { select: { user_id: true, name: true, paternal_last_name: true } },
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

    const computed = await this.computeData(report.club_id, report.year, report.quarter);

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

  async autoGenerateForAllClubs(year: number, quarter: number): Promise<{ success: number; skipped: number; errors: number }> {
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
          where: { club_id_year_quarter: { club_id: club.club_id, year, quarter } },
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
          data: { computed_data: computed as any, auto_generated_at: new Date() },
        });

        success++;
        this.logger.log(`Auto-generated quarterly report for club ${club.name} (${year} Q${quarter})`);
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

  private validateQuarterYear(quarter: number, year: number) {
    if (quarter < 1 || quarter > 4) {
      throw new AppBadRequestException(ErrorCode.QUARTERLY_REPORT_INVALID_QUARTER);
    }
    if (year < 2020 || year > 2100) {
      throw new AppBadRequestException(ErrorCode.QUARTERLY_REPORT_INVALID_YEAR);
    }
  }

  private async validateClubExists(clubId: number) {
    const club = await this.prisma.clubs.findUnique({ where: { club_id: clubId } });
    if (!club) {
      throw new AppNotFoundException(ErrorCode.QUARTERLY_REPORT_CLUB_NOT_FOUND);
    }
    return club;
  }

  private buildManualPayload(dto: UpdateQuarterlyManualDataDto): Record<string, unknown> {
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

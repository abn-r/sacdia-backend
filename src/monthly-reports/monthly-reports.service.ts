import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateManualDataDto } from './dto';

@Injectable()
export class MonthlyReportsService {
  private readonly logger = new Logger(MonthlyReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ========================================
  // GET OR CREATE DRAFT
  // ========================================

  /**
   * Gets an existing report or creates a new draft for the given enrollment/month/year.
   */
  async getOrCreateDraft(enrollmentId: string, month: number, year: number) {
    this.validateMonthYear(month, year);

    await this.validateEnrollmentExists(enrollmentId);

    const existing = await this.prisma.monthly_reports.findUnique({
      where: {
        club_enrollment_id_month_year: {
          club_enrollment_id: enrollmentId,
          month,
          year,
        },
      },
      include: { manual_data: true },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.monthly_reports.create({
      data: {
        club_enrollment_id: enrollmentId,
        month,
        year,
        status: 'draft',
      },
      include: { manual_data: true },
    });
  }

  // ========================================
  // PREVIEW (live auto-calculated data)
  // ========================================

  /**
   * Returns real-time auto-calculated data for preview (not frozen).
   * Includes: member count, directiva, honors, activities, finances, meeting days.
   */
  async preview(enrollmentId: string, month: number, year: number) {
    this.validateMonthYear(month, year);

    const enrollment = await this.prisma.club_enrollments.findUnique({
      where: { club_enrollment_id: enrollmentId },
      include: {
        club_section: {
          include: {
            club_types: { select: { name: true, club_type_id: true } },
            clubs: { select: { name: true, club_id: true } },
          },
        },
        ecclesiastical_year: true,
      },
    });

    if (!enrollment) {
      throw new NotFoundException(
        `Club enrollment with ID ${enrollmentId} not found`,
      );
    }

    const clubSectionId = enrollment.club_section_id;
    const yearId = enrollment.ecclesiastical_year_id;

    // Calculate date range for the month
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    // Run all queries in parallel
    const [memberCount, directiva, honorsData, activitiesData, financesData] =
      await Promise.all([
        this.getMemberCount(clubSectionId, yearId),
        this.getDirectiva(clubSectionId, yearId),
        this.getHonorsData(clubSectionId, yearId, startDate, endDate),
        this.getActivitiesData(clubSectionId, startDate, endDate),
        this.getFinancesData(clubSectionId, month, year),
      ]);

    return {
      enrollment: {
        club_enrollment_id: enrollment.club_enrollment_id,
        club_name: enrollment.club_section?.clubs?.name ?? null,
        club_type: enrollment.club_section?.club_types?.name ?? null,
        meeting_days: enrollment.meeting_days,
      },
      month,
      year,
      auto_calculated: {
        member_count: memberCount,
        directiva,
        honors: honorsData,
        activities: activitiesData,
        finances: financesData,
        meeting_days: enrollment.meeting_days,
      },
    };
  }

  // ========================================
  // UPDATE MANUAL DATA
  // ========================================

  /**
   * Updates the manual fields of a report. Only allowed if status is 'draft'.
   */
  async updateManualData(reportId: string, dto: UpdateManualDataDto) {
    const report = await this.prisma.monthly_reports.findUnique({
      where: { monthly_report_id: reportId },
      include: { manual_data: true },
    });

    if (!report) {
      throw new NotFoundException(
        `Monthly report with ID ${reportId} not found`,
      );
    }

    if (report.status !== 'draft') {
      throw new BadRequestException(
        `Cannot update manual data for a report with status '${report.status}'. Only draft reports can be edited.`,
      );
    }

    // Build update data, filtering out undefined values
    const updateData = this.buildManualDataPayload(dto);

    if (report.manual_data) {
      // Update existing manual data
      return this.prisma.monthly_report_manual_data.update({
        where: { monthly_report_id: reportId },
        data: updateData,
      });
    } else {
      // Create new manual data
      return this.prisma.monthly_report_manual_data.create({
        data: {
          monthly_report_id: reportId,
          ...updateData,
        },
      });
    }
  }

  // ========================================
  // GENERATE (freeze snapshot)
  // ========================================

  /**
   * Freezes the auto-calculated data into snapshot_data and sets status to 'generated'.
   */
  async generate(reportId: string, userId: string) {
    const report = await this.prisma.monthly_reports.findUnique({
      where: { monthly_report_id: reportId },
    });

    if (!report) {
      throw new NotFoundException(
        `Monthly report with ID ${reportId} not found`,
      );
    }

    if (report.status !== 'draft') {
      throw new BadRequestException(
        `Cannot generate a report with status '${report.status}'. Only draft reports can be generated.`,
      );
    }

    // Get live preview data to freeze
    const previewData = await this.preview(
      report.club_enrollment_id,
      report.month,
      report.year,
    );

    return this.prisma.monthly_reports.update({
      where: { monthly_report_id: reportId },
      data: {
        status: 'generated',
        snapshot_data: previewData.auto_calculated as any,
        generated_at: new Date(),
      },
      include: { manual_data: true },
    });
  }

  // ========================================
  // SUBMIT
  // ========================================

  /**
   * Sets the report status to 'submitted'.
   */
  async submit(reportId: string, userId: string) {
    const report = await this.prisma.monthly_reports.findUnique({
      where: { monthly_report_id: reportId },
    });

    if (!report) {
      throw new NotFoundException(
        `Monthly report with ID ${reportId} not found`,
      );
    }

    if (report.status !== 'generated') {
      throw new BadRequestException(
        `Cannot submit a report with status '${report.status}'. Only generated reports can be submitted.`,
      );
    }

    return this.prisma.monthly_reports.update({
      where: { monthly_report_id: reportId },
      data: {
        status: 'submitted',
        submitted_at: new Date(),
        submitted_by: userId,
      },
      include: { manual_data: true },
    });
  }

  // ========================================
  // GET SINGLE REPORT
  // ========================================

  /**
   * Gets a single report with manual data and snapshot.
   */
  async getReport(reportId: string) {
    const report = await this.prisma.monthly_reports.findUnique({
      where: { monthly_report_id: reportId },
      include: {
        manual_data: true,
        club_enrollment: {
          include: {
            club_section: {
              include: {
                club_types: { select: { name: true } },
                clubs: { select: { name: true } },
              },
            },
          },
        },
        submitter: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
          },
        },
      },
    });

    if (!report) {
      throw new NotFoundException(
        `Monthly report with ID ${reportId} not found`,
      );
    }

    return report;
  }

  // ========================================
  // LIST REPORTS
  // ========================================

  /**
   * Lists all reports for a given enrollment, with optional status filter.
   */
  async listReports(enrollmentId: string, status?: string) {
    await this.validateEnrollmentExists(enrollmentId);

    return this.prisma.monthly_reports.findMany({
      where: {
        club_enrollment_id: enrollmentId,
        ...(status && { status }),
      },
      include: {
        manual_data: true,
        submitter: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
          },
        },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  // ========================================
  // GET SUBMITTED COUNT
  // ========================================

  /**
   * Returns the count of submitted reports for an enrollment (for investiture validation).
   */
  async getSubmittedCount(enrollmentId: string): Promise<number> {
    await this.validateEnrollmentExists(enrollmentId);

    return this.prisma.monthly_reports.count({
      where: {
        club_enrollment_id: enrollmentId,
        status: 'submitted',
      },
    });
  }

  // ========================================
  // PRIVATE HELPERS — auto-calculated queries
  // ========================================

  /**
   * Count active members in the club section for the given ecclesiastical year.
   */
  private async getMemberCount(
    clubSectionId: number,
    yearId: number,
  ): Promise<number> {
    return this.prisma.club_role_assignments.count({
      where: {
        club_section_id: clubSectionId,
        ecclesiastical_year_id: yearId,
        active: true,
      },
    });
  }

  /**
   * Get directiva members (director, subdirector, secretary, treasurer).
   */
  private async getDirectiva(clubSectionId: number, yearId: number) {
    const directivaRoles = [
      'director',
      'subdirector',
      'secretario',
      'tesorero',
    ];

    const assignments = await this.prisma.club_role_assignments.findMany({
      where: {
        club_section_id: clubSectionId,
        ecclesiastical_year_id: yearId,
        active: true,
        roles: {
          role_name: { in: directivaRoles },
        },
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
        roles: {
          select: { role_name: true },
        },
      },
    });

    return assignments.map((a) => ({
      role: a.roles.role_name,
      user_id: a.users.user_id,
      name: [
        a.users.name,
        a.users.paternal_last_name,
        a.users.maternal_last_name,
      ]
        .filter(Boolean)
        .join(' '),
    }));
  }

  /**
   * Get honors started/completed this month by members of the club section.
   */
  private async getHonorsData(
    clubSectionId: number,
    yearId: number,
    startDate: Date,
    endDate: Date,
  ) {
    // Get user IDs that belong to this club section in this year
    const memberIds = await this.getClubMemberIds(clubSectionId, yearId);

    if (memberIds.length === 0) {
      return { started: 0, completed: 0, details: [] };
    }

    const honors = await this.prisma.users_honors.findMany({
      where: {
        user_id: { in: memberIds },
        active: true,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        honors: {
          select: { name: true, honor_id: true },
        },
        users: {
          select: {
            name: true,
            paternal_last_name: true,
          },
        },
      },
    });

    const completed = honors.filter((h) => h.validate).length;
    const started = honors.length;

    return {
      started,
      completed,
      details: honors.map((h) => ({
        honor_name: h.honors.name,
        user_name: [h.users.name, h.users.paternal_last_name]
          .filter(Boolean)
          .join(' '),
        validated: h.validate,
        date: h.date,
      })),
    };
  }

  /**
   * Get activities for the club section in the given month.
   */
  private async getActivitiesData(
    clubSectionId: number,
    startDate: Date,
    endDate: Date,
  ) {
    const activities = await this.prisma.activities.findMany({
      where: {
        club_section_id: clubSectionId,
        created_at: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        activity_types: {
          select: { name: true },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    return {
      total: activities.length,
      list: activities.map((a) => ({
        activity_id: a.activity_id,
        name: a.name,
        type: a.activity_types.name,
        date: a.created_at,
      })),
    };
  }

  /**
   * Get financial summary for the club section in the given month.
   */
  private async getFinancesData(
    clubSectionId: number,
    month: number,
    year: number,
  ) {
    const finances = await this.prisma.finances.findMany({
      where: {
        club_section_id: clubSectionId,
        month,
        year,
        active: true,
      },
      include: {
        finances_categories: {
          select: { name: true, type: true },
        },
      },
    });

    let totalIncome = 0;
    let totalExpenses = 0;

    for (const f of finances) {
      // type 0 = income, type 1 = expense
      if (f.finances_categories.type === 0) {
        totalIncome += f.amount;
      } else {
        totalExpenses += f.amount;
      }
    }

    return {
      income: totalIncome,
      expenses: totalExpenses,
      balance: totalIncome - totalExpenses,
      transactions: finances.length,
    };
  }

  /**
   * Get all member user IDs for a club section in a given ecclesiastical year.
   */
  private async getClubMemberIds(
    clubSectionId: number,
    yearId: number,
  ): Promise<string[]> {
    const assignments = await this.prisma.club_role_assignments.findMany({
      where: {
        club_section_id: clubSectionId,
        ecclesiastical_year_id: yearId,
        active: true,
      },
      select: { user_id: true },
      distinct: ['user_id'],
    });

    return assignments.map((a) => a.user_id);
  }

  // ========================================
  // PRIVATE HELPERS — validation
  // ========================================

  private validateMonthYear(month: number, year: number) {
    if (month < 1 || month > 12) {
      throw new BadRequestException('Month must be between 1 and 12');
    }
    if (year < 2020 || year > 2100) {
      throw new BadRequestException('Year must be between 2020 and 2100');
    }
  }

  private async validateEnrollmentExists(enrollmentId: string) {
    const enrollment = await this.prisma.club_enrollments.findUnique({
      where: { club_enrollment_id: enrollmentId },
    });

    if (!enrollment) {
      throw new NotFoundException(
        `Club enrollment with ID ${enrollmentId} not found`,
      );
    }

    return enrollment;
  }

  /**
   * Build a clean payload from the DTO, filtering out undefined fields.
   */
  private buildManualDataPayload(dto: UpdateManualDataDto) {
    const payload: Record<string, any> = {};

    const fields: (keyof UpdateManualDataDto)[] = [
      'planning_meetings',
      'parent_meetings',
      'youth_council_attendance',
      'church_board_attendance',
      'soul_target',
      'unbaptized_members',
      'bible_studies_receiving',
      'has_weekly_bible_instruction',
      'bible_studies_given',
      'literature_distributed',
      'baptized_this_month',
      'total_baptized',
      'club_participation_description',
      'community_service_description',
      'certificates_delivered',
      'members_have_booklet',
      'booklet_requirements_signed',
    ];

    for (const field of fields) {
      if (dto[field] !== undefined) {
        payload[field] = dto[field];
      }
    }

    return payload;
  }
}

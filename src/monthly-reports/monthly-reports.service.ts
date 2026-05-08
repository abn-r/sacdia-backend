import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { UpdateManualDataDto } from './dto';
import {
  AppBadRequestException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

@Injectable()
export class MonthlyReportsService {
  private readonly logger = new Logger(MonthlyReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

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
      throw new AppNotFoundException(
        ErrorCode.MONTHLY_REPORT_ENROLLMENT_NOT_FOUND,
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
      throw new AppNotFoundException(ErrorCode.MONTHLY_REPORT_NOT_FOUND);
    }

    if (report.status !== 'draft') {
      throw new AppBadRequestException(ErrorCode.MONTHLY_REPORT_NOT_DRAFT);
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
      throw new AppNotFoundException(ErrorCode.MONTHLY_REPORT_NOT_FOUND);
    }

    if (report.status !== 'draft') {
      throw new AppBadRequestException(ErrorCode.MONTHLY_REPORT_NOT_DRAFT);
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
      throw new AppNotFoundException(ErrorCode.MONTHLY_REPORT_NOT_FOUND);
    }

    if (report.status !== 'generated') {
      throw new AppBadRequestException(ErrorCode.MONTHLY_REPORT_NOT_GENERATED);
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
      throw new AppNotFoundException(ErrorCode.MONTHLY_REPORT_NOT_FOUND);
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
  // LIST REPORTS FOR ADMIN (multi-club supervision)
  // ========================================

  /**
   * Paginated list of monthly reports across clubs.
   * - super-admin / admin: can filter by any local_field_id supplied in filters.
   * - coordinator: scope is forced to their own local_field_id (filters.localFieldId ignored).
   * Roles and territory scope are derived from the resolved authorization profile
   * so that this method never trusts unverified JWT claims directly.
   */
  async listForAdmin(
    userId: string,
    filters: {
      clubTypeId?: number;
      localFieldId?: number;
      year?: number;
      month?: number;
      status?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);

    const globalRoleNames = new Set(
      resolved.authorization.grants.global_roles.map((grant) =>
        grant.role_name.toLowerCase(),
      ),
    );

    const isAdmin =
      globalRoleNames.has('admin') || globalRoleNames.has('super-admin');
    const isScopedAdmin =
      globalRoleNames.has('coordinator') ||
      globalRoleNames.has('assistant-admin');

    if (!isAdmin && !isScopedAdmin) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }

    const userLocalFieldId = resolved.authorization.effective.scope.global
      .local_field?.id as number | undefined;

    const scopedLocalFieldId: number | undefined = isAdmin
      ? filters.localFieldId
      : userLocalFieldId;

    if (!isAdmin && scopedLocalFieldId === undefined) {
      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }

    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 25, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.monthly_reportsWhereInput = {
      ...(filters.year !== undefined && { year: filters.year }),
      ...(filters.month !== undefined && { month: filters.month }),
      ...(filters.status && { status: filters.status }),
      club_enrollment: {
        club_section: {
          ...(filters.clubTypeId !== undefined && {
            club_type_id: filters.clubTypeId,
          }),
          ...(scopedLocalFieldId !== undefined && {
            clubs: { local_field_id: scopedLocalFieldId },
          }),
        },
      },
    };

    const [total, rows] = await Promise.all([
      this.prisma.monthly_reports.count({ where }),
      this.prisma.monthly_reports.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        include: {
          club_enrollment: {
            include: {
              club_section: {
                include: {
                  club_types: { select: { club_type_id: true, name: true } },
                  clubs: {
                    select: {
                      name: true,
                      local_field_id: true,
                      local_fields: { select: { name: true } },
                    },
                  },
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
      }),
    ]);

    const items = rows.map((r) => {
      const section = r.club_enrollment.club_section;
      const submitterName = r.submitter
        ? `${r.submitter.name ?? ''} ${r.submitter.paternal_last_name ?? ''}`.trim() ||
          null
        : null;
      const memberCount =
        (r.snapshot_data as { member_count?: number } | null)?.member_count ??
        null;
      return {
        monthly_report_id: r.monthly_report_id,
        club_enrollment_id: r.club_enrollment_id,
        month: r.month,
        year: r.year,
        status: r.status,
        generated_at: r.generated_at,
        submitted_at: r.submitted_at,
        club_name: section.clubs?.name ?? null,
        club_type: section.club_types?.name ?? null,
        club_type_id: section.club_types?.club_type_id ?? null,
        local_field: section.clubs?.local_fields?.name ?? null,
        local_field_id: section.clubs?.local_field_id ?? null,
        submitter_name: submitterName,
        member_count: memberCount,
      };
    });

    return { total, page, limit, items };
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
  // AUTO-GENERATION (used by cron and BullMQ processor)
  // ========================================

  /**
   * Runs the full auto-generation loop for the given month/year (or the
   * previous month if no arguments are supplied).
   *
   * This method:
   * 1. Reads system_config to check whether auto-generation is enabled and
   *    to determine the configured day-of-month.
   * 2. Checks that today is the configured day (when called from the cron
   *    trigger, this will be true; when called from a BullMQ retry it will
   *    also be true because the job was enqueued on that day).
   * 3. Iterates over all active club enrollments, calling getOrCreateDraft()
   *    and generate() for each one that is still in draft status.
   *
   * Idempotency is guaranteed by the draft status check — a report that has
   * already been generated or submitted is skipped silently. BullMQ retries
   * are therefore safe.
   *
   * @param forceDate - Optional date to use instead of today (useful for
   *                    testing and manual back-fills).
   */
  async runAutoGeneration(
    forceDate?: Date,
  ): Promise<{ itemsProcessed: number }> {
    // 1. Read system_config to check if auto-generation is enabled
    const enabledConfig = await this.prisma.system_config.findUnique({
      where: { config_key: 'reports.auto_generate_enabled' },
    });

    if (!enabledConfig || enabledConfig.config_value !== 'true') {
      this.logger.log('Auto-generation is disabled. Skipping.');
      return { itemsProcessed: 0 };
    }

    // 2. Read the configured day of month
    const dayConfig = await this.prisma.system_config.findUnique({
      where: { config_key: 'reports.auto_generate_day' },
    });

    const configuredDay = dayConfig ? parseInt(dayConfig.config_value, 10) : 5;

    if (isNaN(configuredDay) || configuredDay < 1 || configuredDay > 28) {
      this.logger.warn(
        `Invalid auto_generate_day value: "${dayConfig?.config_value}". Must be 1-28. Skipping.`,
      );
      return { itemsProcessed: 0 };
    }

    // 3. Check if today is the configured day
    const today = forceDate ?? new Date();
    const currentDay = today.getDate();

    if (currentDay !== configuredDay) {
      this.logger.debug(
        `Today is day ${currentDay}, configured day is ${configuredDay}. Skipping.`,
      );
      return { itemsProcessed: 0 };
    }

    this.logger.log(
      `Today is the configured auto-generation day (${configuredDay}). Starting report generation...`,
    );

    // 4. Calculate the PREVIOUS month and year
    const prevMonth = today.getMonth() === 0 ? 12 : today.getMonth();
    const prevYear =
      today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();

    this.logger.log(
      `Generating reports for ${prevYear}-${String(prevMonth).padStart(2, '0')}`,
    );

    // 5. Get all active club enrollments
    const activeEnrollments = await this.prisma.club_enrollments.findMany({
      where: { status: 'active' },
      select: {
        club_enrollment_id: true,
        club_section: {
          select: {
            clubs: { select: { name: true } },
            club_types: { select: { name: true } },
          },
        },
      },
    });

    if (activeEnrollments.length === 0) {
      this.logger.log('No active club enrollments found. Nothing to generate.');
      return { itemsProcessed: 0 };
    }

    this.logger.log(
      `Found ${activeEnrollments.length} active enrollment(s). Processing...`,
    );

    // 6. For each enrollment, get or create draft and then generate
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    const errors: { enrollmentId: string; clubName: string; error: string }[] =
      [];

    for (const enrollment of activeEnrollments) {
      const clubName = enrollment.club_section?.clubs?.name ?? 'Unknown club';
      const clubType =
        enrollment.club_section?.club_types?.name ?? 'Unknown type';
      const label = `${clubName} (${clubType})`;

      try {
        const draft = await this.getOrCreateDraft(
          enrollment.club_enrollment_id,
          prevMonth,
          prevYear,
        );

        if (draft.status !== 'draft') {
          this.logger.debug(
            `Report for ${label} already has status "${draft.status}". Skipping.`,
          );
          skipCount++;
          continue;
        }

        await this.generate(
          draft.monthly_report_id,
          'system', // userId = 'system' for auto-generated reports
        );

        successCount++;
        this.logger.log(`Generated report for ${label}`);
      } catch (error) {
        errorCount++;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        errors.push({
          enrollmentId: enrollment.club_enrollment_id,
          clubName: label,
          error: errorMessage,
        });
        this.logger.error(
          `Failed to generate report for ${label}: ${errorMessage}`,
        );
      }
    }

    // 7. Log summary
    this.logger.log(
      `Auto-generation complete for ${prevYear}-${String(prevMonth).padStart(2, '0')}: ` +
        `${successCount} generated, ${skipCount} skipped (already processed), ${errorCount} errors`,
    );

    if (errors.length > 0) {
      this.logger.warn(
        `Errors during auto-generation:\n${errors
          .map((e) => `  - ${e.clubName} (${e.enrollmentId}): ${e.error}`)
          .join('\n')}`,
      );
    }

    return { itemsProcessed: successCount };
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
      throw new AppBadRequestException(ErrorCode.MONTHLY_REPORT_INVALID_MONTH);
    }
    if (year < 2020 || year > 2100) {
      throw new AppBadRequestException(ErrorCode.MONTHLY_REPORT_INVALID_YEAR);
    }
  }

  private async validateEnrollmentExists(enrollmentId: string) {
    const enrollment = await this.prisma.club_enrollments.findUnique({
      where: { club_enrollment_id: enrollmentId },
    });

    if (!enrollment) {
      throw new AppNotFoundException(
        ErrorCode.MONTHLY_REPORT_ENROLLMENT_NOT_FOUND,
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

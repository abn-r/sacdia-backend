import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UpdateManualDataDto } from './dto';
import {
  AppConflictException,
  AppException,
  AppBadRequestException,
  AppForbiddenException,
  AppInternalServerErrorException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { DistributedLockService } from '../common/services/distributed-lock.service';
import {
  MonthlyReportArtifactsService,
  MonthlyReportPdfArtifact,
} from './monthly-report-artifacts.service';
import type { MonthlyReportSnapshotData } from './monthly-reports-pdf.service';
import {
  buildReportClubSectionWhere,
  resolveReportVisibilityScopeForActor,
} from '../reports/report-visibility-scope';
import { CoordinationService } from '../coordination/coordination.service';
import {
  BACKGROUND_JOBS_QUEUE,
  BackgroundJobName,
  MonthlyReportPdfPayload,
} from '../background-jobs/background-jobs.types';

const MONTHLY_REPORT_REMINDER_SOURCE = 'monthly_reports:reminder';
const AUTO_GENERATION_STATUS_BATCH_SIZE = 500;
const MONTHLY_REPORT_REMINDER_ROLES = [
  'director',
  'secretary',
  'secretary-treasurer',
] as const;
const MONTHLY_REPORT_REMINDER_TIME_ZONE = 'America/Mexico_City';

type MonthlyReportReminderAction =
  | 'capture_reminder'
  | 'five_days_left'
  | 'one_day_left'
  | 'closed'
  | 'generated';

interface MonthlyReportReminderSchedule {
  action: MonthlyReportReminderAction;
  month: number;
  year: number;
}

const NON_NULLABLE_MANUAL_DATA_FIELDS: readonly (keyof UpdateManualDataDto)[] =
  [
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
    'certificates_delivered',
    'members_have_booklet',
    'booklet_requirements_signed',
  ];

const NULLABLE_MANUAL_DATA_TEXT_FIELDS: readonly (keyof UpdateManualDataDto)[] =
  ['club_participation_description', 'community_service_description'];

const NULLABLE_MANUAL_DATA_TEXT_FIELD_SET = new Set<string>(
  NULLABLE_MANUAL_DATA_TEXT_FIELDS,
);

const MANUAL_DATA_FIELDS: readonly (keyof UpdateManualDataDto)[] = [
  ...NON_NULLABLE_MANUAL_DATA_FIELDS,
  ...NULLABLE_MANUAL_DATA_TEXT_FIELDS,
];

const MONTHLY_PDF_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 86_400 },
  removeOnFail: { age: 7 * 86_400 },
};

/**
 * Prisma BigInt cannot JSON.stringify. PDF sizes fit in a JS number.
 */
function serializeMonthlyReport<T>(report: T): T {
  if (!report || typeof report !== 'object') {
    return report;
  }

  const record = report as T & { pdf_size_bytes?: unknown };
  if (typeof record.pdf_size_bytes !== 'bigint') {
    return report;
  }

  return {
    ...record,
    pdf_size_bytes: Number(record.pdf_size_bytes),
  };
}

export type MonthlyReportQueuedResult = {
  queued: true;
  monthly_report_id: string;
  status: string;
};

@Injectable()
export class MonthlyReportsService {
  private readonly logger = new Logger(MonthlyReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    @Optional()
    private readonly notificationsService?: NotificationsService,
    @Optional()
    private readonly monthlyReportArtifactsService?: MonthlyReportArtifactsService,
    @Optional()
    private readonly lockService?: DistributedLockService,
    @Optional()
    private readonly coordinationService?: CoordinationService,
    @Optional()
    @InjectQueue(BACKGROUND_JOBS_QUEUE)
    private readonly jobsQueue?: Queue,
  ) {}

  // ========================================
  // GET OR CREATE DRAFT
  // ========================================

  /**
   * Atomically gets an existing report or creates a draft for the given enrollment/month/year.
   */
  async getOrCreateDraft(enrollmentId: string, month: number, year: number) {
    this.validateMonthYear(month, year);

    await this.validateEnrollmentExists(enrollmentId);

    return serializeMonthlyReport(
      await this.prisma.monthly_reports.upsert({
        where: {
          club_enrollment_id_month_year: {
            club_enrollment_id: enrollmentId,
            month,
            year,
          },
        },
        create: {
          club_enrollment_id: enrollmentId,
          month,
          year,
          status: 'draft',
        },
        update: {},
        include: { manual_data: true },
      }),
    );
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
    if (NON_NULLABLE_MANUAL_DATA_FIELDS.some((field) => dto[field] === null)) {
      throw new AppBadRequestException(
        ErrorCode.MONTHLY_REPORT_INVALID_MANUAL_DATA,
      );
    }

    // Build update data, filtering out undefined values
    const updateData = this.buildManualDataPayload(dto);

    if (Object.keys(updateData).length === 0) {
      throw new AppBadRequestException(
        ErrorCode.MONTHLY_REPORT_MANUAL_DATA_REQUIRED,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const [report] = await tx.$queryRaw<
        Array<{ monthly_report_id: string; status: string }>
      >(Prisma.sql`
        SELECT monthly_report_id, status
        FROM monthly_reports
        WHERE monthly_report_id = ${reportId}::uuid
        FOR UPDATE
      `);

      if (!report) {
        throw new AppNotFoundException(ErrorCode.MONTHLY_REPORT_NOT_FOUND);
      }

      if (report.status !== 'draft') {
        throw new AppBadRequestException(ErrorCode.MONTHLY_REPORT_NOT_DRAFT);
      }

      const existingManualData = await tx.monthly_report_manual_data.findUnique(
        {
          where: { monthly_report_id: reportId },
          select: { manual_data_id: true },
        },
      );

      if (
        !existingManualData &&
        !Object.entries(updateData).some(([field, value]) =>
          NULLABLE_MANUAL_DATA_TEXT_FIELD_SET.has(field)
            ? typeof value === 'string' && value.trim().length > 0
            : true,
        )
      ) {
        throw new AppBadRequestException(
          ErrorCode.MONTHLY_REPORT_MANUAL_DATA_REQUIRED,
        );
      }

      return tx.monthly_report_manual_data.upsert({
        where: { monthly_report_id: reportId },
        create: {
          monthly_report_id: reportId,
          ...updateData,
        },
        update: updateData,
      });
    });
  }

  // ========================================
  // GENERATE (freeze snapshot)
  // ========================================

  /**
   * HTTP entry: enqueue snapshot+PDF work so the request returns immediately.
   * Without Redis, generate() still runs inline (local DX).
   */
  async enqueueGenerate(reportId: string, userId: string) {
    const report = await this.prisma.monthly_reports.findUnique({
      where: { monthly_report_id: reportId },
      select: { monthly_report_id: true, status: true },
    });

    if (!report) {
      throw new AppNotFoundException(ErrorCode.MONTHLY_REPORT_NOT_FOUND);
    }

    if (report.status !== 'draft') {
      throw new AppBadRequestException(ErrorCode.MONTHLY_REPORT_NOT_DRAFT);
    }

    if (this.jobsQueue) {
      await this.addMonthlyPdfJob({
        reportId,
        action: 'generate',
        requestedBy: userId,
        triggeredAt: new Date().toISOString(),
      });
      return {
        queued: true,
        monthly_report_id: reportId,
        status: report.status,
      };
    }

    this.logger.warn(
      'BullMQ queue unavailable — generating monthly report inline',
    );
    return this.generate(reportId, userId);
  }

  /**
   * HTTP entry: enqueue PDF rerender. Without Redis, regenerate() runs inline.
   */
  async enqueueRegenerate(reportId: string) {
    const report = await this.prisma.monthly_reports.findUnique({
      where: { monthly_report_id: reportId },
      select: {
        monthly_report_id: true,
        status: true,
        snapshot_data: true,
      },
    });

    if (!report) {
      throw new AppNotFoundException(ErrorCode.MONTHLY_REPORT_NOT_FOUND);
    }

    if (!['generated', 'submitted'].includes(report.status)) {
      throw new AppBadRequestException(ErrorCode.REPORT_PDF_NOT_GENERATED);
    }

    if (!report.snapshot_data) {
      throw new AppBadRequestException(ErrorCode.REPORT_PDF_NO_SNAPSHOT);
    }

    if (this.jobsQueue) {
      await this.addMonthlyPdfJob({
        reportId,
        action: 'regenerate',
        triggeredAt: new Date().toISOString(),
      });
      return {
        queued: true,
        monthly_report_id: reportId,
        status: report.status,
      };
    }

    this.logger.warn(
      'BullMQ queue unavailable — regenerating monthly report PDF inline',
    );
    return this.regenerate(reportId);
  }

  private async addMonthlyPdfJob(payload: MonthlyReportPdfPayload) {
    if (!this.jobsQueue) {
      throw new Error('Background jobs queue is not available');
    }

    await this.jobsQueue.add(
      BackgroundJobName.MONTHLY_REPORT_PDF,
      payload,
      MONTHLY_PDF_JOB_OPTIONS,
    );
  }

  /**
   * Freezes the auto-calculated data into snapshot_data and sets status to 'generated'.
   */
  async generate(reportId: string, _userId: string) {
    const lockKey = `monthly-report:generate:${reportId}`;
    if (this.lockService) {
      const acquired = await this.lockService.tryAcquire(lockKey, 5 * 60_000);
      if (!acquired) {
        throw new AppConflictException(
          ErrorCode.MONTHLY_REPORT_GENERATION_LOCK_CONFLICT,
        );
      }
    }

    let artifact: MonthlyReportPdfArtifact | undefined;

    try {
      const report = await this.prisma.monthly_reports.findUnique({
        where: { monthly_report_id: reportId },
      });

      if (!report) {
        throw new AppNotFoundException(ErrorCode.MONTHLY_REPORT_NOT_FOUND);
      }

      if (report.status !== 'draft') {
        throw new AppBadRequestException(ErrorCode.MONTHLY_REPORT_NOT_DRAFT);
      }

      // Get live preview data to freeze before rendering the canonical artifact.
      const previewData = await this.preview(
        report.club_enrollment_id,
        report.month,
        report.year,
      );
      const snapshotData =
        previewData.auto_calculated as unknown as MonthlyReportSnapshotData;

      if (this.monthlyReportArtifactsService) {
        artifact = await this.monthlyReportArtifactsService.renderAndUpload({
          reportId,
          snapshotOverride: snapshotData,
        });
      }

      const transitionData = {
        status: 'generated',
        snapshot_data: snapshotData as any,
        generated_at: new Date(),
        ...(artifact && this.monthlyReportArtifactsService
          ? this.monthlyReportArtifactsService.getMetadataUpdate(artifact)
          : {}),
      };

      let transition;
      try {
        transition = await this.prisma.monthly_reports.updateMany({
          where: {
            monthly_report_id: reportId,
            status: 'draft',
          },
          data: transitionData,
        });
      } catch (error) {
        await this.cleanupUploadedArtifact(artifact);
        throw error;
      }

      if (transition.count !== 1) {
        await this.cleanupUploadedArtifact(artifact);
        throw new AppBadRequestException(ErrorCode.MONTHLY_REPORT_NOT_DRAFT);
      }

      const generated = await this.prisma.monthly_reports.findUnique({
        where: { monthly_report_id: reportId },
        include: { manual_data: true },
      });

      if (!generated) {
        throw new AppNotFoundException(ErrorCode.MONTHLY_REPORT_NOT_FOUND);
      }

      return serializeMonthlyReport(generated);
    } finally {
      if (this.lockService) {
        await this.lockService.release(lockKey);
      }
    }
  }

  /**
   * Regenerates only the canonical PDF artifact from the frozen snapshot.
   * Workflow status, snapshot and submission fields remain unchanged.
   */
  async regenerate(reportId: string) {
    const lockKey = `monthly-report:generate:${reportId}`;
    if (this.lockService) {
      const acquired = await this.lockService.tryAcquire(lockKey, 5 * 60_000);
      if (!acquired) {
        throw new AppConflictException(
          ErrorCode.MONTHLY_REPORT_GENERATION_LOCK_CONFLICT,
        );
      }
    }

    try {
      const report = await this.prisma.monthly_reports.findUnique({
        where: { monthly_report_id: reportId },
      });

      if (!report) {
        throw new AppNotFoundException(ErrorCode.MONTHLY_REPORT_NOT_FOUND);
      }

      if (!['generated', 'submitted'].includes(report.status)) {
        throw new AppBadRequestException(ErrorCode.REPORT_PDF_NOT_GENERATED);
      }

      if (!report.snapshot_data) {
        throw new AppBadRequestException(ErrorCode.REPORT_PDF_NO_SNAPSHOT);
      }

      if (!this.monthlyReportArtifactsService) {
        throw new AppInternalServerErrorException(
          ErrorCode.R2_VALIDATION_FAILED,
        );
      }

      const artifact = await this.monthlyReportArtifactsService.renderAndUpload(
        {
          reportId,
          snapshotOverride: report.snapshot_data as MonthlyReportSnapshotData,
        },
      );
      await this.monthlyReportArtifactsService.persistArtifactMetadata(
        reportId,
        artifact,
      );

      const regenerated = await this.prisma.monthly_reports.findUnique({
        where: { monthly_report_id: reportId },
        include: { manual_data: true },
      });

      if (!regenerated) {
        throw new AppNotFoundException(ErrorCode.MONTHLY_REPORT_NOT_FOUND);
      }

      return serializeMonthlyReport(regenerated);
    } finally {
      if (this.lockService) {
        await this.lockService.release(lockKey);
      }
    }
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

    return serializeMonthlyReport(
      await this.prisma.monthly_reports.update({
        where: { monthly_report_id: reportId },
        data: {
          status: 'submitted',
          submitted_at: new Date(),
          submitted_by: userId,
        },
        include: { manual_data: true },
      }),
    );
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

    return serializeMonthlyReport(report);
  }

  // ========================================
  // LIST REPORTS
  // ========================================

  /**
   * Lists all reports for a given enrollment, with optional status filter.
   */
  async listReports(enrollmentId: string, status?: string) {
    await this.validateEnrollmentExists(enrollmentId);

    const rows = await this.prisma.monthly_reports.findMany({
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

    return rows.map(serializeMonthlyReport);
  }

  // ========================================
  // LIST REPORTS FOR ADMIN (multi-club supervision)
  // ========================================

  /**
   * Paginated list of monthly reports across clubs.
   * - super-admin / admin / DIA: can filter by division, union and local field.
   * - union roles: scope is forced to their own union, optionally narrowed by local field.
   * - local-field roles: scope is forced to their own local field.
   * - club roles: scope is forced to the active club section.
   * Roles and territory scope are derived from the resolved authorization profile
   * so that this method never trusts unverified JWT claims directly.
   */
  async listForAdmin(
    userId: string,
    filters: {
      clubTypeId?: number;
      divisionId?: number;
      unionId?: number;
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

    const reportScope = await resolveReportVisibilityScopeForActor(
      resolved,
      {
        divisionId: filters.divisionId,
        unionId: filters.unionId,
        localFieldId: filters.localFieldId,
      },
      () => this.loadCoordinatorSectionIds(userId),
    );

    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 25, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.monthly_reportsWhereInput = {
      ...(filters.year !== undefined && { year: filters.year }),
      ...(filters.month !== undefined && { month: filters.month }),
      ...(filters.status && { status: filters.status }),
      club_enrollment: {
        club_section: buildReportClubSectionWhere(reportScope, {
          ...(filters.clubTypeId !== undefined && {
            club_type_id: filters.clubTypeId,
          }),
        }),
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

  private async loadCoordinatorSectionIds(userId: string): Promise<number[]> {
    if (!this.coordinationService) {
      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }

    return this.coordinationService.getEffectiveCoordinatorSectionIds(userId);
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
   * Reconciles every overdue monthly report for active club enrollments.
   *
   * This method:
   * 1. Reads system_config to check whether auto-generation is enabled and
   *    to determine the configured day-of-month.
   * 2. Enumerates the enrollment's ecclesiastical-year months through the
   *    month before now.
   * 3. Loads existing report states in bounded batches.
   * 4. Generates only missing reports and existing drafts whose next-month
   *    UTC cutoff has passed.
   *
   * Idempotency is guaranteed by the preloaded status check plus the atomic
   * draft transition in generate(). BullMQ retries are therefore safe.
   *
   * @param forceDate - Optional date to use instead of now (useful for tests).
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

    const parsedConfiguredDay = dayConfig ? Number(dayConfig.config_value) : 5;
    const hasValidConfiguredDay =
      Number.isInteger(parsedConfiguredDay) &&
      parsedConfiguredDay >= 1 &&
      parsedConfiguredDay <= 28;
    const configuredDay = hasValidConfiguredDay ? parsedConfiguredDay : 5;

    if (dayConfig && !hasValidConfiguredDay) {
      this.logger.warn(
        `Invalid reports.auto_generate_day value "${dayConfig.config_value}"; using fallback day 5.`,
      );
    }

    const now = forceDate ?? new Date();

    // 3. Get all active club enrollments and their reportable date ranges
    const activeEnrollments = await this.prisma.club_enrollments.findMany({
      where: { status: 'active' },
      select: {
        club_enrollment_id: true,
        ecclesiastical_year: {
          select: { start_date: true, end_date: true },
        },
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

    // 4. Enumerate every overdue period before loading existing states in
    // bounded batches. This avoids a get-or-create query for every historical
    // report that has already been closed.
    const overduePeriods: Array<{
      enrollmentId: string;
      clubName: string;
      periodLabel: string;
      month: number;
      year: number;
    }> = [];

    const previousMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );

    for (const enrollment of activeEnrollments) {
      const clubName = enrollment.club_section?.clubs?.name ?? 'Unknown club';
      const clubType =
        enrollment.club_section?.club_types?.name ?? 'Unknown type';
      const label = `${clubName} (${clubType})`;

      const startMonth = new Date(
        Date.UTC(
          enrollment.ecclesiastical_year.start_date.getUTCFullYear(),
          enrollment.ecclesiastical_year.start_date.getUTCMonth(),
          1,
        ),
      );
      const enrollmentEndMonth = new Date(
        Date.UTC(
          enrollment.ecclesiastical_year.end_date.getUTCFullYear(),
          enrollment.ecclesiastical_year.end_date.getUTCMonth(),
          1,
        ),
      );
      const lastReportableMonth =
        enrollmentEndMonth.getTime() < previousMonth.getTime()
          ? enrollmentEndMonth
          : previousMonth;

      for (
        let period = startMonth;
        period.getTime() <= lastReportableMonth.getTime();
        period = new Date(
          Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 1),
        )
      ) {
        const periodMonth = period.getUTCMonth() + 1;
        const periodYear = period.getUTCFullYear();
        const cutoff = new Date(
          Date.UTC(
            periodYear,
            period.getUTCMonth() + 1,
            configuredDay,
            23,
            0,
            0,
            0,
          ),
        );

        if (now.getTime() < cutoff.getTime()) {
          continue;
        }

        overduePeriods.push({
          enrollmentId: enrollment.club_enrollment_id,
          clubName: label,
          periodLabel: `${periodYear}-${String(periodMonth).padStart(2, '0')}`,
          month: periodMonth,
          year: periodYear,
        });
      }
    }

    const reportKey = (enrollmentId: string, month: number, year: number) =>
      `${enrollmentId}:${year}:${month}`;
    const existingReports = new Map<
      string,
      { monthly_report_id: string; status: string }
    >();

    for (
      let index = 0;
      index < overduePeriods.length;
      index += AUTO_GENERATION_STATUS_BATCH_SIZE
    ) {
      const batch = overduePeriods.slice(
        index,
        index + AUTO_GENERATION_STATUS_BATCH_SIZE,
      );

      try {
        const reports = await this.prisma.monthly_reports.findMany({
          where: {
            OR: batch.map((period) => ({
              club_enrollment_id: period.enrollmentId,
              month: period.month,
              year: period.year,
            })),
          },
          select: {
            monthly_report_id: true,
            club_enrollment_id: true,
            month: true,
            year: true,
            status: true,
          },
        });

        for (const report of reports) {
          existingReports.set(
            reportKey(report.club_enrollment_id, report.month, report.year),
            report,
          );
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to preload monthly report states for batch ${index / AUTO_GENERATION_STATUS_BATCH_SIZE + 1}: ${errorMessage}. Falling back to per-period reconciliation.`,
        );
      }
    }

    // 5. Reconcile each overdue period independently so one failure does not
    // prevent later periods (or enrollments) from being processed.
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    let storageError: AppException | undefined;
    const errors: {
      enrollmentId: string;
      clubName: string;
      period: string;
      error: string;
    }[] = [];

    for (const period of overduePeriods) {
      try {
        let draft = existingReports.get(
          reportKey(period.enrollmentId, period.month, period.year),
        );

        if (!draft) {
          draft = await this.getOrCreateDraft(
            period.enrollmentId,
            period.month,
            period.year,
          );
        }

        if (draft.status !== 'draft') {
          this.logger.debug(
            `Report ${period.periodLabel} for ${period.clubName} already has status "${draft.status}". Skipping.`,
          );
          skipCount++;
          continue;
        }

        await this.generate(draft.monthly_report_id, 'system');

        successCount++;
        this.logger.log(
          `Generated report ${period.periodLabel} for ${period.clubName}`,
        );
      } catch (error) {
        errorCount++;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        errors.push({
          enrollmentId: period.enrollmentId,
          clubName: period.clubName,
          period: period.periodLabel,
          error: errorMessage,
        });
        if (!storageError && this.isMonthlyReportStorageError(error)) {
          storageError = error;
        }
        this.logger.error(
          `Failed to generate report ${period.periodLabel} for ${period.clubName}: ${errorMessage}`,
        );
      }
    }

    this.logger.log(
      'Auto-generation reconciliation complete: ' +
        `${successCount} generated, ${skipCount} skipped (already processed), ${errorCount} errors`,
    );

    if (errors.length > 0) {
      this.logger.warn(
        `Errors during auto-generation:\n${errors
          .map(
            (e) =>
              `  - ${e.period} ${e.clubName} (${e.enrollmentId}): ${e.error}`,
          )
          .join('\n')}`,
      );
    }

    if (storageError) {
      throw storageError;
    }

    return { itemsProcessed: successCount };
  }

  async runReminderNotifications(
    forceDate?: Date,
  ): Promise<{ itemsProcessed: number }> {
    if (!this.notificationsService) {
      this.logger.warn(
        'NotificationsService is not available. Skipping monthly report reminders.',
      );
      return { itemsProcessed: 0 };
    }

    const enabled = await this.areReminderNotificationsEnabled();
    if (!enabled) {
      this.logger.log('Monthly report reminders are disabled. Skipping.');
      return { itemsProcessed: 0 };
    }

    const schedule = this.resolveReminderSchedule(forceDate ?? new Date());
    if (!schedule) {
      return { itemsProcessed: 0 };
    }

    const activeEnrollments = await this.prisma.club_enrollments.findMany({
      where: { status: 'active' },
      select: {
        club_enrollment_id: true,
        club_section: {
          select: {
            club_section_id: true,
            clubs: { select: { name: true } },
            club_types: { select: { name: true } },
          },
        },
      },
    });

    let itemsProcessed = 0;

    for (const enrollment of activeEnrollments) {
      const clubSectionId = enrollment.club_section?.club_section_id;
      if (!clubSectionId) {
        continue;
      }

      if (!(await this.shouldSendReminderForEnrollment(enrollment, schedule))) {
        continue;
      }

      const message = this.buildReminderMessage(schedule);
      const clubName = enrollment.club_section?.clubs?.name ?? '';
      const clubType = enrollment.club_section?.club_types?.name ?? '';

      await this.notificationsService.sendToSectionRole(
        clubSectionId,
        [...MONTHLY_REPORT_REMINDER_ROLES],
        message.title,
        message.body,
        {
          type: 'monthly_report_reminder',
          action: schedule.action,
          reportMonth: String(schedule.month),
          reportYear: String(schedule.year),
          route: '/home/reports',
          enrollmentId: enrollment.club_enrollment_id,
          clubName,
          clubType,
        },
        MONTHLY_REPORT_REMINDER_SOURCE,
      );

      itemsProcessed++;
    }

    return { itemsProcessed };
  }

  // ========================================
  // PRIVATE HELPERS — auto-calculated queries
  // ========================================

  private async cleanupUploadedArtifact(
    artifact: MonthlyReportPdfArtifact | undefined,
  ): Promise<void> {
    if (!artifact || !this.monthlyReportArtifactsService) {
      return;
    }

    try {
      await this.monthlyReportArtifactsService.deleteArtifact(artifact);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to clean up monthly report artifact ${artifact.key}: ${errorMessage}`,
      );
    }
  }

  private isMonthlyReportStorageError(error: unknown): error is AppException {
    return (
      error instanceof AppException &&
      [
        ErrorCode.R2_UPLOAD_FAILED,
        ErrorCode.R2_DELETE_FAILED,
        ErrorCode.R2_SIGNED_URL_FAILED,
        ErrorCode.R2_VALIDATION_FAILED,
      ].includes(error.code)
    );
  }

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

  private async areReminderNotificationsEnabled(): Promise<boolean> {
    const config = await this.prisma.system_config.findUnique({
      where: { config_key: 'reports.reminders_enabled' },
    });

    return config?.config_value !== 'false';
  }

  private async shouldSendReminderForEnrollment(
    enrollment: { club_enrollment_id: string },
    schedule: MonthlyReportReminderSchedule,
  ): Promise<boolean> {
    if (schedule.action !== 'generated') {
      return true;
    }

    const report = await this.prisma.monthly_reports.findUnique({
      where: {
        club_enrollment_id_month_year: {
          club_enrollment_id: enrollment.club_enrollment_id,
          month: schedule.month,
          year: schedule.year,
        },
      },
      select: { status: true },
    });

    return report?.status === 'generated' || report?.status === 'submitted';
  }

  private resolveReminderSchedule(
    date: Date,
  ): MonthlyReportReminderSchedule | null {
    const { day, month, year } = this.getDatePartsInReportsTimeZone(date);

    if (day === 27) {
      return { action: 'capture_reminder', month, year };
    }

    if ([1, 4, 5, 6].includes(day)) {
      const previousMonth = month === 1 ? 12 : month - 1;
      const previousYear = month === 1 ? year - 1 : year;
      const actionByDay: Record<number, MonthlyReportReminderAction> = {
        1: 'five_days_left',
        4: 'one_day_left',
        5: 'closed',
        6: 'generated',
      };

      return {
        action: actionByDay[day],
        month: previousMonth,
        year: previousYear,
      };
    }

    return null;
  }

  private getDatePartsInReportsTimeZone(date: Date): {
    day: number;
    month: number;
    year: number;
  } {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: MONTHLY_REPORT_REMINDER_TIME_ZONE,
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    }).formatToParts(date);

    const getPart = (type: 'day' | 'month' | 'year') => {
      const value = parts.find((part) => part.type === type)?.value;
      return value ? parseInt(value, 10) : NaN;
    };

    return {
      day: getPart('day'),
      month: getPart('month'),
      year: getPart('year'),
    };
  }

  private buildReminderMessage(schedule: MonthlyReportReminderSchedule): {
    title: string;
    body: string;
  } {
    const monthName = this.getSpanishMonthName(schedule.month);

    switch (schedule.action) {
      case 'capture_reminder':
        return {
          title: `Actualiza el informe de ${monthName}`,
          body: 'Tienen datos manuales por revisar antes del cierre del informe mensual.',
        };
      case 'five_days_left':
        return {
          title: `Quedan 5 días para el informe de ${monthName}`,
          body: 'Todavía hay tiempo para completar o revisar los datos del informe.',
        };
      case 'one_day_left':
        return {
          title: `Último día para el informe de ${monthName}`,
          body: 'Revisen que todo esté completo antes del cierre.',
        };
      case 'closed':
        return {
          title: `El informe de ${monthName} ya cerró`,
          body: 'El periodo de captura cerró. El sistema preparará el reporte generado.',
        };
      case 'generated':
        return {
          title: `El informe de ${monthName} ya está listo`,
          body: 'Ya pueden revisar el informe mensual en Reportes.',
        };
    }
  }

  private getSpanishMonthName(month: number): string {
    const months = [
      'enero',
      'febrero',
      'marzo',
      'abril',
      'mayo',
      'junio',
      'julio',
      'agosto',
      'septiembre',
      'octubre',
      'noviembre',
      'diciembre',
    ];

    return months[month - 1] ?? String(month);
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
    const [summary] = await this.prisma.$queryRaw<
      {
        income: bigint | number | null;
        expenses: bigint | number | null;
        transactions: bigint | number | null;
        total_balance: bigint | number | null;
      }[]
    >`
      SELECT
        COALESCE(SUM(CASE WHEN fc.type = 0 AND f.year = ${year} AND f.month = ${month} THEN f.amount ELSE 0 END), 0)::bigint AS income,
        COALESCE(SUM(CASE WHEN fc.type <> 0 AND f.year = ${year} AND f.month = ${month} THEN f.amount ELSE 0 END), 0)::bigint AS expenses,
        COUNT(*) FILTER (WHERE f.year = ${year} AND f.month = ${month})::bigint AS transactions,
        COALESCE(SUM(CASE WHEN fc.type = 0 THEN f.amount ELSE -f.amount END), 0)::bigint AS total_balance
      FROM finances f
      JOIN finances_categories fc
        ON fc.finance_category_id = f.finance_category_id
      WHERE f.club_section_id = ${clubSectionId}
        AND f.active = true
        AND (f.year < ${year} OR (f.year = ${year} AND f.month <= ${month}))
    `;

    const totalIncome = Number(summary?.income ?? 0);
    const totalExpenses = Number(summary?.expenses ?? 0);
    const totalBalance = Number(summary?.total_balance ?? 0);
    const transactions = Number(summary?.transactions ?? 0);

    return {
      income: totalIncome,
      expenses: totalExpenses,
      balance: totalIncome - totalExpenses,
      total_balance: totalBalance,
      transactions,
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

    for (const field of MANUAL_DATA_FIELDS) {
      if (dto[field] !== undefined) {
        payload[field] = dto[field];
      }
    }

    return payload;
  }
}

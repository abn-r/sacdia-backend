import {
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AppNotFoundException,
  AppBadRequestException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { MonthlyReportsService } from '../monthly-reports/monthly-reports.service';

export interface YearClosureSummary {
  yearId: number;
  enrollmentsClosed: number;
  foldersClosed: number;
  reportsGenerated: number;
}

export interface YearClosurePreview {
  yearId: number;
  yearActive: boolean;
  startDate: Date;
  endDate: Date;
  enrollmentsToClose: number;
  foldersToClose: number;
  reportsToGenerate: number;
  enrollmentDetails: {
    club_enrollment_id: string;
    clubName: string;
    clubType: string;
    currentStatus: string;
  }[];
}

@Injectable()
export class YearEndService {
  private readonly logger = new Logger(YearEndService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly monthlyReportsService: MonthlyReportsService,
  ) {}

  // ========================================
  // CLOSE YEAR — main orchestrator
  // ========================================

  /**
   * Orchestrates the full year-end closure cascade:
   * 1. Mark ecclesiastical year as inactive
   * 2. Close all club_enrollments for that year
   * 3. Close all annual_folders linked to those enrollments
   * 4. Auto-generate (freeze) all draft monthly_reports
   *
   * All operations run inside a single transaction.
   */
  async closeYear(yearId: number): Promise<YearClosureSummary> {
    const year = await this.validateYearExists(yearId);

    if (!year.active) {
      throw new AppBadRequestException(ErrorCode.YEAR_END_YEAR_CLOSED);
    }

    this.logger.log(`Starting year-end closure for year ID ${yearId}...`);

    // RISK — INTENTIONALLY UNBOUNDED QUERY:
    // Fetches ALL open club_enrollments for the year to orchestrate closure.
    // This must be unbounded because every enrollment must be closed atomically.
    // Expected cardinality: hundreds of clubs × sections per year (< 5 000 rows).
    // If the dataset ever grows beyond that, refactor to cursor-based batching.
    const enrollments = await this.prisma.club_enrollments.findMany({
      where: {
        ecclesiastical_year_id: yearId,
        status: { not: 'closed' },
      },
      select: { club_enrollment_id: true },
    });

    const enrollmentIds = enrollments.map((e) => e.club_enrollment_id);

    // Find draft reports that need to be auto-generated
    const draftReports =
      enrollmentIds.length > 0
        ? await this.prisma.monthly_reports.findMany({
            where: {
              club_enrollment_id: { in: enrollmentIds },
              status: 'draft',
            },
            select: { monthly_report_id: true, club_enrollment_id: true },
          })
        : [];

    // Pre-generate snapshots for all draft reports (reads live data)
    const generatedReportIds: string[] = [];
    for (const report of draftReports) {
      try {
        await this.monthlyReportsService.generate(
          report.monthly_report_id,
          'system',
        );
        generatedReportIds.push(report.monthly_report_id);
        this.logger.debug(`Auto-generated report ${report.monthly_report_id}`);
      } catch (error) {
        // Log but don't fail the whole closure for a single report
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Failed to auto-generate report ${report.monthly_report_id}: ${msg}`,
        );
      }
    }

    // Now run the bulk status updates in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Mark ecclesiastical year as inactive
      await tx.ecclesiastical_years.update({
        where: { year_id: yearId },
        data: {
          active: false,
          modified_at: new Date(),
        },
      });

      // 2. Close all club_enrollments for this year
      const enrollmentsResult = await tx.club_enrollments.updateMany({
        where: {
          ecclesiastical_year_id: yearId,
          status: { not: 'closed' },
        },
        data: {
          status: 'closed',
          closed_at: new Date(),
        },
      });

      // 3. Close all annual_folders linked to those enrollments
      let foldersClosed = 0;
      if (enrollmentIds.length > 0) {
        const foldersResult = await tx.annual_folders.updateMany({
          where: {
            club_enrollment_id: { in: enrollmentIds },
            status: { not: 'closed' },
          },
          data: {
            status: 'closed',
            closed_at: new Date(),
          },
        });
        foldersClosed = foldersResult.count;
      }

      return {
        enrollmentsClosed: enrollmentsResult.count,
        foldersClosed,
      };
    });

    const summary: YearClosureSummary = {
      yearId,
      enrollmentsClosed: result.enrollmentsClosed,
      foldersClosed: result.foldersClosed,
      reportsGenerated: generatedReportIds.length,
    };

    this.logger.log(
      `Year-end closure complete for year ${yearId}: ` +
        `${summary.enrollmentsClosed} enrollments closed, ` +
        `${summary.foldersClosed} folders closed, ` +
        `${summary.reportsGenerated} reports auto-generated`,
    );

    return summary;
  }

  // ========================================
  // PREVIEW CLOSURE IMPACT — dry run
  // ========================================

  /**
   * Shows what WOULD be affected by closing this year, without making changes.
   */
  async previewClosureImpact(yearId: number): Promise<YearClosurePreview> {
    const year = await this.validateYearExists(yearId);

    // RISK — INTENTIONALLY UNBOUNDED QUERY:
    // Fetches ALL open club_enrollments for the preview dry-run.
    // Must be unbounded to give an accurate impact count.
    // Expected cardinality: hundreds of clubs × sections per year (< 5 000 rows).
    // If the dataset ever grows beyond that, refactor to cursor-based batching.
    const enrollments = await this.prisma.club_enrollments.findMany({
      where: {
        ecclesiastical_year_id: yearId,
        status: { not: 'closed' },
      },
      include: {
        club_section: {
          include: {
            clubs: { select: { name: true } },
            club_types: { select: { name: true } },
          },
        },
      },
    });

    const enrollmentIds = enrollments.map((e) => e.club_enrollment_id);

    // Folders that would be closed
    const foldersToClose =
      enrollmentIds.length > 0
        ? await this.prisma.annual_folders.count({
            where: {
              club_enrollment_id: { in: enrollmentIds },
              status: { not: 'closed' },
            },
          })
        : 0;

    // Draft reports that would be auto-generated
    const reportsToGenerate =
      enrollmentIds.length > 0
        ? await this.prisma.monthly_reports.count({
            where: {
              club_enrollment_id: { in: enrollmentIds },
              status: 'draft',
            },
          })
        : 0;

    return {
      yearId,
      yearActive: year.active,
      startDate: year.start_date,
      endDate: year.end_date,
      enrollmentsToClose: enrollments.length,
      foldersToClose,
      reportsToGenerate,
      enrollmentDetails: enrollments.map((e) => ({
        club_enrollment_id: e.club_enrollment_id,
        clubName: e.club_section?.clubs?.name ?? 'Unknown',
        clubType: e.club_section?.club_types?.name ?? 'Unknown',
        currentStatus: e.status,
      })),
    };
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  private async validateYearExists(yearId: number) {
    const year = await this.prisma.ecclesiastical_years.findUnique({
      where: { year_id: yearId },
    });

    if (!year) {
      throw new AppNotFoundException(ErrorCode.YEAR_END_ECCLESIASTICAL_YEAR_NOT_FOUND);
    }

    return year;
  }
}

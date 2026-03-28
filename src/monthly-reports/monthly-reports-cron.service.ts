import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MonthlyReportsService } from './monthly-reports.service';

@Injectable()
export class MonthlyReportsCronService {
  private readonly logger = new Logger(MonthlyReportsCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly monthlyReportsService: MonthlyReportsService,
  ) {}

  /**
   * Runs daily at 11 PM (server time).
   * Checks system_config for the configured auto-generation day.
   * If today matches the configured day, generates reports for all active
   * club enrollments for the PREVIOUS month.
   */
  @Cron('0 23 * * *', { name: 'monthly-reports-auto-generate' })
  async handleAutoGenerate(): Promise<void> {
    this.logger.log(
      'Monthly reports cron triggered — checking configuration...',
    );

    try {
      // 1. Read system_config to check if auto-generation is enabled
      const enabledConfig = await this.prisma.system_config.findUnique({
        where: { config_key: 'reports.auto_generate_enabled' },
      });

      if (!enabledConfig || enabledConfig.config_value !== 'true') {
        this.logger.log('Auto-generation is disabled. Skipping.');
        return;
      }

      // 2. Read the configured day of month
      const dayConfig = await this.prisma.system_config.findUnique({
        where: { config_key: 'reports.auto_generate_day' },
      });

      const configuredDay = dayConfig
        ? parseInt(dayConfig.config_value, 10)
        : 5;

      if (isNaN(configuredDay) || configuredDay < 1 || configuredDay > 28) {
        this.logger.warn(
          `Invalid auto_generate_day value: "${dayConfig?.config_value}". Must be 1-28. Skipping.`,
        );
        return;
      }

      // 3. Check if today is the configured day
      const today = new Date();
      const currentDay = today.getDate();

      if (currentDay !== configuredDay) {
        this.logger.debug(
          `Today is day ${currentDay}, configured day is ${configuredDay}. Skipping.`,
        );
        return;
      }

      this.logger.log(
        `Today is the configured auto-generation day (${configuredDay}). Starting report generation...`,
      );

      // 4. Calculate the PREVIOUS month and year
      const { month: prevMonth, year: prevYear } = this.getPreviousMonth(today);

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
        this.logger.log(
          'No active club enrollments found. Nothing to generate.',
        );
        return;
      }

      this.logger.log(
        `Found ${activeEnrollments.length} active enrollment(s). Processing...`,
      );

      // 6. For each enrollment, get or create draft and then generate
      let successCount = 0;
      let skipCount = 0;
      let errorCount = 0;
      const errors: {
        enrollmentId: string;
        clubName: string;
        error: string;
      }[] = [];

      for (const enrollment of activeEnrollments) {
        const clubName = enrollment.club_section?.clubs?.name ?? 'Unknown club';
        const clubType =
          enrollment.club_section?.club_types?.name ?? 'Unknown type';
        const label = `${clubName} (${clubType})`;

        try {
          // Get or create a draft for the previous month
          const draft = await this.monthlyReportsService.getOrCreateDraft(
            enrollment.club_enrollment_id,
            prevMonth,
            prevYear,
          );

          // Only generate if the report is still a draft
          if (draft.status !== 'draft') {
            this.logger.debug(
              `Report for ${label} already has status "${draft.status}". Skipping.`,
            );
            skipCount++;
            continue;
          }

          // Freeze the snapshot
          await this.monthlyReportsService.generate(
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
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Fatal error in monthly reports auto-generation: ${errorMessage}`,
      );
    }
  }

  /**
   * Calculates the previous month and year from a given date.
   * E.g., March 2026 -> { month: 2, year: 2026 }
   *        January 2026 -> { month: 12, year: 2025 }
   */
  private getPreviousMonth(date: Date): { month: number; year: number } {
    const currentMonth = date.getMonth() + 1; // getMonth() is 0-indexed
    const currentYear = date.getFullYear();

    if (currentMonth === 1) {
      return { month: 12, year: currentYear - 1 };
    }

    return { month: currentMonth - 1, year: currentYear };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { QuarterlyReportsService } from './quarterly-reports.service';
import { DistributedLockService } from '../common/services/distributed-lock.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';

@Injectable()
export class QuarterlyReportsCronService {
  private readonly logger = new Logger(QuarterlyReportsCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quarterlyReportsService: QuarterlyReportsService,
    private readonly lockService: DistributedLockService,
    private readonly cronLogger: CronRunLogger,
  ) {}

  /**
   * Runs at 01:00 UTC on the first day of each quarter (Jan 1, Apr 1, Jul 1, Oct 1).
   * Generates reports for the just-completed quarter for all active clubs.
   * Feature flag: reports.quarterly_auto_generate_enabled must be 'true'.
   */
  @Cron('0 1 1 1,4,7,10 *', {
    name: 'quarterly-reports-auto-generate',
    timeZone: 'UTC',
  })
  async handleAutoGenerate(): Promise<void> {
    const acquired = await this.lockService.tryAcquire(
      'cron:quarterly-reports-auto-generate',
      23 * 60 * 60 * 1000,
    );

    if (!acquired) {
      this.logger.debug(
        'Another instance is handling quarterly reports auto-generation — skipping',
      );
      await this.cronLogger.trackSkipped(
        'quarterly-reports-auto-generate',
        'lock_not_acquired',
      );
      return;
    }

    this.logger.log(
      'Quarterly reports cron triggered — checking configuration...',
    );

    try {
      await this.cronLogger.track(
        'quarterly-reports-auto-generate',
        async () => {
          // 1. Feature flag check
          const enabledConfig = await this.prisma.system_config.findUnique({
            where: { config_key: 'reports.quarterly_auto_generate_enabled' },
          });

          if (!enabledConfig || enabledConfig.config_value !== 'true') {
            this.logger.log('Quarterly auto-generation is disabled. Skipping.');
            return { itemsProcessed: 0 };
          }

          // 2. Calculate the just-completed quarter
          const today = new Date();
          const { year, quarter } = this.getJustCompletedQuarter(today);

          this.logger.log(
            `Generating quarterly reports for ${year} Q${quarter}`,
          );

          // 3. Run for all active clubs
          const result =
            await this.quarterlyReportsService.autoGenerateForAllClubs(
              year,
              quarter,
            );

          this.logger.log(
            `Quarterly auto-generation complete for ${year} Q${quarter}: ` +
              `${result.success} generated, ${result.skipped} skipped, ${result.errors} errors`,
          );

          return { itemsProcessed: result.success };
        },
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Fatal error in quarterly reports auto-generation: ${msg}`,
      );
    } finally {
      await this.lockService.release('cron:quarterly-reports-auto-generate');
    }
  }

  /**
   * Given a date that is the first day of a new quarter, returns the
   * year and quarter that just ended.
   *
   * Jan 1 → Q4 of previous year
   * Apr 1 → Q1 of current year
   * Jul 1 → Q2 of current year
   * Oct 1 → Q3 of current year
   */
  private getJustCompletedQuarter(date: Date): {
    year: number;
    quarter: number;
  } {
    const month = date.getMonth() + 1; // 1-indexed
    const year = date.getFullYear();

    // Month → quarter that just ended
    if (month === 1) return { year: year - 1, quarter: 4 };
    if (month === 4) return { year, quarter: 1 };
    if (month === 7) return { year, quarter: 2 };
    if (month === 10) return { year, quarter: 3 };

    // Fallback: calculate based on current month
    const currentQuarter = Math.ceil(month / 3);
    const prevQuarter = currentQuarter === 1 ? 4 : currentQuarter - 1;
    const prevYear = currentQuarter === 1 ? year - 1 : year;
    return { year: prevYear, quarter: prevQuarter };
  }
}

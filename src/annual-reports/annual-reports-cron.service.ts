import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AnnualReportsService } from './annual-reports.service';
import { DistributedLockService } from '../common/services/distributed-lock.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';

@Injectable()
export class AnnualReportsCronService {
  private readonly logger = new Logger(AnnualReportsCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly annualReportsService: AnnualReportsService,
    private readonly lockService: DistributedLockService,
    private readonly cronLogger: CronRunLogger,
  ) {}

  /**
   * Runs at 02:00 UTC on January 1st.
   * Generates annual reports for the just-completed ecclesiastical year for all active clubs.
   * Feature flag: reports.annual_auto_generate_enabled must be 'true'.
   */
  @Cron('0 2 1 1 *', { name: 'annual-reports-auto-generate', timeZone: 'UTC' })
  async handleAutoGenerate(): Promise<void> {
    const acquired = await this.lockService.tryAcquire(
      'cron:annual-reports-auto-generate',
      23 * 60 * 60 * 1000,
    );

    if (!acquired) {
      this.logger.debug('Another instance is handling annual reports auto-generation — skipping');
      await this.cronLogger.trackSkipped('annual-reports-auto-generate', 'lock_not_acquired');
      return;
    }

    this.logger.log('Annual reports cron triggered — checking configuration...');

    try {
      await this.cronLogger.track('annual-reports-auto-generate', async () => {
        // 1. Feature flag check
        const enabledConfig = await this.prisma.system_config.findUnique({
          where: { config_key: 'reports.annual_auto_generate_enabled' },
        });

        if (!enabledConfig || enabledConfig.config_value !== 'true') {
          this.logger.log('Annual auto-generation is disabled. Skipping.');
          return { itemsProcessed: 0 };
        }

        // 2. Find the ecclesiastical year that just ended (most recently inactive/ended)
        const today = new Date();
        const justEndedYear = await this.prisma.ecclesiastical_years.findFirst({
          where: {
            end_date: {
              lt: today,
            },
          },
          orderBy: { end_date: 'desc' },
        });

        if (!justEndedYear) {
          this.logger.warn('No completed ecclesiastical year found. Skipping annual report generation.');
          return { itemsProcessed: 0 };
        }

        this.logger.log(
          `Generating annual reports for ecclesiastical year ${justEndedYear.year_id} ` +
            `(${justEndedYear.start_date.toISOString().split('T')[0]} – ${justEndedYear.end_date.toISOString().split('T')[0]})`,
        );

        // 3. Run for all active clubs
        const result = await this.annualReportsService.autoGenerateForAllClubs(justEndedYear.year_id);

        this.logger.log(
          `Annual auto-generation complete for year ${justEndedYear.year_id}: ` +
            `${result.success} generated, ${result.skipped} skipped, ${result.errors} errors`,
        );

        return { itemsProcessed: result.success };
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Fatal error in annual reports auto-generation: ${msg}`);
    } finally {
      await this.lockService.release('cron:annual-reports-auto-generate');
    }
  }
}

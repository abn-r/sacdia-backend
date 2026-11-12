import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AnnualReportsService } from './annual-reports.service';
import { DistributedLockService } from '../common/services/distributed-lock.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';
import {
  FREEZE_GRACE_CONFIG_KEY,
  parseFreezeGraceDays,
} from '../reports/periodic-report-data.service';

const CRON_NAME = 'annual-reports-auto-generate';
const LOCK_KEY = `cron:${CRON_NAME}`;

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
   * Runs daily at 03:30 UTC as an idempotent catch-up: freezes (finalizes) the
   * annual report of every active club for every ecclesiastical year
   * that ended more than `reports.periodic_freeze_grace_days` days ago and is not frozen yet,
   * so the last monthly report of the year can still be submitted.
   * Feature flag: reports.annual_auto_generate_enabled must be 'true'.
   */
  @Cron('30 3 * * *', { name: CRON_NAME, timeZone: 'UTC' })
  async handleAutoGenerate(): Promise<void> {
    const acquired = await this.lockService.tryAcquire(
      LOCK_KEY,
      23 * 60 * 60 * 1000,
    );

    if (!acquired) {
      this.logger.debug(
        'Another instance is handling the annual reports freeze — skipping',
      );
      await this.cronLogger.trackSkipped(CRON_NAME, 'lock_not_acquired');
      return;
    }

    try {
      await this.cronLogger.track(CRON_NAME, async () => {
        const enabledConfig = await this.prisma.system_config.findUnique({
          where: { config_key: 'reports.annual_auto_generate_enabled' },
        });

        if (!enabledConfig || enabledConfig.config_value !== 'true') {
          this.logger.log('Annual auto-generation is disabled. Skipping.');
          return { itemsProcessed: 0 };
        }

        const graceConfig = await this.prisma.system_config.findUnique({
          where: { config_key: FREEZE_GRACE_CONFIG_KEY },
        });
        const graceDays = parseFreezeGraceDays(graceConfig?.config_value);

        const result =
          await this.annualReportsService.freezeDueReports(graceDays);

        this.logger.log(
          `Annual freeze complete (grace ${graceDays}d): ` +
            `${result.success} frozen, ${result.skipped} skipped, ${result.errors} errors`,
        );

        return { itemsProcessed: result.success };
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Fatal error in annual reports freeze: ${msg}`);
    } finally {
      await this.lockService.release(LOCK_KEY);
    }
  }
}

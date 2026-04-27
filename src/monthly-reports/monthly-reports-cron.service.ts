import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DistributedLockService } from '../common/services/distributed-lock.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';
import { MonthlyReportsService } from './monthly-reports.service';
import {
  MONTHLY_REPORTS_QUEUE,
  MonthlyReportsTriggerJobData,
} from './monthly-reports.processor';

@Injectable()
export class MonthlyReportsCronService {
  private readonly logger = new Logger(MonthlyReportsCronService.name);

  constructor(
    private readonly monthlyReportsService: MonthlyReportsService,
    private readonly lockService: DistributedLockService,
    private readonly cronLogger: CronRunLogger,
    @Optional()
    @InjectQueue(MONTHLY_REPORTS_QUEUE)
    private readonly queue: Queue | null,
  ) {}

  /**
   * Runs daily at 11 PM UTC.
   * Checks system_config for the configured auto-generation day.
   * If today matches, enqueues a BullMQ job with 5 attempts + exponential backoff.
   * Falls back to direct execution when Redis / BullMQ is unavailable.
   */
  @Cron('0 23 * * *', { name: 'monthly-reports-auto-generate', timeZone: 'UTC' })
  async handleAutoGenerate(): Promise<void> {
    const acquired = await this.lockService.tryAcquire(
      'cron:monthly-reports-auto-generate',
      23 * 60 * 60 * 1000, // 23 hours — slightly less than the 24-hour interval
    );
    if (!acquired) {
      this.logger.debug(
        'Another instance is handling monthly reports auto-generation — skipping',
      );
      await this.cronLogger.trackSkipped(
        'monthly-reports-auto-generate',
        'lock_not_acquired',
      );
      return;
    }

    this.logger.log(
      'Monthly reports cron triggered — enqueuing BullMQ job...',
    );

    try {
      if (this.queue) {
        const jobData: MonthlyReportsTriggerJobData = {
          triggeredAt: new Date().toISOString(),
        };
        await this.queue.add('auto-generate', jobData, {
          attempts: 5,
          backoff: { type: 'exponential', delay: 60_000 }, // 1 min → 2 → 4 → 8 → 16 min
          removeOnComplete: { age: 7 * 86_400 },   // keep 7 days
          removeOnFail: { age: 30 * 86_400 },       // keep 30 days
        });
        this.logger.log(
          'monthly-reports-auto-generate job enqueued with 5 attempts + exponential backoff',
        );
      } else {
        // Redis unavailable — execute directly (legacy fallback, retainability)
        this.logger.warn(
          'BullMQ queue unavailable — running monthly-reports auto-generation directly (no retry)',
        );
        await this.cronLogger.track(
          'monthly-reports-auto-generate',
          () => this.monthlyReportsService.runAutoGeneration(),
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Fatal error in monthly reports auto-generation trigger: ${errorMessage}`,
      );
    } finally {
      // Release the lock immediately after enqueuing (not after job completion).
      // The BullMQ worker runs the actual work; the lock only prevents duplicate
      // enqueues from multiple instances on the same cron tick.
      await this.lockService.release('cron:monthly-reports-auto-generate');
    }
  }
}

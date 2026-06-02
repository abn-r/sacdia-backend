import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DistributedLockService } from '../common/services/distributed-lock.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';
import { MonthlyReportsService } from './monthly-reports.service';

@Injectable()
export class MonthlyReportsReminderCronService {
  private readonly logger = new Logger(MonthlyReportsReminderCronService.name);

  constructor(
    private readonly monthlyReportsService: MonthlyReportsService,
    private readonly lockService: DistributedLockService,
    private readonly cronLogger: CronRunLogger,
  ) {}

  /**
   * Runs every morning in the product timezone and emits reminders only on:
   * day 27 (current month) and days 1, 4, 5, 6 (previous month close cycle).
   */
  @Cron('0 9 * * *', {
    name: 'monthly-reports-reminders',
    timeZone: 'America/Mexico_City',
  })
  async handleReminderNotifications(): Promise<void> {
    const acquired = await this.lockService.tryAcquire(
      'cron:monthly-reports-reminders',
      23 * 60 * 60 * 1000,
    );

    if (!acquired) {
      this.logger.debug(
        'Another instance is handling monthly report reminders — skipping',
      );
      await this.cronLogger.trackSkipped(
        'monthly-reports-reminders',
        'lock_not_acquired',
      );
      return;
    }

    try {
      await this.cronLogger.track('monthly-reports-reminders', () =>
        this.monthlyReportsService.runReminderNotifications(),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Fatal error in monthly report reminders cron: ${message}`,
      );
    } finally {
      await this.lockService.release('cron:monthly-reports-reminders');
    }
  }
}

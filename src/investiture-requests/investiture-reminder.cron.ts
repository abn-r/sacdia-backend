import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronRunLogger } from '../common/services/cron-run-logger.service';
import { DistributedLockService } from '../common/services/distributed-lock.service';
import { InvestitureCommunicationsService } from './investiture-communications.service';

export const INVESTITURE_REMINDER_JOB = 'investiture-authorization-reminders';

@Injectable()
export class InvestitureReminderCron {
  private readonly logger = new Logger(InvestitureReminderCron.name);

  constructor(
    private readonly communications: InvestitureCommunicationsService,
    private readonly lockService: DistributedLockService,
    private readonly cronLogger: CronRunLogger,
  ) {}

  @Cron('*/15 * * * *', {
    name: INVESTITURE_REMINDER_JOB,
    timeZone: 'UTC',
  })
  async handle(): Promise<void> {
    const acquired = await this.lockService.tryAcquire(
      `cron:${INVESTITURE_REMINDER_JOB}`,
      14 * 60 * 1000,
    );
    if (!acquired) {
      this.logger.debug(
        'Otra instancia envía los recordatorios de investidura',
      );
      await this.cronLogger.trackSkipped(
        INVESTITURE_REMINDER_JOB,
        'lock_not_acquired',
      );
      return;
    }
    try {
      await this.cronLogger.track(INVESTITURE_REMINDER_JOB, async () => {
        let reminded = 0;
        try {
          reminded = await this.communications.dispatchReminders(new Date());
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Fallo el despacho de recordatorios de investidura: ${message}`,
          );
        }
        const retried = await this.communications.deliverPending();
        return { itemsProcessed: reminded + retried };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Fallo el cron de recordatorios de investidura: ${message}`,
      );
    } finally {
      await this.lockService.release(`cron:${INVESTITURE_REMINDER_JOB}`);
    }
  }
}

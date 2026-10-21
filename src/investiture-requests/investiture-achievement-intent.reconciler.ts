import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronRunLock } from '../common/services/cron-run-lock.service';
import { InvestitureAuthorizationRequestService } from './investiture-authorization-requests.service';

export const INVESTITURE_ACHIEVEMENT_INTENT_JOB =
  'investiture-achievement-intent';

/**
 * Run-lock TTL (dead-process safety net only; released in `finally`). Kept
 * below the 5 minute schedule: a run delivers a handful of pending intents in
 * seconds, and a crashed process must not cost more than the next tick.
 */
const RUN_LOCK_TTL_MS = 4 * 60 * 1000;

@Injectable()
export class InvestitureAchievementIntentReconciler implements OnModuleInit {
  private readonly logger = new Logger(
    InvestitureAchievementIntentReconciler.name,
  );

  constructor(
    private readonly requests: InvestitureAuthorizationRequestService,
    private readonly runLock: CronRunLock,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcile();
  }

  @Cron('*/5 * * * *', {
    name: INVESTITURE_ACHIEVEMENT_INTENT_JOB,
    timeZone: 'UTC',
  })
  async reconcile(): Promise<void> {
    // Also called on boot, so a rolling deploy cannot overlap the first tick.
    // The job writes no cron_run_log row: a skipped run is only logged.
    await this.runLock.runExclusive(
      INVESTITURE_ACHIEVEMENT_INTENT_JOB,
      RUN_LOCK_TTL_MS,
      () => this.deliverConfirmedIntents(),
      { logsRuns: false },
    );
  }

  private async deliverConfirmedIntents(): Promise<void> {
    try {
      const delivered =
        await this.requests.reconcileConfirmedAchievementIntents();
      if (delivered > 0) {
        this.logger.log(
          `Se entregaron ${delivered} intenciones de logro ya confirmadas`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `No se pudieron reconciliar las intenciones de logro: ${message}`,
      );
    }
  }
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InvestitureAuthorizationRequestService } from './investiture-authorization-requests.service';

export const INVESTITURE_ACHIEVEMENT_INTENT_JOB =
  'investiture-achievement-intent';

@Injectable()
export class InvestitureAchievementIntentReconciler implements OnModuleInit {
  private readonly logger = new Logger(
    InvestitureAchievementIntentReconciler.name,
  );

  constructor(
    private readonly requests: InvestitureAuthorizationRequestService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcile();
  }

  @Cron('*/5 * * * *', {
    name: INVESTITURE_ACHIEVEMENT_INTENT_JOB,
    timeZone: 'UTC',
  })
  async reconcile(): Promise<void> {
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

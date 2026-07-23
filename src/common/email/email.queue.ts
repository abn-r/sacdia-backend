import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const EMAIL_QUEUE = 'emails';
export const EMAIL_DAILY_LIMIT = 90;
export const EMAIL_DAILY_LIMIT_DURATION_MS = 24 * 60 * 60 * 1000;
export const EMAIL_WORKER_OPTIONS = {
  limiter: {
    max: EMAIL_DAILY_LIMIT,
    duration: EMAIL_DAILY_LIMIT_DURATION_MS,
  },
} as const;

// ---------------------------------------------------------------------------
// Job type constants
// ---------------------------------------------------------------------------
export const EMAIL_JOB_DATA_EXPORT_READY = 'email.data-export-ready';
export const EMAIL_JOB_EMAIL_VERIFICATION = 'email.email-verification';
export const EMAIL_JOB_PASSWORD_RESET = 'email.password-reset';
export const EMAIL_JOB_ACCOUNT_DELETION_CONFIRMED =
  'email.account-deletion-confirmed';
export const EMAIL_JOB_CRON_ALERT = 'email.cron-alert';

export type EmailJobType =
  | typeof EMAIL_JOB_DATA_EXPORT_READY
  | typeof EMAIL_JOB_EMAIL_VERIFICATION
  | typeof EMAIL_JOB_PASSWORD_RESET
  | typeof EMAIL_JOB_ACCOUNT_DELETION_CONFIRMED
  | typeof EMAIL_JOB_CRON_ALERT;

// ---------------------------------------------------------------------------
// Job payload shapes
// ---------------------------------------------------------------------------
export type SupportedEmailLocale = 'es' | 'en' | 'fr' | 'pt-BR';

export interface DataExportReadyJobPayload {
  to: string;
  userId: string;
  exportId: string;
  deepLink: string;
  expiresAt: string; // ISO string — Date is not serializable over BullMQ
  lang?: SupportedEmailLocale;
}

export interface EmailVerificationJobPayload {
  to: string;
  verificationUrl: string;
  userName?: string;
  lang?: SupportedEmailLocale;
}

export interface PasswordResetJobPayload {
  to: string;
  resetUrl: string;
  lang?: SupportedEmailLocale;
}

export interface AccountDeletionConfirmedJobPayload {
  to: string;
  lang?: SupportedEmailLocale;
}

export interface CronAlertJobPayload {
  to: string;
  jobName: string;
  condition: string;
  conditionDetail: string;
  recentFailures: Array<{
    run_id: number;
    started_at: string;
    error_message: string | null;
    duration_ms: number | null;
  }>;
  locale?: string;
}

export type EmailJobPayload =
  | DataExportReadyJobPayload
  | EmailVerificationJobPayload
  | PasswordResetJobPayload
  | AccountDeletionConfirmedJobPayload
  | CronAlertJobPayload;

/**
 * BullMQ producer for the `emails` queue.
 *
 * Default job options:
 *   - attempts: 5  (aggressive retry for transient Resend failures)
 *   - backoff: exponential, 2s base (2s, 4s, 8s, 16s, 32s)
 *   - removeOnComplete: true  (keep queue clean)
 *   - removeOnFail: false  (DLQ: keep failed jobs for audit)
 *
 * Rate limiting (90/day) is enforced by the worker options used by
 * EmailProcessor. Jobs beyond the limit remain waiting in BullMQ.
 */
@Injectable()
export class EmailQueueProducer {
  private readonly logger = new Logger(EmailQueueProducer.name);

  constructor(
    @Optional()
    @InjectQueue(EMAIL_QUEUE)
    private readonly queue: Queue | undefined,
  ) {}

  async enqueue(
    jobType: EmailJobType,
    payload: EmailJobPayload,
  ): Promise<void> {
    if (!this.queue) {
      this.logger.warn(
        `[NO_REDIS] Email queue unavailable — dropping job type=${jobType}. Configure REDIS_URL to enable async email delivery.`,
      );
      return;
    }

    await this.queue.add(jobType, payload, {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    });

    this.logger.debug(`Email job enqueued: type=${jobType}`);
  }
}

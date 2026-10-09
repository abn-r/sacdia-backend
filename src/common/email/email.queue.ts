import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';

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
export const EMAIL_JOB_INVESTITURE_NOTICE = 'email.investiture-notice';

export type EmailJobType =
  | typeof EMAIL_JOB_DATA_EXPORT_READY
  | typeof EMAIL_JOB_EMAIL_VERIFICATION
  | typeof EMAIL_JOB_PASSWORD_RESET
  | typeof EMAIL_JOB_ACCOUNT_DELETION_CONFIRMED
  | typeof EMAIL_JOB_CRON_ALERT
  | typeof EMAIL_JOB_INVESTITURE_NOTICE;

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

export interface InvestitureNoticeJobPayload {
  dispatchId: string;
  subject?: string;
  paragraphs?: string[];
  link?: string | null;
}

export type EmailJobPayload =
  | DataExportReadyJobPayload
  | EmailVerificationJobPayload
  | PasswordResetJobPayload
  | AccountDeletionConfirmedJobPayload
  | CronAlertJobPayload
  | InvestitureNoticeJobPayload;

/**
 * BullMQ producer for the `emails` queue.
 *
 * Default job options:
 *   - attempts: 5  (aggressive retry for transient Resend failures; an
 *     `attempts` override is allowed, e.g. 1 for investiture reminders)
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
    options?: { required?: boolean; jobId?: string; attempts?: number },
  ): Promise<void> {
    if (!this.queue) {
      const message = `[NO_REDIS] Email queue unavailable — dropping job type=${jobType}. Configure REDIS_URL to enable async email delivery.`;
      if (options?.required) {
        this.logger.warn(message);
        throw new Error('email queue unavailable');
      }
      this.logger.warn(message);
      return;
    }

    await this.queue.add(jobType, payload, {
      ...(options?.jobId ? { jobId: options.jobId } : {}),
      // BCR33-N4: callers that cap provider calls themselves (investiture
      // reminders) hand over exactly one attempt per hand-off.
      attempts: options?.attempts ?? 5,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    });

    this.logger.debug(`Email job enqueued: type=${jobType}`);
  }

  async inspectJob(
    jobId: string,
  ): Promise<'unsupported' | 'missing' | 'failed' | 'done' | 'busy'> {
    if (!this.queue || typeof this.queue.getJob !== 'function') {
      return 'unsupported';
    }
    const job = await this.queue.getJob(jobId);
    if (!job) {
      return 'missing';
    }
    const state = await job.getState();
    if (state === 'failed') {
      return 'failed';
    }
    if (state === 'completed') {
      return 'done';
    }
    return 'busy';
  }

  async retryFailedJob(jobId: string): Promise<void> {
    if (!this.queue || typeof this.queue.getJob !== 'function') {
      return;
    }
    const job = await this.queue.getJob(jobId);
    if (!job || (await job.getState()) !== 'failed') {
      return;
    }
    await this.retryFailed(job);
  }

  private async retryFailed(job: Job): Promise<void> {
    try {
      await job.retry('failed', {
        resetAttemptsMade: true,
        resetAttemptsStarted: true,
      });
    } catch (error) {
      if ((await job.getState()) !== 'failed') {
        return;
      }
      throw error;
    }
  }
}

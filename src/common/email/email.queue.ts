import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const EMAIL_QUEUE = 'emails';

// ---------------------------------------------------------------------------
// Job type constants
// ---------------------------------------------------------------------------
export const EMAIL_JOB_DATA_EXPORT_READY = 'email.data-export-ready';
export const EMAIL_JOB_EMAIL_VERIFICATION = 'email.email-verification';
export const EMAIL_JOB_PASSWORD_RESET = 'email.password-reset';
export const EMAIL_JOB_ACCOUNT_DELETION_CONFIRMED =
  'email.account-deletion-confirmed';

export type EmailJobType =
  | typeof EMAIL_JOB_DATA_EXPORT_READY
  | typeof EMAIL_JOB_EMAIL_VERIFICATION
  | typeof EMAIL_JOB_PASSWORD_RESET
  | typeof EMAIL_JOB_ACCOUNT_DELETION_CONFIRMED;

// ---------------------------------------------------------------------------
// Job payload shapes
// ---------------------------------------------------------------------------
export interface DataExportReadyJobPayload {
  to: string;
  userId: string;
  exportId: string;
  deepLink: string;
  expiresAt: string; // ISO string — Date is not serializable over BullMQ
}

export interface EmailVerificationJobPayload {
  to: string;
  verificationUrl: string;
  userName?: string;
}

export interface PasswordResetJobPayload {
  to: string;
  resetUrl: string;
}

export interface AccountDeletionConfirmedJobPayload {
  to: string;
}

export type EmailJobPayload =
  | DataExportReadyJobPayload
  | EmailVerificationJobPayload
  | PasswordResetJobPayload
  | AccountDeletionConfirmedJobPayload;

/**
 * BullMQ producer for the `emails` queue.
 *
 * Default job options:
 *   - attempts: 5  (aggressive retry for transient Resend failures)
 *   - backoff: exponential, 2s base (2s, 4s, 8s, 16s, 32s)
 *   - removeOnComplete: true  (keep queue clean)
 *   - removeOnFail: false  (DLQ: keep failed jobs for audit)
 *
 * Rate limiting (90/day) is enforced at the queue-level limiter option
 * declared in email.module.ts BullMQ registration.
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

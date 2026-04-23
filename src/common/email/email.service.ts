import { Injectable, Logger } from '@nestjs/common';
import { maskEmail } from '../utils/mask-email.util';
import {
  EmailQueueProducer,
  EMAIL_JOB_DATA_EXPORT_READY,
  EMAIL_JOB_EMAIL_VERIFICATION,
  EMAIL_JOB_PASSWORD_RESET,
  EMAIL_JOB_ACCOUNT_DELETION_CONFIRMED,
} from './email.queue';

export interface SendDataExportReadyParams {
  userId: string;
  email: string;
  exportId: string;
  deepLink: string;
  expiresAt: Date;
}

export interface SendEmailVerificationParams {
  email: string;
  /** Full verification URL (token embedded) — NEVER pass raw token */
  verificationUrl: string;
  userName?: string;
}

export interface SendPasswordResetParams {
  email: string;
  /** Full reset URL (token embedded) — NEVER pass raw token */
  resetUrl: string;
}

export interface SendAccountDeletionConfirmedParams {
  /** Original email BEFORE anonymization — captured pre-transaction */
  email: string;
}

/**
 * Application-level email facade.
 *
 * All methods enqueue jobs into the `emails` BullMQ queue instead of sending
 * synchronously. This decouples the request lifecycle from email delivery
 * and gives us retry, backoff, and rate-limit protection for free.
 *
 * TOKEN SECURITY: This service never receives or logs raw tokens.
 * Callers build the full URL (token embedded) and pass it here.
 *
 * EMAIL_ENABLED gate: the processor re-checks the flag so jobs enqueued in
 * a disabled environment are silently dropped when consumed. Callers do NOT
 * need to check EMAIL_ENABLED — the gate is enforced at processing time.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly queue: EmailQueueProducer) {}

  async sendDataExportReady(params: SendDataExportReadyParams): Promise<void> {
    const { userId, email, exportId, deepLink, expiresAt } = params;
    this.logger.log(
      `Enqueuing data export ready email: exportId=${exportId} to=${maskEmail(email)}`,
    );
    await this.queue.enqueue(EMAIL_JOB_DATA_EXPORT_READY, {
      to: email,
      userId,
      exportId,
      deepLink,
      expiresAt: expiresAt.toISOString(),
    });
  }

  async sendEmailVerification(
    params: SendEmailVerificationParams,
  ): Promise<void> {
    const { email, verificationUrl, userName } = params;
    this.logger.log(
      `Enqueuing email verification: to=${maskEmail(email)}`,
    );
    await this.queue.enqueue(EMAIL_JOB_EMAIL_VERIFICATION, {
      to: email,
      verificationUrl,
      userName,
    });
  }

  async sendPasswordReset(params: SendPasswordResetParams): Promise<void> {
    const { email, resetUrl } = params;
    this.logger.log(
      `Enqueuing password reset email: to=${maskEmail(email)}`,
    );
    await this.queue.enqueue(EMAIL_JOB_PASSWORD_RESET, {
      to: email,
      resetUrl,
    });
  }

  async sendAccountDeletionConfirmed(
    params: SendAccountDeletionConfirmedParams,
  ): Promise<void> {
    const { email } = params;
    this.logger.log(
      `Enqueuing account deletion confirmed email: to=${maskEmail(email)}`,
    );
    await this.queue.enqueue(EMAIL_JOB_ACCOUNT_DELETION_CONFIRMED, {
      to: email,
    });
  }
}

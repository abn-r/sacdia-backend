import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Job } from 'bullmq';
import { render } from '@react-email/render';
import * as React from 'react';
import { ConfigService } from '@nestjs/config';

import {
  EMAIL_QUEUE,
  EMAIL_JOB_DATA_EXPORT_READY,
  EMAIL_JOB_EMAIL_VERIFICATION,
  EMAIL_JOB_PASSWORD_RESET,
  EMAIL_JOB_ACCOUNT_DELETION_CONFIRMED,
  DataExportReadyJobPayload,
  EmailVerificationJobPayload,
  PasswordResetJobPayload,
  AccountDeletionConfirmedJobPayload,
  EmailJobPayload,
} from './email.queue';
import { EMAIL_PROVIDER } from './providers/email-provider.interface';
import type { IEmailProvider } from './providers/email-provider.interface';
import { DataExportReadyEmail } from './templates/data-export-ready';
import { EmailVerificationEmail } from './templates/email-verification';
import { PasswordResetEmail } from './templates/password-reset';
import { AccountDeletionConfirmedEmail } from './templates/account-deletion-confirmed';

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * BullMQ worker for the `emails` queue.
 *
 * Responsibilities:
 *  1. Pick up a job from the queue
 *  2. Render the appropriate React Email template → HTML + plain-text
 *  3. Call IEmailProvider.send (Resend in production)
 *  4. On failure, throw so BullMQ applies exponential backoff (attempts=5)
 *
 * The rate limit of 90 emails/day is enforced at the BullMQ queue limiter level
 * (declared in email.module.ts). If the limiter is hit, BullMQ delays the job
 * automatically without triggering a retry attempt count.
 */
@Processor(EMAIL_QUEUE)
export class EmailProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(EmailProcessor.name);
  private readonly fromEmail: string;

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly provider: IEmailProvider,
    private readonly configService: ConfigService,
  ) {
    super();
    this.fromEmail =
      this.configService.get<string>('RESEND_FROM_EMAIL') ??
      'SACDIA <noreply@sacdia.app>';
  }

  onApplicationBootstrap() {
    this.worker.on('error', (err: Error) => {
      this.logger.error(`Email worker error: ${err.message}`, err.stack);
    });

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      this.logger.error(
        `Email job ${job?.id ?? 'unknown'} (${job?.name ?? 'unknown'}) failed permanently: ${err.message}`,
      );
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, {
          tags: {
            bullmq: true,
            queue: EMAIL_QUEUE,
            job_name: job?.name ?? 'unknown',
          },
          extra: {
            job_id: job?.id,
            attempts: job?.attemptsMade,
            failed_reason: job?.failedReason,
          },
        });
      }
    });
  }

  async process(job: Job<EmailJobPayload>): Promise<void> {
    if (process.env.EMAIL_ENABLED !== 'true') {
      this.logger.warn(
        `[EMAIL_DISABLED] Skipping email job type=${job.name} id=${job.id}`,
      );
      return;
    }

    const rendered = await this.renderTemplate(job.name, job.data);

    const payload = job.data as { to: string };
    await this.provider.send({
      to: payload.to,
      from: this.fromEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    this.logger.log(
      `Email sent: type=${job.name} id=${job.id} attempt=${job.attemptsMade + 1}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Private rendering helpers
  // ---------------------------------------------------------------------------

  private async renderTemplate(
    jobName: string,
    data: EmailJobPayload,
  ): Promise<RenderedEmail> {
    switch (jobName) {
      case EMAIL_JOB_DATA_EXPORT_READY: {
        const d = data as DataExportReadyJobPayload;
        const element = React.createElement(DataExportReadyEmail, {
          deepLink: d.deepLink,
          expiresAt: new Date(d.expiresAt),
        });
        return {
          subject: 'Tu exportación de datos SACDIA está lista',
          html: await render(element),
          text: await render(element, { plainText: true }),
        };
      }

      case EMAIL_JOB_EMAIL_VERIFICATION: {
        const d = data as EmailVerificationJobPayload;
        const element = React.createElement(EmailVerificationEmail, {
          verificationUrl: d.verificationUrl,
          userName: d.userName,
        });
        return {
          subject: 'Verificá tu correo — SACDIA',
          html: await render(element),
          text: await render(element, { plainText: true }),
        };
      }

      case EMAIL_JOB_PASSWORD_RESET: {
        const d = data as PasswordResetJobPayload;
        const element = React.createElement(PasswordResetEmail, {
          resetUrl: d.resetUrl,
        });
        return {
          subject: 'Restablecé tu contraseña — SACDIA',
          html: await render(element),
          text: await render(element, { plainText: true }),
        };
      }

      case EMAIL_JOB_ACCOUNT_DELETION_CONFIRMED: {
        const element = React.createElement(AccountDeletionConfirmedEmail, {});
        return {
          subject: 'Tu cuenta SACDIA fue eliminada',
          html: await render(element),
          text: await render(element, { plainText: true }),
        };
      }

      default:
        throw new Error(`EmailProcessor: unknown job type "${jobName}"`);
    }
  }
}

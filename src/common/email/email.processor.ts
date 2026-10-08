import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  Inject,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import { Job } from 'bullmq';
import { render } from '@react-email/render';
import * as React from 'react';
import { ConfigService } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';

import {
  EMAIL_QUEUE,
  EMAIL_JOB_DATA_EXPORT_READY,
  EMAIL_JOB_EMAIL_VERIFICATION,
  EMAIL_JOB_PASSWORD_RESET,
  EMAIL_JOB_ACCOUNT_DELETION_CONFIRMED,
  EMAIL_JOB_CRON_ALERT,
  EMAIL_JOB_INVESTITURE_NOTICE,
  EMAIL_WORKER_OPTIONS,
  DataExportReadyJobPayload,
  EmailVerificationJobPayload,
  PasswordResetJobPayload,
  AccountDeletionConfirmedJobPayload,
  CronAlertJobPayload,
  InvestitureNoticeJobPayload,
  EmailJobPayload,
  SupportedEmailLocale,
} from './email.queue';
import {
  INVESTITURE_MAIL_GATE,
  INVESTITURE_PROVIDER_IDEMPOTENCY_HORIZON_MS,
  investitureMailDeliveryEnabled,
  type InvestitureMailGate,
  type InvestitureProviderMessage,
} from './investiture-mail.gate';
import { EMAIL_PROVIDER } from './providers/email-provider.interface';
import type { IEmailProvider } from './providers/email-provider.interface';
import { DataExportReadyEmail } from './templates/data-export-ready';
import { EmailVerificationEmail } from './templates/email-verification';
import { PasswordResetEmail } from './templates/password-reset';
import { AccountDeletionConfirmedEmail } from './templates/account-deletion-confirmed';
import { CronAlertEmail } from './templates/cron-alert';
import { InvestitureNoticeEmail } from './templates/investiture-notice';
import { assertNoRelativeInvestitureLink } from '../../investiture-requests/investiture-communications.rules';
import type { CronAlertCondition } from './templates/cron-alert';

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const SUPPORTED_LOCALES: SupportedEmailLocale[] = ['es', 'en', 'fr', 'pt-BR'];

function resolveLang(raw: string | undefined): SupportedEmailLocale {
  if (raw && (SUPPORTED_LOCALES as string[]).includes(raw)) {
    return raw as SupportedEmailLocale;
  }
  return 'es';
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
 * The rate limit of 90 emails/day is enforced by BullMQ worker options. If the
 * limiter is hit, BullMQ delays the job automatically without triggering a
 * retry attempt count.
 */
@Processor(EMAIL_QUEUE, EMAIL_WORKER_OPTIONS)
export class EmailProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(EmailProcessor.name);
  private readonly fromEmail: string;

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly provider: IEmailProvider,
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {
    super();
    this.fromEmail =
      this.configService.get<string>('RESEND_FROM_EMAIL') ??
      'SACDIA <contacto@sacdia.com>';
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
      this.noteExhaustedInvestitureFailure(job, err);
    });
  }

  private noteExhaustedInvestitureFailure(
    job: Job | undefined,
    err: Error,
  ): void {
    if (!job || job.name !== EMAIL_JOB_INVESTITURE_NOTICE) {
      return;
    }
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) {
      return;
    }
    const dispatchId = (job.data as InvestitureNoticeJobPayload).dispatchId;
    const gate = this.mailGate();
    if (!dispatchId || !gate) {
      return;
    }
    void gate.markFailed(dispatchId, err.message).catch((error: Error) => {
      this.logger.error(
        `No se pudo marcar el correo de investidura ${dispatchId}: ${error.message}`,
      );
    });
  }

  private async investitureDeliveryOpen(
    gate: InvestitureMailGate,
    dispatchId: string,
    providerAlreadyAttempted: boolean,
  ): Promise<boolean> {
    if (investitureMailDeliveryEnabled()) {
      return true;
    }
    if (providerAlreadyAttempted) {
      await gate.markUncertain(dispatchId);
    } else {
      await gate.skipDisabled(dispatchId);
    }
    return false;
  }

  private mailGate(): InvestitureMailGate | null {
    if (!this.moduleRef) {
      return null;
    }
    try {
      return this.moduleRef.get<InvestitureMailGate>(INVESTITURE_MAIL_GATE, {
        strict: false,
      });
    } catch {
      return null;
    }
  }

  async process(job: Job<EmailJobPayload>): Promise<void> {
    if (job.name === EMAIL_JOB_INVESTITURE_NOTICE) {
      await this.processInvestiture(job as Job<InvestitureNoticeJobPayload>);
      return;
    }
    if (process.env.EMAIL_ENABLED !== 'true') {
      this.logger.warn(
        `[EMAIL_DISABLED] Skipping email job type=${job.name} id=${job.id}`,
      );
      return;
    }

    const rendered = await this.renderTemplate(job.name, job.data);

    const payload = job.data as EmailJobPayload & { to: string };
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

  private async processInvestiture(
    job: Job<InvestitureNoticeJobPayload>,
  ): Promise<void> {
    const gate = this.mailGate();
    if (!gate) {
      throw new Error('investiture mail gate unavailable');
    }
    const dispatchId = job.data.dispatchId;
    const existing = await gate.providerAttempt(dispatchId);
    if (
      !(await this.investitureDeliveryOpen(gate, dispatchId, existing != null))
    ) {
      return;
    }
    if (existing) {
      const allowed = await gate.deliveryStillAllowed(dispatchId);
      if (!allowed) {
        return;
      }
      const age = Date.now() - new Date(existing.at).getTime();
      if (age >= INVESTITURE_PROVIDER_IDEMPOTENCY_HORIZON_MS) {
        await gate.markUncertain(dispatchId);
        return;
      }
      const message = JSON.parse(existing.body) as InvestitureProviderMessage;
      assertNoRelativeInvestitureLink(message.html);
      assertNoRelativeInvestitureLink(message.text);
      if (!(await this.investitureDeliveryOpen(gate, dispatchId, true))) {
        return;
      }
      const result = await this.provider.send(message);
      await gate.acknowledge(dispatchId, result.messageId);
      return;
    }
    const fresh = await gate.prepare(dispatchId);
    if (!fresh) {
      return;
    }
    const snapshot = {
      to: fresh.to,
      subject: fresh.subject,
      paragraphs: [...fresh.paragraphs],
      link: fresh.link,
    };
    if (snapshot.link) {
      assertNoRelativeInvestitureLink(snapshot.link);
    }
    for (const paragraph of snapshot.paragraphs) {
      assertNoRelativeInvestitureLink(paragraph);
    }
    const rendered = await this.renderTemplate(job.name, {
      dispatchId,
      subject: snapshot.subject,
      paragraphs: snapshot.paragraphs,
      link: snapshot.link,
    });
    const message: InvestitureProviderMessage = {
      to: snapshot.to,
      from: this.fromEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: `investiture-mail-${dispatchId}`,
    };
    await gate.recordProviderAttempt(dispatchId, message, {
      to: snapshot.to,
      paragraphs: snapshot.paragraphs,
    });
    if (!(await this.investitureDeliveryOpen(gate, dispatchId, false))) {
      return;
    }
    const result = await this.provider.send(message);
    await gate.acknowledge(dispatchId, result.messageId);
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
        const lang = resolveLang(d.lang);
        const subject = this.i18n.translate('emails.data_export_subject', {
          lang,
        });
        const element = React.createElement(DataExportReadyEmail, {
          deepLink: d.deepLink,
          expiresAt: new Date(d.expiresAt),
          lang,
        });
        return {
          subject,
          html: await render(element),
          text: await render(element, { plainText: true }),
        };
      }

      case EMAIL_JOB_EMAIL_VERIFICATION: {
        const d = data as EmailVerificationJobPayload;
        const lang = resolveLang(d.lang);
        const subject = this.i18n.translate(
          'emails.email_verification_subject',
          { lang },
        );
        const element = React.createElement(EmailVerificationEmail, {
          verificationUrl: d.verificationUrl,
          userName: d.userName,
          lang,
        });
        return {
          subject,
          html: await render(element),
          text: await render(element, { plainText: true }),
        };
      }

      case EMAIL_JOB_PASSWORD_RESET: {
        const d = data as PasswordResetJobPayload;
        const lang = resolveLang(d.lang);
        const subject = this.i18n.translate('emails.password_reset_subject', {
          lang,
        });
        const element = React.createElement(PasswordResetEmail, {
          resetUrl: d.resetUrl,
          lang,
        });
        return {
          subject,
          html: await render(element),
          text: await render(element, { plainText: true }),
        };
      }

      case EMAIL_JOB_ACCOUNT_DELETION_CONFIRMED: {
        const d = data as AccountDeletionConfirmedJobPayload;
        const lang = resolveLang(d.lang);
        const subject = this.i18n.translate('emails.account_deletion_subject', {
          lang,
        });
        const element = React.createElement(AccountDeletionConfirmedEmail, {
          lang,
        });
        return {
          subject,
          html: await render(element),
          text: await render(element, { plainText: true }),
        };
      }

      case EMAIL_JOB_CRON_ALERT: {
        const d = data as CronAlertJobPayload;
        const subjectMap: Record<string, string> = {
          es: `[SACDIA] Job ${d.jobName} alerta: ${d.condition}`,
          en: `[SACDIA] Job ${d.jobName} alert: ${d.condition}`,
          'pt-BR': `[SACDIA] Job ${d.jobName} alerta: ${d.condition}`,
          fr: `[SACDIA] Job ${d.jobName} alerte: ${d.condition}`,
        };
        const subject = subjectMap[d.locale ?? 'es'] ?? subjectMap['es'];
        const element = React.createElement(CronAlertEmail, {
          jobName: d.jobName,
          condition: d.condition as CronAlertCondition,
          conditionDetail: d.conditionDetail,
          recentFailures: d.recentFailures,
          locale: d.locale as 'es' | 'en' | 'pt-BR' | 'fr' | undefined,
        });
        return {
          subject,
          html: await render(element),
          text: await render(element, { plainText: true }),
        };
      }

      case EMAIL_JOB_INVESTITURE_NOTICE: {
        const notice = data as InvestitureNoticeJobPayload;
        if (!notice.subject || !notice.paragraphs) {
          throw new Error('investiture notice has no fresh content');
        }
        const element = React.createElement(InvestitureNoticeEmail, {
          paragraphs: notice.paragraphs,
          link: notice.link ?? null,
        });
        return {
          subject: notice.subject,
          html: await render(element),
          text: await render(element, { plainText: true }),
        };
      }

      default:
        throw new Error(`EmailProcessor: unknown job type "${jobName}"`);
    }
  }
}

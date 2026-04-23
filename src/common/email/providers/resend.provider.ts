import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type {
  IEmailProvider,
  SendEmailPayload,
  SendResult,
} from './email-provider.interface';

/**
 * Resend transport implementation.
 *
 * Free tier limits: 3 000 emails/month, 100 emails/day.
 * Rate limiting (90/day guard) is enforced at the BullMQ queue level in
 * email.processor.ts — this provider simply calls the Resend API.
 *
 * API errors from Resend are thrown as-is so BullMQ's retry + backoff policy
 * handles transient failures (network blips, 5xx from Resend).
 */
@Injectable()
export class ResendEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(ResendEmailProvider.name);
  private readonly client: Resend;
  private readonly from: string;
  private readonly replyTo: string | undefined;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY') ?? '';
    this.from =
      this.configService.get<string>('RESEND_FROM_EMAIL') ??
      'SACDIA <noreply@sacdia.app>';
    this.replyTo = this.configService.get<string>('RESEND_REPLY_TO');
    this.client = new Resend(apiKey);
  }

  async send(payload: SendEmailPayload): Promise<SendResult> {
    const from = payload.from || this.from;
    const replyTo = payload.replyTo || this.replyTo;

    this.logger.debug(
      `Sending email via Resend: subject="${payload.subject}" to=<redacted>`,
    );

    const { data, error } = await this.client.emails.send({
      from,
      to: payload.to,
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });

    if (error || !data) {
      const message = error?.message ?? 'Resend returned no data';
      this.logger.error(`Resend API error: ${message}`);
      throw new Error(`Resend send failed: ${message}`);
    }

    this.logger.debug(`Email sent via Resend: messageId=${data.id}`);
    return { messageId: data.id };
  }
}

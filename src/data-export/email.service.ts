import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface DataExportReadyEmailParams {
  userId: string;
  email: string;
  exportId: string;
  deepLink: string;
  expiresAt: Date;
}

/**
 * Minimal email service for GDPR data export notifications.
 *
 * Current behaviour: when EMAIL_ENABLED=false (default), logs a warning with
 * all relevant fields. This acts as a stub for future transport integration
 * (SendGrid / Resend / Amazon SES).
 *
 * To add a real transport:
 *   1. Set EMAIL_ENABLED=true in your env.
 *   2. Inject your transport client (e.g. @sendgrid/mail) here.
 *   3. Replace the logger.warn branch with the actual send call.
 *   4. Keep the interface stable — DataExportReadyEmailParams must not change.
 *
 * Subject is intentionally generic to avoid revealing PII context in preview
 * panes — the app has minor users.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly emailEnabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.emailEnabled =
      this.configService.get<string>('EMAIL_ENABLED') === 'true';
  }

  async sendDataExportReady(params: DataExportReadyEmailParams): Promise<void> {
    const { userId, email, exportId, deepLink, expiresAt } = params;
    const subject = 'Your SACDIA data export is ready';

    if (!this.emailEnabled) {
      this.logger.warn(
        `[EMAIL_DISABLED] Would send "${subject}" to ${email} ` +
          `(userId=${userId}, exportId=${exportId}, expires=${expiresAt.toISOString()}, deepLink=${deepLink})`,
      );
      return;
    }

    // TODO: plug in real transport here (SendGrid/Resend/SES)
    // Example with SendGrid:
    //   await sgMail.send({
    //     to: email,
    //     from: 'noreply@sacdia.app',
    //     subject,
    //     text: `Your data is ready. Download at: ${deepLink}\nExpires: ${expiresAt.toISOString()}`,
    //   });

    this.logger.warn(
      `EMAIL_ENABLED=true but no transport is configured. ` +
        `Skipping send for exportId=${exportId}`,
    );
  }
}

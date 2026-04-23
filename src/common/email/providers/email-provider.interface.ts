/**
 * Abstraction for transactional email delivery.
 *
 * Keeping this interface thin (string HTML + plain-text) means the processor
 * owns rendering logic (via @react-email/render) and the provider only handles
 * wire transport. Swapping Resend for SES later is a one-file change.
 */
export const EMAIL_PROVIDER = 'EMAIL_PROVIDER';

export interface SendEmailPayload {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  /** Pre-rendered HTML string (from @react-email/render) */
  html: string;
  /** Plain-text fallback (from @react-email/render with plainText option) */
  text: string;
}

export interface SendResult {
  /** Provider-assigned message ID (for audit logs) */
  messageId: string;
}

export interface IEmailProvider {
  send(payload: SendEmailPayload): Promise<SendResult>;
}

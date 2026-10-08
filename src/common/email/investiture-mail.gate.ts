export const INVESTITURE_MAIL_GATE = Symbol('INVESTITURE_MAIL_GATE');

/** Correo de investidura solo si ambos interruptores están encendidos. */
export function investitureMailDeliveryEnabled(): boolean {
  return (
    process.env.INVESTITURE_EMAIL_ENABLED === 'true' &&
    process.env.EMAIL_ENABLED === 'true'
  );
}

/** Resend keeps an idempotency key for 24 hours. */
export const INVESTITURE_PROVIDER_IDEMPOTENCY_HORIZON_MS = 24 * 60 * 60 * 1000;

export type InvestitureMailFresh = {
  to: string;
  subject: string;
  paragraphs: string[];
  link: string | null;
};

export type InvestitureProviderMessage = {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

export type InvestitureAttemptScope = {
  to: string;
  paragraphs: string[];
};

export type InvestitureProviderAttempt = {
  at: string;
  body: string;
  scope?: InvestitureAttemptScope;
};

export interface InvestitureMailGate {
  prepare(dispatchId: string): Promise<InvestitureMailFresh | null>;
  acknowledge(dispatchId: string, messageId: string): Promise<void>;
  markFailed(dispatchId: string, error: string): Promise<void>;
  providerAttempt(
    dispatchId: string,
  ): Promise<InvestitureProviderAttempt | null>;
  recordProviderAttempt(
    dispatchId: string,
    message: InvestitureProviderMessage,
    scope: InvestitureAttemptScope,
  ): Promise<void>;
  markUncertain(dispatchId: string): Promise<void>;
  deliveryStillAllowed(dispatchId: string): Promise<boolean>;
  skipDisabled(dispatchId: string): Promise<void>;
}

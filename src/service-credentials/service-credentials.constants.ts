export const SERVICE_CREDENTIAL_TYPE_COUNSELOR_TRAINING =
  'COUNSELOR_TRAINING' as const;

export const SERVICE_CREDENTIAL_REVIEW_STATUSES = [
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
] as const;
export type ServiceCredentialReviewStatus =
  (typeof SERVICE_CREDENTIAL_REVIEW_STATUSES)[number];

export const SERVICE_CREDENTIAL_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;
export type ServiceCredentialMimeType =
  (typeof SERVICE_CREDENTIAL_ALLOWED_MIME_TYPES)[number];

export const SERVICE_CREDENTIAL_MAX_BYTES = 10 * 1024 * 1024;
export const SERVICE_CREDENTIAL_UPLOAD_TTL_SECONDS = 15 * 60;
export const SERVICE_CREDENTIAL_DOWNLOAD_TTL_SECONDS = 15 * 60;
export const SERVICE_CREDENTIAL_MAGIC_SAMPLE_BYTES = 8;

export const SERVICE_CREDENTIAL_PERMISSION = 'service_credentials:review';

const MIME_EXTENSION: Record<ServiceCredentialMimeType, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const MAGIC: Record<ServiceCredentialMimeType, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
};

export function isServiceCredentialMime(
  value: string,
): value is ServiceCredentialMimeType {
  return (SERVICE_CREDENTIAL_ALLOWED_MIME_TYPES as readonly string[]).includes(
    value,
  );
}

export function extensionForServiceCredentialMime(
  mime: ServiceCredentialMimeType,
): string {
  return MIME_EXTENSION[mime];
}

/** The first bytes of the object match the declared type. */
export function serviceCredentialMagicMatches(
  mime: ServiceCredentialMimeType,
  prefix: Buffer,
): boolean {
  const signature = MAGIC[mime];
  return (
    prefix.length >= signature.length &&
    signature.every((byte, index) => prefix[index] === byte)
  );
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` to a UTC midnight Date; null when it is not a real calendar day. */
export function parseDateOnly(value: string): Date | null {
  if (!DATE_ONLY.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}

export function formatDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

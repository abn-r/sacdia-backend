import { BadRequestException } from '@nestjs/common';

/** Same private-evidence ceiling already used by certification uploads. OCR page limits are a separate contract. */
export const CERTIFICATE_IMPORT_MAX_BYTES = 10 * 1024 * 1024;

export const CERTIFICATE_IMPORT_SIGNED_TTL_SECONDS = 15 * 60;

export const CERTIFICATE_IMPORT_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type CertificateImportMimeType =
  (typeof CERTIFICATE_IMPORT_ALLOWED_MIME_TYPES)[number];

const MIME_EXTENSION: Record<CertificateImportMimeType, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

const MAGIC: Record<
  CertificateImportMimeType,
  { offset: number; bytes: number[] }
> = {
  'image/jpeg': { offset: 0, bytes: [0xff, 0xd8, 0xff] },
  'image/png': { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] },
  'image/webp': { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  'application/pdf': { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },
};

export const CERTIFICATE_IMPORT_MAGIC_SAMPLE_BYTES = 16;

export const EDITABLE_CERTIFICATE_IMPORT_BATCH_STATUSES = [
  'DRAFT',
  'READY_TO_SUBMIT',
  'NEEDS_CORRECTION',
] as const;

export function extensionForCertificateMime(mimeType: string): string {
  if (!isCertificateImportMime(mimeType)) {
    throw new BadRequestException('CERTIFICATE_IMPORT_FILE_TYPE_INVALID');
  }
  return MIME_EXTENSION[mimeType];
}

export function assertCertificateImportPresign(
  mimeType: string,
  fileSize: number,
): asserts mimeType is CertificateImportMimeType {
  if (!isCertificateImportMime(mimeType)) {
    throw new BadRequestException('CERTIFICATE_IMPORT_FILE_TYPE_INVALID');
  }
  if (
    !Number.isInteger(fileSize) ||
    fileSize <= 0 ||
    fileSize > CERTIFICATE_IMPORT_MAX_BYTES
  ) {
    throw new BadRequestException('CERTIFICATE_IMPORT_FILE_TOO_LARGE');
  }
}

export function assertCertificateImportObject(
  stored: { size: number; contentType: string | null } | null,
  declaredSize: number,
  declaredMime: string,
  prefix: Buffer | null,
): void {
  if (!stored || !prefix) {
    throw new BadRequestException('CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED');
  }
  if (
    stored.size <= 0 ||
    stored.size > CERTIFICATE_IMPORT_MAX_BYTES ||
    Math.abs(stored.size - declaredSize) > Math.max(1024, declaredSize * 0.01)
  ) {
    throw new BadRequestException('CERTIFICATE_IMPORT_FILE_TOO_LARGE');
  }
  if (!magicMatches(declaredMime, prefix)) {
    throw new BadRequestException('CERTIFICATE_IMPORT_FILE_CONTENT_MISMATCH');
  }
}

export function isCertificateImportMime(
  mimeType: string,
): mimeType is CertificateImportMimeType {
  return (CERTIFICATE_IMPORT_ALLOWED_MIME_TYPES as readonly string[]).includes(
    mimeType,
  );
}

function magicMatches(mimeType: string, buffer: Buffer): boolean {
  if (!isCertificateImportMime(mimeType)) return false;
  const signature = MAGIC[mimeType];
  if (buffer.length < signature.offset + signature.bytes.length) return false;
  return signature.bytes.every(
    (byte, index) => buffer[signature.offset + index] === byte,
  );
}

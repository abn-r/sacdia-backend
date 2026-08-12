import { AppBadRequestException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

/**
 * Shared constants and helpers for certification evidence uploads
 * (requirement evidence and closeout/board-proof evidence). Both flows use
 * the same private R2 bucket (StorageBucketAlias.CERTIFICATION_EVIDENCE) and
 * the same MIME/size validation rules.
 */

export const CERTIFICATION_EVIDENCE_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export const CERTIFICATION_EVIDENCE_MAX_SIZE_BYTES = 10 * 1024 * 1024;

/** TTL de URLs firmadas de subida: 15 minutos. */
export const SIGNED_UPLOAD_TTL_SECONDS = 15 * 60;

/** TTL de URLs firmadas de descarga (revisión): 15 minutos. */
export const SIGNED_DOWNLOAD_TTL_SECONDS = 15 * 60;

/** Tolerancia entre tamaño anunciado y real en R2 antes de rechazar (1%). */
export const FILE_SIZE_TOLERANCE_RATIO = 0.01;

/**
 * Extracts a filesystem-safe extension from a client-supplied filename.
 * We deliberately discard the rest of the name (attacker-controlled) and
 * use a server-generated UUID as the authoritative filename.
 */
export function extractSafeExtension(fileName: string): string {
  const rawExt = fileName.includes('.')
    ? fileName.slice(fileName.lastIndexOf('.'))
    : '';
  return rawExt.replace(/[^a-zA-Z0-9.]/g, '');
}

/** Validates MIME type and declared size at presign time (before any upload happens). */
export function assertAllowedEvidenceFile(
  mimeType: string,
  fileSize: number,
): void {
  if (
    !(CERTIFICATION_EVIDENCE_ALLOWED_MIME_TYPES as readonly string[]).includes(
      mimeType,
    )
  ) {
    throw new AppBadRequestException(ErrorCode.CERT_EVIDENCE_INVALID_TYPE);
  }
  if (
    !Number.isFinite(fileSize) ||
    fileSize <= 0 ||
    fileSize > CERTIFICATION_EVIDENCE_MAX_SIZE_BYTES
  ) {
    throw new AppBadRequestException(ErrorCode.CERT_EVIDENCE_TOO_LARGE);
  }
}

/**
 * Validates the object actually stored in R2 against the metadata recorded
 * at presign time. Called at confirm time — never trust the client's claims
 * about what got uploaded.
 */
export function assertConfirmedObjectMatches(
  stored: { size: number; contentType: string | null } | null,
  declaredSizeBytes: number,
): void {
  if (!stored) {
    throw new AppBadRequestException(ErrorCode.CERT_REQUIREMENT_INCOMPLETE, {
      reason: 'evidence_object_not_found',
    });
  }
  if (
    !(CERTIFICATION_EVIDENCE_ALLOWED_MIME_TYPES as readonly string[]).includes(
      stored.contentType ?? '',
    )
  ) {
    throw new AppBadRequestException(ErrorCode.CERT_EVIDENCE_INVALID_TYPE);
  }
  const tolerance = Math.max(1024, declaredSizeBytes * FILE_SIZE_TOLERANCE_RATIO);
  if (
    Math.abs(stored.size - declaredSizeBytes) > tolerance ||
    stored.size > CERTIFICATION_EVIDENCE_MAX_SIZE_BYTES
  ) {
    throw new AppBadRequestException(ErrorCode.CERT_EVIDENCE_TOO_LARGE);
  }
}

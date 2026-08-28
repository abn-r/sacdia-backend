import { PipeTransform } from '@nestjs/common';
import 'multer';
import { AppBadRequestException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

/**
 * Camporee-order proof validation (same policy as field payment orders):
 * required file, max 10 MB, PDF/JPEG/PNG with magic-byte cross-check.
 */

export const MAX_PROOF_SIZE = 10 * 1024 * 1024; // 10 MB

export const PROOF_ALLOWED_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export type ProofMime = (typeof PROOF_ALLOWED_MIMES)[number];

const MAGIC_BYTES: Record<ProofMime, { offset: number; bytes: number[] }> = {
  'application/pdf': { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  'image/jpeg': { offset: 0, bytes: [0xff, 0xd8, 0xff] },
  'image/png': { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] },
};

/** Derive safe extension from MIME; never trust originalname. */
export function extensionFromMime(mime: ProofMime): string {
  const map: Record<ProofMime, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
  };
  return map[mime];
}

export class ProofFileValidationPipe implements PipeTransform {
  transform(file: Express.Multer.File | undefined): Express.Multer.File {
    if (!file) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_ORDER_PROOF_INVALID_FILE,
        { reason: 'file_missing' },
      );
    }

    if (file.size > MAX_PROOF_SIZE) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_ORDER_PROOF_INVALID_FILE,
        { reason: 'size_exceeded' },
      );
    }

    const allowedSet: readonly string[] = PROOF_ALLOWED_MIMES;
    if (!allowedSet.includes(file.mimetype)) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_ORDER_PROOF_INVALID_FILE,
        { reason: 'unsupported_mime' },
      );
    }

    const mime = file.mimetype as ProofMime;
    const { offset, bytes } = MAGIC_BYTES[mime];
    if (
      !file.buffer ||
      file.buffer.length < offset + bytes.length ||
      !bytes.every((b, i) => file.buffer[offset + i] === b)
    ) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_ORDER_PROOF_INVALID_FILE,
        { reason: 'magic_bytes_mismatch' },
      );
    }

    return file;
  }
}

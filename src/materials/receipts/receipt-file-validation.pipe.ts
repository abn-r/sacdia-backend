import { BadRequestException, PipeTransform } from '@nestjs/common';
import 'multer';

/**
 * Receipt file validation pipe.
 *
 * Validates:
 *   1. File presence — 400 if missing
 *   2. File size — max 10 MB — 400 with { code: 'invalid_file', reason: 'size_exceeded' }
 *   3. MIME type — allowed: application/pdf, image/jpeg, image/png
 *                  400 with { code: 'invalid_file', reason: 'unsupported_mime' }
 *
 * Magic-byte cross-check is also performed to prevent MIME spoofing.
 *
 * REQ-CMP-002, SC-12, SC-13.
 */

const MAX_RECEIPT_SIZE = 10 * 1024 * 1024; // 10 MB

export const RECEIPT_ALLOWED_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export type ReceiptMime = (typeof RECEIPT_ALLOWED_MIMES)[number];

const MAGIC_BYTES: Record<ReceiptMime, { offset: number; bytes: number[] }> = {
  'application/pdf': { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  'image/jpeg': { offset: 0, bytes: [0xff, 0xd8, 0xff] },
  'image/png': { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] },
};

/**
 * Derive safe file extension from MIME type.
 * NEVER trust `file.originalname` for extension — use this map only.
 */
export function extensionFromMime(mime: ReceiptMime): string {
  const map: Record<ReceiptMime, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
  };
  return map[mime];
}

export class ReceiptFileValidationPipe implements PipeTransform {
  transform(file: Express.Multer.File | undefined): Express.Multer.File {
    if (!file) {
      throw new BadRequestException({
        code: 'invalid_file',
        reason: 'file_missing',
        message: 'A file must be attached as multipart field "file"',
      });
    }

    // SC-12: size check
    if (file.size > MAX_RECEIPT_SIZE) {
      throw new BadRequestException({
        code: 'invalid_file',
        reason: 'size_exceeded',
        message: `File size ${file.size} bytes exceeds the 10 MB limit`,
      });
    }

    // SC-13: MIME type check
    const allowedSet: readonly string[] = RECEIPT_ALLOWED_MIMES;
    if (!allowedSet.includes(file.mimetype)) {
      throw new BadRequestException({
        code: 'invalid_file',
        reason: 'unsupported_mime',
        message: `MIME type '${file.mimetype}' is not allowed. Accepted: ${RECEIPT_ALLOWED_MIMES.join(', ')}`,
      });
    }

    // Magic-byte check — prevents MIME spoofing
    const mime = file.mimetype as ReceiptMime;
    const signature = MAGIC_BYTES[mime];
    if (signature && file.buffer) {
      const { offset, bytes } = signature;
      if (file.buffer.length < offset + bytes.length) {
        throw new BadRequestException({
          code: 'invalid_file',
          reason: 'unsupported_mime',
          message: 'File binary content does not match the declared MIME type',
        });
      }
      const matches = bytes.every((b, i) => file.buffer[offset + i] === b);
      if (!matches) {
        throw new BadRequestException({
          code: 'invalid_file',
          reason: 'unsupported_mime',
          message: 'File binary content does not match the declared MIME type',
        });
      }
    }

    return file;
  }
}

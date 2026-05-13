import { AppBadRequestException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * Allowed MIME types per resource type.
 * Extend this map when new resource types are introduced.
 */
export const ALLOWED_RESOURCE_MIME_TYPES: Record<string, string[]> = {
  document: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg'],
  image: ['image/jpeg', 'image/png', 'image/webp'],
};

/**
 * Magic-bytes signatures for every MIME type accepted by this module.
 *
 * `offset`  — byte offset where the signature starts inside the file buffer.
 * `bytes`   — expected byte sequence at that offset.
 * `altBytes` — optional alternative sequences (any match is accepted, e.g. MP3
 *              frames can start with different sync bits depending on the
 *              bitrate/sampling flags).
 *
 * References:
 *  - PDF:   https://en.wikipedia.org/wiki/PDF#File_format  (%PDF → 0x25 0x50 0x44 0x46)
 *  - JPEG:  SOI marker  0xFF 0xD8 0xFF
 *  - PNG:   0x89 0x50 0x4E 0x47
 *  - WebP:  RIFF....WEBP (WEBP signature at offset 8)
 *  - GIF:   GIF87a / GIF89a
 *  - DOCX / XLSX / ODP (OOXML):  ZIP PK header  0x50 0x4B 0x03 0x04
 *  - DOC (legacy binary):  0xD0 0xCF 0x11 0xE0  (Compound Document)
 *  - WAV:   RIFF....WAVE (WAVE at offset 8)
 *  - OGG:   OggS  0x4F 0x67 0x67 0x53
 *  - MP3:   ID3 tag (0x49 0x44 0x33) OR MPEG sync bits (0xFF 0xFB / 0xFF 0xFA / 0xFF 0xF3)
 */
const MAGIC_BYTES: Record<
  string,
  { offset: number; bytes: number[]; altBytes?: number[][] }
> = {
  // ── Images ────────────────────────────────────────────────────────────────
  'image/jpeg': { offset: 0, bytes: [0xff, 0xd8, 0xff] },
  'image/png': { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] },
  'image/webp': { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  'image/gif': {
    offset: 0,
    bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
    altBytes: [[0x47, 0x49, 0x46, 0x38, 0x39, 0x61]], // GIF89a
  },

  // ── Documents ─────────────────────────────────────────────────────────────
  'application/pdf': { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },
  // OOXML formats (docx, xlsx, pptx) are ZIP archives
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    offset: 0,
    bytes: [0x50, 0x4b, 0x03, 0x04],
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    offset: 0,
    bytes: [0x50, 0x4b, 0x03, 0x04],
  },
  // Legacy binary Office format (DOC / XLS) — Compound Document File (CDF)
  'application/msword': {
    offset: 0,
    bytes: [0xd0, 0xcf, 0x11, 0xe0],
  },
  'application/vnd.ms-excel': {
    offset: 0,
    bytes: [0xd0, 0xcf, 0x11, 0xe0],
  },

  // ── Audio ─────────────────────────────────────────────────────────────────
  'audio/wav': { offset: 8, bytes: [0x57, 0x41, 0x56, 0x45] }, // WAVE at offset 8 in RIFF header
  'audio/ogg': { offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53] }, // OggS
  // MP3: ID3v2 tag header OR raw MPEG sync word variants
  'audio/mpeg': {
    offset: 0,
    bytes: [0x49, 0x44, 0x33], // ID3
    altBytes: [
      [0xff, 0xfb], // MPEG1 Layer3, no flags
      [0xff, 0xfa], // MPEG1 Layer3, padding
      [0xff, 0xf3], // MPEG2 Layer3
      [0xff, 0xf2], // MPEG2 Layer3, padding
    ],
  },
};

/**
 * Resource types that must NOT carry a file upload.
 * These types store their content inline (body text or an external URL).
 */
const FILE_FREE_TYPES = new Set(['text', 'video_link']);

/**
 * Validates that the actual binary content of `file` matches the expected
 * magic bytes for `file.mimetype`.
 *
 * This prevents an attacker from uploading a malicious executable and declaring
 * it as `application/pdf` (or any other allowed type), because the MIME type
 * header in a multipart upload is entirely client-controlled.
 *
 * If no magic-byte entry exists for the given MIME type, the check is skipped
 * (fail-open) rather than rejected — this keeps the door open for future types
 * while guaranteeing the ones we explicitly know are validated.
 */
function validateMagicBytes(file: Express.Multer.File): void {
  const signature = MAGIC_BYTES[file.mimetype];
  if (!signature || !file.buffer) return; // no entry → skip check

  const { offset, bytes, altBytes } = signature;
  const requiredLength = offset + bytes.length;

  if (file.buffer.length < requiredLength) {
    throw new AppBadRequestException(ErrorCode.RESOURCE_FILE_CONTENT_MISMATCH, {
      detected: 'unknown',
    });
  }

  const matchesSequence = (seq: number[]): boolean =>
    seq.every((byte, i) => file.buffer[offset + i] === byte);

  if (matchesSequence(bytes)) return;

  if (altBytes && altBytes.some((alt) => matchesSequence(alt))) return;

  throw new AppBadRequestException(ErrorCode.RESOURCE_FILE_CONTENT_MISMATCH, {
    detected: file.mimetype,
  });
}

/**
 * Service-layer helper — NOT a NestJS PipeTransform.
 *
 * Call this inside the service method after receiving both the `file` from
 * `@UploadedFile()` and the `resource_type` from the validated DTO body.
 * Doing the check here (rather than in a Pipe) avoids the NestJS limitation
 * where a Pipe on `@UploadedFile()` does not have access to other body fields.
 *
 * Throws `BadRequestException` on any validation failure.
 */
export function validateResourceFile(
  file: Express.Multer.File | undefined,
  resourceType: string,
): void {
  // text and video_link must NOT have a file attached
  if (FILE_FREE_TYPES.has(resourceType)) {
    if (file) {
      throw new AppBadRequestException(ErrorCode.RESOURCE_FILE_NOT_REQUIRED, {
        resource_type: resourceType,
      });
    }
    return;
  }

  // document, audio, image MUST have a file attached
  if (!file) {
    throw new AppBadRequestException(ErrorCode.RESOURCE_FILE_REQUIRED, {
      resource_type: resourceType,
    });
  }

  // Size check
  if (file.size > MAX_FILE_SIZE) {
    throw new AppBadRequestException(ErrorCode.RESOURCE_FILE_TOO_LARGE, {
      max_mb: '50',
    });
  }

  // MIME type check
  const allowedTypes = ALLOWED_RESOURCE_MIME_TYPES[resourceType];
  if (!allowedTypes) {
    throw new AppBadRequestException(ErrorCode.RESOURCE_FILE_MIME_INVALID, {
      mime_type: resourceType,
    });
  }

  if (!allowedTypes.includes(file.mimetype)) {
    throw new AppBadRequestException(ErrorCode.RESOURCE_FILE_TYPE_INVALID, {
      resource_type: resourceType,
      allowed: allowedTypes.join(', '),
    });
  }

  // Magic bytes validation — must run AFTER the MIME type check so we only
  // read the buffer for types we actually accept.
  validateMagicBytes(file);
}

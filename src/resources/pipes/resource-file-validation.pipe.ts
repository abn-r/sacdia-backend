import { BadRequestException } from '@nestjs/common';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * Allowed MIME types per resource type.
 * Extend this map when new resource types are introduced.
 */
const ALLOWED_MIME_TYPES: Record<string, string[]> = {
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
 * Resource types that must NOT carry a file upload.
 * These types store their content inline (body text or an external URL).
 */
const FILE_FREE_TYPES = new Set(['text', 'video_link']);

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
      throw new BadRequestException(
        `Resource type '${resourceType}' must not include a file upload`,
      );
    }
    return;
  }

  // document, audio, image MUST have a file attached
  if (!file) {
    throw new BadRequestException(
      `Resource type '${resourceType}' requires a file upload`,
    );
  }

  // Size check
  if (file.size > MAX_FILE_SIZE) {
    throw new BadRequestException('File size exceeds maximum of 50MB');
  }

  // MIME type check
  const allowedTypes = ALLOWED_MIME_TYPES[resourceType];
  if (!allowedTypes) {
    throw new BadRequestException(`Invalid resource type: ${resourceType}`);
  }

  if (!allowedTypes.includes(file.mimetype)) {
    throw new BadRequestException(
      `Invalid file type '${file.mimetype}' for resource type '${resourceType}'. ` +
        `Allowed: ${allowedTypes.join(', ')}`,
    );
  }
}

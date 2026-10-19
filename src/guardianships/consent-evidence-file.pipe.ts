import { PipeTransform } from '@nestjs/common';
import 'multer';
import { AppBadRequestException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  ALLOWED_MIME_TYPES,
  FileValidationPipe,
} from '../common/pipes/file-validation.pipe';

/** Signed consent forms: 10 MB, JPEG/PNG/WebP/PDF (HEIC is converted by the app). */
export const MAX_CONSENT_EVIDENCE_BYTES = 10 * 1024 * 1024;

export const CONSENT_EVIDENCE_MIME_TYPES: readonly string[] =
  ALLOWED_MIME_TYPES.IMAGES_AND_DOCUMENTS;

/**
 * The file is required and must be what it claims to be: allowed MIME type,
 * size cap and a magic-byte check (a renamed executable or a HEIC photo is a
 * 400). The extension of the stored object comes from the validated MIME type,
 * never from the original file name.
 */
export class ConsentEvidenceFilePipe implements PipeTransform {
  private readonly inner = new FileValidationPipe({
    maxSize: MAX_CONSENT_EVIDENCE_BYTES,
    allowedMimeTypes: [...CONSENT_EVIDENCE_MIME_TYPES],
  });

  transform(file: Express.Multer.File | undefined): Express.Multer.File {
    if (!file) {
      throw new AppBadRequestException(ErrorCode.FILE_REQUIRED);
    }
    return this.inner.transform(file) as Express.Multer.File;
  }
}

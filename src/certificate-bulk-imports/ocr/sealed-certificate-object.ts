import { BadRequestException } from '@nestjs/common';
import { AppInternalServerErrorException } from '../../common/errors/app.exception';
import {
  StorageBucketAlias,
  type FileStorageService,
} from '../../common/services/file-storage.service';
import {
  assertCertificateImportObject,
  CERTIFICATE_IMPORT_MAX_BYTES,
} from '../certificate-import-files.constants';
import type { CertificateOcrFileInput } from './certificate-ocr.provider';

/** Max characters of OCR text persisted in `raw_ocr_payload.rawText`. */
export const STORED_TEXT_LIMIT = 20_000;

const OCR_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

export function clipStoredOcrText(rawText: string): string {
  return rawText.slice(0, STORED_TEXT_LIMIT);
}

/**
 * Reads the sealed certificate object and proves it is what the row declared.
 * Shared by every OCR provider; the check order is part of the contract:
 *
 *  1. MIME supported          -> CERTIFICATE_IMPORT_OCR_UNSUPPORTED_TYPE
 *  2. object key present/opaque -> CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED
 *  3. declared size sane      -> CERTIFICATE_IMPORT_OCR_FILE_TOO_LARGE
 *  4. getObjectInfo           -> NOT_CONFIRMED when absent, FILE_TOO_LARGE on
 *                                bad size, UNSUPPORTED_TYPE on MIME drift
 *  5. getObject               -> NOT_CONFIRMED when absent, FILE_TOO_LARGE
 *  6. magic bytes             -> assertCertificateImportObject codes
 *  7. size drift              -> CERTIFICATE_IMPORT_FILE_CONTENT_MISMATCH
 *
 * Storage outages surface as CERTIFICATE_IMPORT_STORAGE_UNAVAILABLE.
 */
export async function readSealedCertificateObject(
  storage: FileStorageService,
  file: CertificateOcrFileInput,
): Promise<Buffer> {
  if (!OCR_MIME_TYPES.has(file.fileType)) {
    throw new BadRequestException('CERTIFICATE_IMPORT_OCR_UNSUPPORTED_TYPE');
  }
  const objectKey = file.objectKey?.trim() ?? '';
  if (!objectKey || /^https?:\/\//i.test(objectKey)) {
    throw new BadRequestException('CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED');
  }
  if (
    file.sizeBytes != null &&
    (!Number.isInteger(file.sizeBytes) ||
      file.sizeBytes <= 0 ||
      file.sizeBytes > CERTIFICATE_IMPORT_MAX_BYTES)
  ) {
    throw new BadRequestException('CERTIFICATE_IMPORT_OCR_FILE_TOO_LARGE');
  }
  const info = await readStored(() =>
    storage.getObjectInfo(StorageBucketAlias.CERTIFICATE_IMPORTS, objectKey),
  );
  if (!info) {
    throw new BadRequestException('CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED');
  }
  if (
    !Number.isInteger(info.size) ||
    info.size <= 0 ||
    info.size > CERTIFICATE_IMPORT_MAX_BYTES
  ) {
    throw new BadRequestException('CERTIFICATE_IMPORT_OCR_FILE_TOO_LARGE');
  }
  if (info.contentType && info.contentType !== file.fileType) {
    throw new BadRequestException('CERTIFICATE_IMPORT_OCR_UNSUPPORTED_TYPE');
  }
  const bytes = await readStored(() =>
    storage.getObject(
      StorageBucketAlias.CERTIFICATE_IMPORTS,
      objectKey,
      CERTIFICATE_IMPORT_MAX_BYTES,
    ),
  );
  if (!bytes) {
    throw new BadRequestException('CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED');
  }
  if (bytes.length > CERTIFICATE_IMPORT_MAX_BYTES) {
    throw new BadRequestException('CERTIFICATE_IMPORT_OCR_FILE_TOO_LARGE');
  }
  assertCertificateImportObject(
    { size: bytes.length, contentType: file.fileType },
    bytes.length,
    file.fileType,
    bytes,
  );
  if (
    bytes.length !== info.size ||
    (file.sizeBytes != null && file.sizeBytes !== bytes.length)
  ) {
    throw new BadRequestException('CERTIFICATE_IMPORT_FILE_CONTENT_MISMATCH');
  }
  return bytes;
}

async function readStored<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AppInternalServerErrorException) {
      throw new BadRequestException('CERTIFICATE_IMPORT_STORAGE_UNAVAILABLE');
    }
    throw error;
  }
}

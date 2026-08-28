import type { CertificateOcrParseResult } from './certificate-ocr.parser';

export interface CertificateOcrFileInput {
  fileUrl: string;
  fileName: string;
  fileType: string;
  rawText?: string;
}

export interface CertificateOcrProvider {
  /**
   * Parse certificate files into suggested honor/class rows.
   * Do not HTTP-fetch `fileUrl` unless it already passed
   * `normalizeCertificateImportFileRef`. Prefer resolving storage keys
   * via FileStorageService — never follow client-supplied hosts.
   */
  extract(files: CertificateOcrFileInput[]): Promise<CertificateOcrParseResult>;
}

export const CERTIFICATE_OCR_PROVIDER = Symbol('CERTIFICATE_OCR_PROVIDER');

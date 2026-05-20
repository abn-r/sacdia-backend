import type { CertificateOcrParseResult } from './certificate-ocr.parser';

export interface CertificateOcrFileInput {
  fileUrl: string;
  fileName: string;
  fileType: string;
  rawText?: string;
}

export interface CertificateOcrProvider {
  extract(files: CertificateOcrFileInput[]): Promise<CertificateOcrParseResult>;
}

export const CERTIFICATE_OCR_PROVIDER = Symbol('CERTIFICATE_OCR_PROVIDER');

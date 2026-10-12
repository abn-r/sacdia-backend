export const CERTIFICATE_OCR_QUEUE = 'certificate-import-ocr';
export const CERTIFICATE_OCR_JOB = 'read';

export type CertificateOcrJobPayload = {
  userId: string;
  batchId: string;
};

/** Deterministic id: one OCR job per batch (no duplicates while one is live). */
export function certificateOcrJobId(batchId: string): string {
  return `certificate-ocr-${batchId}`;
}

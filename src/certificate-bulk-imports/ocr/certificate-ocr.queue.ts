export const CERTIFICATE_OCR_QUEUE = 'certificate-import-ocr';
export const CERTIFICATE_OCR_JOB = 'read';

export type CertificateOcrJobPayload = {
  userId: string;
  batchId: string;
};

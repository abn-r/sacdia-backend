import type { Readable } from 'node:stream';

export const FINANCE_EVIDENCE_STORAGE = Symbol('FINANCE_EVIDENCE_STORAGE');

export const FINANCE_EVIDENCE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type FinanceEvidenceMime = (typeof FINANCE_EVIDENCE_MIME_TYPES)[number];

export type FinanceEvidenceObject = {
  uploadId: string;
  clubId: number;
  clubSectionId: number;
};

export type FinanceEvidenceObjectHead = {
  etag: string;
  size: number;
  mimeType: FinanceEvidenceMime;
  metadata: FinanceEvidenceObject & { size: number };
};

export interface FinanceEvidenceStoragePort {
  issueCreateOnlyPut(
    input: FinanceEvidenceObject & {
      mimeType: FinanceEvidenceMime;
      size: number;
      expiresInSeconds: number;
    },
  ): Promise<{
    uploadUrl: string;
    expiresInSeconds: number;
    requiredHeaders: Record<string, string>;
  }>;
  head(input: FinanceEvidenceObject): Promise<FinanceEvidenceObjectHead | null>;
  getStream(input: FinanceEvidenceObject & { etag: string }): Promise<Readable>;
}

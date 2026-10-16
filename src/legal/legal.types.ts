import type { LegalDocumentType } from './legal-documents.constants';

export interface LegalDocument {
  document_type: LegalDocumentType;
  version: string;
  url: string;
}

export interface LegalDocumentStatus extends LegalDocument {
  accepted: boolean;
  /** ISO string of the acceptance of the CURRENT version, or null when pending. */
  accepted_at: string | null;
}

export interface LegalStatus {
  requires_acceptance: boolean;
  documents: LegalDocumentStatus[];
}

export type AcceptedLegalVersions = Record<LegalDocumentType, string>;

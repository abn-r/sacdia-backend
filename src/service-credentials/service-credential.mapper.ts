import type { Prisma } from '@prisma/client';
import { formatDateOnly } from './service-credentials.constants';

export const CREDENTIAL_SELECT = {
  credential_id: true,
  credential_type: true,
  completed_at: true,
  status: true,
  upload_status: true,
  decision_reason: true,
  reviewed_at: true,
  expires_at: true,
  original_filename: true,
  created_at: true,
} satisfies Prisma.service_credentialsSelect;

export type CredentialRow = Prisma.service_credentialsGetPayload<{
  select: typeof CREDENTIAL_SELECT;
}>;

export type CredentialView = {
  credential_id: string;
  type: string;
  completed_at: string | null;
  status: string;
  upload_status: string;
  decision_reason: string | null;
  reviewed_at: string | null;
  expires_at: string | null;
  file_name: string | null;
  created_at: string;
};

/** What the owner sees of their own credential. */
export function toCredentialView(row: CredentialRow): CredentialView {
  return {
    credential_id: row.credential_id,
    type: row.credential_type,
    completed_at: formatDateOnly(row.completed_at),
    status: row.status,
    upload_status: row.upload_status,
    decision_reason: row.decision_reason,
    reviewed_at: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    expires_at: formatDateOnly(row.expires_at),
    file_name: row.original_filename,
    created_at: row.created_at.toISOString(),
  };
}

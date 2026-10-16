-- Migration: 20261015120000_legal_acceptances
-- Append-only evidence of Terms/Privacy acceptance (LFPDPPP, store review).
-- Additive only: creates one table and one index; touches no existing table.
-- Render runs `prisma migrate deploy` at the END OF THE BUILD (Free plan, no
-- preDeploy), so this runs inside the build, before the new instance serves traffic.
-- It runs inside one transaction: plain index build (the table is new and empty).
-- Re-runnable via IF NOT EXISTS.
-- FKs use the default referential action (NO ACTION): users are soft-deleted/anonymized,
-- never hard-removed, so nothing cascades.
-- Rollback (manual, per Neon branch): remove the table with the standard
-- statement for dropping a table, applied by hand; there is no down migration.
CREATE TABLE IF NOT EXISTS legal_acceptances (
  legal_acceptance_id uuid           NOT NULL DEFAULT gen_random_uuid(),
  user_id             uuid           NOT NULL,
  document_type       varchar(16)    NOT NULL,
  document_version    varchar(32)    NOT NULL,
  accepted_at         timestamptz(6) NOT NULL DEFAULT now(),
  method              varchar(32)    NOT NULL,
  ip_address          varchar(45),
  user_agent          varchar(512),
  accepted_by_user_id uuid,
  created_at          timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT legal_acceptances_pkey PRIMARY KEY (legal_acceptance_id),
  CONSTRAINT legal_acceptances_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (user_id),
  CONSTRAINT legal_acceptances_accepted_by_user_id_fkey FOREIGN KEY (accepted_by_user_id)
    REFERENCES users (user_id),
  CONSTRAINT legal_acceptances_document_type_ck CHECK (document_type IN ('terms', 'privacy')),
  CONSTRAINT legal_acceptances_method_ck CHECK (method IN ('register_checkbox', 'acceptance_gate')),
  CONSTRAINT legal_acceptances_document_version_ck CHECK (char_length(btrim(document_version)) BETWEEN 1 AND 32)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_acceptances_user_doc_version
  ON legal_acceptances (user_id, document_type, document_version);

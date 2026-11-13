-- Phase 4 (release at majority): per-person acceptance of the current terms by a
-- released adult. New legal_acceptances.method 'majority_release'.
-- The old unique key (user, document_type, document_version) becomes PARTIAL so
-- old methods keep their exact semantics while a person may hold an on-behalf
-- row (guardian) AND a majority_release row for the same version.
-- createMany skipDuplicates (ON CONFLICT DO NOTHING without target) keeps working.
-- Re-runnable; no DML. Partial unique indexes are SQL-only.

ALTER TABLE legal_acceptances DROP CONSTRAINT IF EXISTS legal_acceptances_method_ck;
ALTER TABLE legal_acceptances ADD CONSTRAINT legal_acceptances_method_ck
  CHECK (method IN ('register_checkbox', 'acceptance_gate', 'majority_release'));

DROP INDEX IF EXISTS uq_legal_acceptances_user_doc_version;
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_acceptances_user_doc_version
  ON legal_acceptances (user_id, document_type, document_version)
  WHERE method <> 'majority_release';

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_acceptances_release_user_doc_version
  ON legal_acceptances (user_id, document_type, document_version)
  WHERE method = 'majority_release';

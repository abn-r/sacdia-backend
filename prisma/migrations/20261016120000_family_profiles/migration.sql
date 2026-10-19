-- Migration: 20261016120000_family_profiles
-- Phase 2 family profiles. Guardianships supersede legal_representatives (kept read-only).
-- Additive except ONE statement: users.email becomes nullable (UNIQUE kept; Postgres allows many NULLs).
-- Render runs `prisma migrate deploy` at the END OF THE BUILD (no preDeploy); one transaction; re-runnable.
-- FKs use the default referential action (NO ACTION). Partial indexes are SQL-only (Prisma cannot express them).
-- Rollback (manual, per Neon branch): remove the new tables and columns with the standard
-- statements, applied by hand; there is no down migration.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

ALTER TABLE countries ADD COLUMN IF NOT EXISTS minor_self_login_min_age smallint NOT NULL DEFAULT 13
  CONSTRAINT countries_minor_self_login_min_age_ck CHECK (minor_self_login_min_age BETWEEN 0 AND 21);
ALTER TABLE countries ADD COLUMN IF NOT EXISTS age_of_majority smallint NOT NULL DEFAULT 18
  CONSTRAINT countries_age_of_majority_ck CHECK (age_of_majority BETWEEN 14 AND 21);
ALTER TABLE countries ADD COLUMN IF NOT EXISTS age_reference_timezone varchar(64);

CREATE TABLE IF NOT EXISTS dependent_profiles (
  user_id            uuid           NOT NULL,
  created_by_user_id uuid           NOT NULL,
  created_at         timestamptz(6) NOT NULL DEFAULT now(),
  frozen_at          timestamptz(6),
  purge_after        timestamptz(6),
  purged_at          timestamptz(6),
  CONSTRAINT dependent_profiles_pkey PRIMARY KEY (user_id),
  CONSTRAINT dependent_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (user_id),
  CONSTRAINT dependent_profiles_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users (user_id),
  CONSTRAINT dependent_profiles_frozen_ck CHECK ((frozen_at IS NULL) = (purge_after IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_dependent_profiles_purge
  ON dependent_profiles (purge_after) WHERE frozen_at IS NOT NULL AND purged_at IS NULL;

CREATE TABLE IF NOT EXISTS guardianships (
  guardianship_id            uuid           NOT NULL DEFAULT gen_random_uuid(),
  dependent_user_id          uuid           NOT NULL,
  guardian_user_id           uuid,
  is_custodian               boolean        NOT NULL DEFAULT false,
  custodian_club_id          integer,
  relationship_type_id       uuid,
  is_primary                 boolean        NOT NULL DEFAULT false,
  consent_status             varchar(16)    NOT NULL DEFAULT 'pending',
  sworn_declaration_at       timestamptz(6),
  invited_by_guardianship_id uuid,
  verified_by_user_id        uuid,
  verification_method        varchar(32),
  verified_at                timestamptz(6),
  revoked_at                 timestamptz(6),
  revoked_reason             varchar(32),
  external_name              varchar(150),
  external_phone             varchar(20),
  is_test_data               boolean        NOT NULL DEFAULT false,
  created_at                 timestamptz(6) NOT NULL DEFAULT now(),
  modified_at                timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT guardianships_pkey PRIMARY KEY (guardianship_id),
  CONSTRAINT guardianships_dependent_user_id_fkey FOREIGN KEY (dependent_user_id) REFERENCES users (user_id),
  CONSTRAINT guardianships_guardian_user_id_fkey FOREIGN KEY (guardian_user_id) REFERENCES users (user_id),
  CONSTRAINT guardianships_verified_by_user_id_fkey FOREIGN KEY (verified_by_user_id) REFERENCES users (user_id),
  CONSTRAINT guardianships_custodian_club_id_fkey FOREIGN KEY (custodian_club_id) REFERENCES clubs (club_id),
  CONSTRAINT guardianships_relationship_type_id_fkey FOREIGN KEY (relationship_type_id) REFERENCES relationship_types (relationship_type_id),
  CONSTRAINT guardianships_invited_by_guardianship_id_fkey FOREIGN KEY (invited_by_guardianship_id) REFERENCES guardianships (guardianship_id),
  CONSTRAINT guardianships_consent_status_ck CHECK (consent_status IN ('pending', 'verified', 'revoked')),
  CONSTRAINT guardianships_verification_method_ck CHECK (verification_method IS NULL OR verification_method IN ('director_paper_form', 'guardian_invite', 'legacy_import', 'test_placeholder')),
  CONSTRAINT guardianships_revoked_reason_ck CHECK (revoked_reason IS NULL OR revoked_reason IN ('guardian_left', 'removed_by_primary', 'guardian_account_closed', 'claimed', 'admin', 'released')),
  CONSTRAINT guardianships_holder_ck CHECK ((is_custodian AND guardian_user_id IS NULL AND custodian_club_id IS NOT NULL) OR (NOT is_custodian AND custodian_club_id IS NULL AND (guardian_user_id IS NOT NULL OR external_name IS NOT NULL))),
  CONSTRAINT guardianships_not_self_ck CHECK (guardian_user_id IS NULL OR guardian_user_id <> dependent_user_id),
  CONSTRAINT guardianships_revoked_ck CHECK ((consent_status = 'revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT guardianships_verified_ck CHECK (consent_status <> 'verified' OR verified_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_guardianships_active_pair ON guardianships (dependent_user_id, guardian_user_id) WHERE guardian_user_id IS NOT NULL AND consent_status <> 'revoked';
CREATE UNIQUE INDEX IF NOT EXISTS uq_guardianships_active_primary ON guardianships (dependent_user_id) WHERE is_primary AND consent_status <> 'revoked';
CREATE UNIQUE INDEX IF NOT EXISTS uq_guardianships_active_custodian ON guardianships (dependent_user_id) WHERE is_custodian AND consent_status <> 'revoked';
CREATE INDEX IF NOT EXISTS idx_guardianships_dependent ON guardianships (dependent_user_id);
CREATE INDEX IF NOT EXISTS idx_guardianships_guardian_active ON guardianships (guardian_user_id) WHERE consent_status <> 'revoked';
CREATE INDEX IF NOT EXISTS idx_guardianships_custodian_club ON guardianships (custodian_club_id) WHERE is_custodian AND consent_status <> 'revoked';

CREATE TABLE IF NOT EXISTS guardianship_consent_evidences (
  evidence_id         uuid           NOT NULL DEFAULT gen_random_uuid(),
  guardianship_id     uuid           NOT NULL,
  file_key            varchar(512)   NOT NULL,
  content_type        varchar(64)    NOT NULL,
  size_bytes          integer        NOT NULL,
  uploaded_by_user_id uuid           NOT NULL,
  uploaded_at         timestamptz(6) NOT NULL DEFAULT now(),
  superseded_at       timestamptz(6),
  purged_at           timestamptz(6),
  CONSTRAINT guardianship_consent_evidences_pkey PRIMARY KEY (evidence_id),
  CONSTRAINT guardianship_consent_evidences_guardianship_id_fkey FOREIGN KEY (guardianship_id) REFERENCES guardianships (guardianship_id),
  CONSTRAINT guardianship_consent_evidences_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES users (user_id),
  CONSTRAINT guardianship_consent_evidences_content_type_ck CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  CONSTRAINT guardianship_consent_evidences_size_ck CHECK (size_bytes BETWEEN 1 AND 10485760)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_guardianship_consent_evidences_current ON guardianship_consent_evidences (guardianship_id) WHERE superseded_at IS NULL AND purged_at IS NULL;

CREATE TABLE IF NOT EXISTS guardianship_link_codes (
  link_code_id               uuid           NOT NULL DEFAULT gen_random_uuid(),
  code_hash                  char(64)       NOT NULL,
  dependent_user_id          uuid           NOT NULL,
  purpose                    varchar(24)    NOT NULL,
  issued_by_user_id          uuid           NOT NULL,
  issued_for_club_section_id integer,
  expires_at                 timestamptz(6) NOT NULL,
  consumed_at                timestamptz(6),
  consumed_by_user_id        uuid,
  revoked_at                 timestamptz(6),
  created_at                 timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT guardianship_link_codes_pkey PRIMARY KEY (link_code_id),
  CONSTRAINT guardianship_link_codes_code_hash_key UNIQUE (code_hash),
  CONSTRAINT guardianship_link_codes_dependent_user_id_fkey FOREIGN KEY (dependent_user_id) REFERENCES users (user_id),
  CONSTRAINT guardianship_link_codes_issued_by_user_id_fkey FOREIGN KEY (issued_by_user_id) REFERENCES users (user_id),
  CONSTRAINT guardianship_link_codes_consumed_by_user_id_fkey FOREIGN KEY (consumed_by_user_id) REFERENCES users (user_id),
  CONSTRAINT guardianship_link_codes_issued_for_club_section_id_fkey FOREIGN KEY (issued_for_club_section_id) REFERENCES club_sections (club_section_id),
  CONSTRAINT guardianship_link_codes_purpose_ck CHECK (purpose IN ('second_guardian', 'director_claim')),
  CONSTRAINT guardianship_link_codes_consumed_ck CHECK ((consumed_at IS NULL) = (consumed_by_user_id IS NULL)),
  CONSTRAINT guardianship_link_codes_section_ck CHECK ((purpose = 'director_claim') = (issued_for_club_section_id IS NOT NULL)),
  CONSTRAINT guardianship_link_codes_expiry_ck CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS idx_guardianship_link_codes_dependent_open ON guardianship_link_codes (dependent_user_id, purpose) WHERE consumed_at IS NULL AND revoked_at IS NULL;

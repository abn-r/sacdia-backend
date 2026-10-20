-- Migration: 20261020120000_family_teen_login
-- Phase 3a: own login for 13-17 (supervised) + teen-issued guardian link codes.
-- Additive except TWO constraint swaps (drop + add of a CHECK), both WIDENED, never narrowed:
--   guardianship_link_codes_purpose_ck  gains 'teen_guardian_link'
--   guardianships_revoked_reason_ck     gains 'removed_by_dependent' (a teen revokes a pending link they initiated)
-- Render runs `prisma migrate deploy` at the END OF THE BUILD (no preDeploy); one transaction; re-runnable.
-- FKs use the default referential action (NO ACTION). Partial/expression indexes are SQL-only (Prisma cannot express them).
-- No DML: existing teens are covered by derivation (pending-guardian mode) and by the dev-only backfill script.
-- Rollback (manual, per Neon branch): the table and indexes can be dropped by hand; the widened CHECKs may stay.
CREATE TABLE IF NOT EXISTS supervised_logins (
  user_id                    uuid           NOT NULL,
  method                     varchar(8)     NOT NULL,
  login_handle               varchar(40),
  origin                     varchar(16)    NOT NULL,
  enabled_by_guardianship_id uuid,
  enabled_by_user_id         uuid,
  enabled_at                 timestamptz(6),
  password_set_by            varchar(8)     NOT NULL,
  pending_since              timestamptz(6),
  pending_reminder_level     smallint       NOT NULL DEFAULT 0,
  disabled_at                timestamptz(6),
  disabled_by_user_id        uuid,
  disabled_reason            varchar(24),
  created_at                 timestamptz(6) NOT NULL DEFAULT now(),
  modified_at                timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT supervised_logins_pkey PRIMARY KEY (user_id),
  CONSTRAINT supervised_logins_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (user_id),
  CONSTRAINT supervised_logins_enabled_by_guardianship_id_fkey FOREIGN KEY (enabled_by_guardianship_id) REFERENCES guardianships (guardianship_id),
  CONSTRAINT supervised_logins_enabled_by_user_id_fkey FOREIGN KEY (enabled_by_user_id) REFERENCES users (user_id),
  CONSTRAINT supervised_logins_disabled_by_user_id_fkey FOREIGN KEY (disabled_by_user_id) REFERENCES users (user_id),
  CONSTRAINT supervised_logins_method_ck CHECK (method IN ('email', 'handle')),
  CONSTRAINT supervised_logins_origin_ck CHECK (origin IN ('self_registered', 'guardian_enabled')),
  CONSTRAINT supervised_logins_password_set_by_ck CHECK (password_set_by IN ('guardian', 'self')),
  CONSTRAINT supervised_logins_handle_ck CHECK ((method = 'handle') = (login_handle IS NOT NULL)),
  CONSTRAINT supervised_logins_handle_format_ck CHECK (login_handle IS NULL OR login_handle ~ '^[a-z0-9][a-z0-9-]{5,39}$'),
  CONSTRAINT supervised_logins_guardian_enabled_ck CHECK (origin <> 'guardian_enabled' OR (enabled_by_guardianship_id IS NOT NULL AND enabled_by_user_id IS NOT NULL AND enabled_at IS NOT NULL)),
  CONSTRAINT supervised_logins_reminder_ck CHECK (pending_reminder_level BETWEEN 0 AND 3),
  CONSTRAINT supervised_logins_disabled_ck CHECK ((disabled_at IS NULL) = (disabled_reason IS NULL)),
  CONSTRAINT supervised_logins_disabled_reason_ck CHECK (disabled_reason IS NULL OR disabled_reason IN ('guardian', 'admin', 'unlinked_purged'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supervised_logins_handle ON supervised_logins (lower(login_handle)) WHERE login_handle IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supervised_logins_pending ON supervised_logins (pending_since) WHERE pending_since IS NOT NULL AND disabled_at IS NULL;

ALTER TABLE guardianship_link_codes DROP CONSTRAINT IF EXISTS guardianship_link_codes_purpose_ck;
ALTER TABLE guardianship_link_codes ADD CONSTRAINT guardianship_link_codes_purpose_ck
  CHECK (purpose IN ('second_guardian', 'director_claim', 'teen_guardian_link'));

ALTER TABLE guardianships DROP CONSTRAINT IF EXISTS guardianships_revoked_reason_ck;
ALTER TABLE guardianships ADD CONSTRAINT guardianships_revoked_reason_ck
  CHECK (revoked_reason IS NULL OR revoked_reason IN ('guardian_left', 'removed_by_primary', 'guardian_account_closed', 'claimed', 'admin', 'released', 'removed_by_dependent'));

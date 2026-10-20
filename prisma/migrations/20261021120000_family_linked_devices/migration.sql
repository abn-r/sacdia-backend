-- Migration: 20261021120000_family_linked_devices
-- Phase 3b: paired phones of under-13 children (QR pairing, device audience).
-- session_id has NO foreign key on purpose (ADR-4): sessions rows are hard-deleted by logout, password
-- change and every revoke path, and NO ACTION would break them. `sessions` itself is NOT altered.
-- Additive except ONE constraint swap (drop + add of a CHECK), WIDENED, never narrowed, bundled here
-- from the 3a verify (W5):
--   supervised_logins_disabled_reason_ck gains 'age_majority' (a login disabled at the age of majority).
-- Render runs `prisma migrate deploy` at the END OF THE BUILD (no preDeploy); one transaction; re-runnable.
-- FKs use the default referential action (NO ACTION). Partial indexes are SQL-only (Prisma cannot express them).
-- No DML. Rollback (manual, per Neon branch): the two tables and their indexes can be dropped by hand;
-- the widened CHECK may stay.
CREATE TABLE IF NOT EXISTS linked_devices (
  linked_device_id    uuid           NOT NULL DEFAULT gen_random_uuid(),
  dependent_user_id   uuid           NOT NULL,
  guardianship_id     uuid           NOT NULL,
  paired_by_user_id   uuid           NOT NULL,
  session_id          text           NOT NULL,
  label               varchar(60)    NOT NULL,
  platform            varchar(16)    NOT NULL,
  app_version         varchar(32),
  fcm_token_id        uuid,
  paired_at           timestamptz(6) NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz(6) NOT NULL,
  last_seen_at        timestamptz(6),
  revoked_at          timestamptz(6),
  revoked_by_user_id  uuid,
  revoked_reason      varchar(32),
  CONSTRAINT linked_devices_pkey PRIMARY KEY (linked_device_id),
  CONSTRAINT linked_devices_dependent_user_id_fkey FOREIGN KEY (dependent_user_id) REFERENCES users (user_id),
  CONSTRAINT linked_devices_guardianship_id_fkey FOREIGN KEY (guardianship_id) REFERENCES guardianships (guardianship_id),
  CONSTRAINT linked_devices_paired_by_user_id_fkey FOREIGN KEY (paired_by_user_id) REFERENCES users (user_id),
  CONSTRAINT linked_devices_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES users (user_id),
  CONSTRAINT linked_devices_platform_ck CHECK (platform IN ('ios', 'android')),
  CONSTRAINT linked_devices_expiry_ck CHECK (absolute_expires_at > paired_at),
  CONSTRAINT linked_devices_revoked_ck CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT linked_devices_revoked_reason_ck CHECK (revoked_reason IS NULL OR revoked_reason IN ('guardian', 'guardianship_revoked', 'guardian_account_closed', 'teen_login_enabled', 'majority', 'dependent_frozen', 'device_logout', 'session_revoked', 'admin', 'expired'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_linked_devices_session ON linked_devices (session_id);
CREATE INDEX IF NOT EXISTS idx_linked_devices_dependent_active ON linked_devices (dependent_user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_linked_devices_guardianship_active ON linked_devices (guardianship_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS device_pairing_tokens (
  pairing_token_id   uuid           NOT NULL DEFAULT gen_random_uuid(),
  token_hash         char(64)       NOT NULL,
  dependent_user_id  uuid           NOT NULL,
  guardianship_id    uuid           NOT NULL,
  created_by_user_id uuid           NOT NULL,
  expires_at         timestamptz(6) NOT NULL,
  consumed_at        timestamptz(6),
  consumed_device_id uuid,
  revoked_at         timestamptz(6),
  created_at         timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT device_pairing_tokens_pkey PRIMARY KEY (pairing_token_id),
  CONSTRAINT device_pairing_tokens_token_hash_key UNIQUE (token_hash),
  CONSTRAINT device_pairing_tokens_dependent_user_id_fkey FOREIGN KEY (dependent_user_id) REFERENCES users (user_id),
  CONSTRAINT device_pairing_tokens_guardianship_id_fkey FOREIGN KEY (guardianship_id) REFERENCES guardianships (guardianship_id),
  CONSTRAINT device_pairing_tokens_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users (user_id),
  CONSTRAINT device_pairing_tokens_consumed_device_id_fkey FOREIGN KEY (consumed_device_id) REFERENCES linked_devices (linked_device_id),
  CONSTRAINT device_pairing_tokens_consumed_ck CHECK ((consumed_at IS NULL) = (consumed_device_id IS NULL)),
  CONSTRAINT device_pairing_tokens_expiry_ck CHECK (expires_at > created_at AND expires_at <= created_at + interval '15 minutes')
);
CREATE INDEX IF NOT EXISTS idx_device_pairing_tokens_open ON device_pairing_tokens (dependent_user_id) WHERE consumed_at IS NULL AND revoked_at IS NULL;

ALTER TABLE supervised_logins DROP CONSTRAINT IF EXISTS supervised_logins_disabled_reason_ck;
ALTER TABLE supervised_logins ADD CONSTRAINT supervised_logins_disabled_reason_ck CHECK (disabled_reason IS NULL OR disabled_reason IN ('guardian','admin','unlinked_purged','age_majority'));

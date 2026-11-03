-- FCM is moving from registration tokens to Firebase Installation IDs (FIDs).
-- user_fcm_tokens.token keeps holding the value (its unique constraint stays:
-- a registration token and a FID never collide); `kind` says which one it is
-- so the send path can split a batch into `tokens` and `fids`.
--
-- Every existing row is a registration token, so the DEFAULT 'token' is the
-- backfill. Additive: old app versions keep registering plain tokens.
--
-- Idempotent: IF NOT EXISTS / DROP CONSTRAINT IF EXISTS make a re-run a no-op.

ALTER TABLE user_fcm_tokens
  ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'token';

ALTER TABLE user_fcm_tokens
  DROP CONSTRAINT IF EXISTS user_fcm_tokens_kind_ck,
  ADD CONSTRAINT user_fcm_tokens_kind_ck
    CHECK (kind IN ('token', 'fid'));

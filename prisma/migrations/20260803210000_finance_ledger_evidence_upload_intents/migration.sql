BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS "club_sections_club_section_id_main_club_id_key"
  ON "club_sections" ("club_section_id", "main_club_id");
CREATE TYPE "finance_ledger_evidence_upload_intent_status" AS ENUM (
  'issued', 'verifying', 'completed', 'revoked', 'expired'
);
CREATE TABLE "finance_ledger_evidence_upload_intents" (
  "finance_ledger_evidence_upload_intent_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actor_user_id" UUID NOT NULL,
  "club_id" INTEGER NOT NULL,
  "club_section_id" INTEGER NOT NULL,
  "idempotency_key" UUID NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "namespace" VARCHAR(32) NOT NULL DEFAULT 'finance-ledger',
  "storage_key" VARCHAR(500) GENERATED ALWAYS AS ('finance-ledger/' || "club_id"::TEXT || '/' || "club_section_id"::TEXT || '/' || "finance_ledger_evidence_upload_intent_id"::TEXT) STORED,
  "expected_mime_type" VARCHAR(100) NOT NULL,
  "expected_file_size" INTEGER NOT NULL,
  "status" "finance_ledger_evidence_upload_intent_status" NOT NULL DEFAULT 'issued',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "verification_token" UUID,
  "verification_expires_at" TIMESTAMPTZ(6),
  "finance_ledger_evidence_id" UUID,
  "completed_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_ledger_evidence_upload_intents_pkey" PRIMARY KEY ("finance_ledger_evidence_upload_intent_id"),
  CONSTRAINT "finance_ledger_evidence_upload_intents_storage_key_key" UNIQUE ("storage_key"),
  CONSTRAINT "finance_ledger_evidence_upload_intents_evidence_id_key" UNIQUE ("finance_ledger_evidence_id"),
  CONSTRAINT "finance_ledger_evidence_upload_intents_actor_idempotency_key" UNIQUE ("actor_user_id", "idempotency_key"),
  CONSTRAINT "finance_ledger_evidence_upload_intents_scope_fkey" FOREIGN KEY ("club_section_id", "club_id") REFERENCES "club_sections"("club_section_id", "main_club_id") ON DELETE RESTRICT,
  CONSTRAINT "finance_ledger_evidence_upload_intents_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT,
  CONSTRAINT "finance_ledger_evidence_upload_intents_evidence_fkey" FOREIGN KEY ("finance_ledger_evidence_id") REFERENCES "finance_ledger_evidence"("finance_ledger_evidence_id") ON DELETE RESTRICT,
  CONSTRAINT "finance_ledger_evidence_upload_intents_namespace_check" CHECK ("namespace" = 'finance-ledger'),
  CONSTRAINT "finance_ledger_evidence_upload_intents_storage_key_check" CHECK ("storage_key" ~ '^finance-ledger/[A-Za-z0-9._/-]+$'),
  CONSTRAINT "finance_ledger_evidence_upload_intents_request_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "finance_ledger_evidence_upload_intents_mime_check" CHECK ("expected_mime_type" IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT "finance_ledger_evidence_upload_intents_size_check" CHECK ("expected_file_size" BETWEEN 1 AND 5242880),
  CONSTRAINT "finance_ledger_evidence_upload_intents_time_check" CHECK (
    "expires_at" > "created_at"
    AND "expires_at" <= "created_at" + interval '15 minutes'
    AND ("verification_expires_at" IS NULL OR "verification_expires_at" BETWEEN "created_at" AND "expires_at")
    AND ("completed_at" IS NULL OR "completed_at" BETWEEN "created_at" AND "expires_at")
    AND ("revoked_at" IS NULL OR "revoked_at" BETWEEN "created_at" AND "expires_at")
  ),
  CONSTRAINT "finance_ledger_evidence_upload_intents_lifecycle_check" CHECK (
    ("status" = 'issued' AND "verification_token" IS NULL AND "verification_expires_at" IS NULL AND "finance_ledger_evidence_id" IS NULL AND "completed_at" IS NULL AND "revoked_at" IS NULL) OR
    ("status" = 'verifying' AND "verification_token" IS NOT NULL AND "verification_expires_at" IS NOT NULL AND "finance_ledger_evidence_id" IS NULL AND "completed_at" IS NULL AND "revoked_at" IS NULL) OR
    ("status" = 'completed' AND "verification_token" IS NOT NULL AND "verification_expires_at" IS NOT NULL AND "finance_ledger_evidence_id" IS NOT NULL AND "completed_at" IS NOT NULL AND "revoked_at" IS NULL) OR
    ("status" = 'revoked' AND "verification_token" IS NULL AND "verification_expires_at" IS NULL AND "finance_ledger_evidence_id" IS NULL AND "completed_at" IS NULL AND "revoked_at" IS NOT NULL) OR
    ("status" = 'expired' AND "verification_token" IS NULL AND "verification_expires_at" IS NULL AND "finance_ledger_evidence_id" IS NULL AND "completed_at" IS NULL AND "revoked_at" IS NULL)
  )
);
CREATE INDEX "finance_ledger_evidence_upload_intents_actor_status_expiry_idx" ON "finance_ledger_evidence_upload_intents" ("actor_user_id", "status", "expires_at");
CREATE INDEX "finance_ledger_evidence_upload_intents_scope_status_expiry_idx" ON "finance_ledger_evidence_upload_intents" ("club_id", "club_section_id", "status", "expires_at");
CREATE FUNCTION "guard_finance_ledger_evidence_upload_intent"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'issued' OR NEW.expires_at <= CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION 'finance upload intent must be issued and unexpired' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.finance_ledger_evidence_upload_intent_id, NEW.actor_user_id, NEW.club_id,
      NEW.club_section_id, NEW.idempotency_key, NEW.request_hash, NEW.namespace,
      NEW.expected_mime_type, NEW.expected_file_size, NEW.expires_at, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.finance_ledger_evidence_upload_intent_id, OLD.actor_user_id,
      OLD.club_id, OLD.club_section_id, OLD.idempotency_key, OLD.request_hash,
      OLD.namespace, OLD.expected_mime_type, OLD.expected_file_size, OLD.expires_at,
      OLD.created_at)
    OR (OLD.status = 'completed' AND (NEW.verification_token IS DISTINCT FROM OLD.verification_token
      OR NEW.verification_expires_at IS DISTINCT FROM OLD.verification_expires_at
      OR NEW.finance_ledger_evidence_id IS DISTINCT FROM OLD.finance_ledger_evidence_id
      OR NEW.completed_at IS DISTINCT FROM OLD.completed_at))
    OR (OLD.status = 'revoked' AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'finance upload intent ownership and issuance are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.status = 'completed' AND NEW.status <> 'completed')
    OR (OLD.status IN ('revoked', 'expired') AND NEW.status <> OLD.status)
    OR (OLD.status = 'issued' AND NEW.status NOT IN ('issued', 'verifying', 'revoked', 'expired'))
    OR (OLD.status = 'verifying' AND NEW.status NOT IN ('verifying', 'completed', 'revoked', 'expired')) THEN
    RAISE EXCEPTION 'invalid finance upload intent lifecycle transition' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'verifying' AND (
    NEW.verification_expires_at <= CURRENT_TIMESTAMP
    OR NEW.verification_expires_at > NEW.expires_at
    OR (OLD.status = 'verifying' AND OLD.verification_expires_at > CURRENT_TIMESTAMP
      AND (NEW.verification_token IS DISTINCT FROM OLD.verification_token
        OR NEW.verification_expires_at IS DISTINCT FROM OLD.verification_expires_at))
  ) THEN
    RAISE EXCEPTION 'invalid finance upload verification lease' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'completed' AND (
    OLD.status <> 'verifying'
    OR OLD.verification_expires_at <= CURRENT_TIMESTAMP
    OR NEW.expires_at <= CURRENT_TIMESTAMP
    OR NEW.verification_token IS DISTINCT FROM OLD.verification_token
    OR NEW.verification_expires_at IS DISTINCT FROM OLD.verification_expires_at
  ) THEN
    RAISE EXCEPTION 'finance upload intent cannot complete without an active lease' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
    IF NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'finance upload completion timestamp is server-owned' USING ERRCODE = 'check_violation';
    END IF;
    NEW.completed_at := CURRENT_TIMESTAMP;
  END IF;
  IF NEW.status = 'revoked' AND OLD.status <> 'revoked' THEN
    IF NEW.revoked_at IS NOT NULL OR NEW.expires_at <= CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION 'invalid finance upload revocation timestamp' USING ERRCODE = 'check_violation';
    END IF;
    NEW.revoked_at := CURRENT_TIMESTAMP;
  END IF;
  IF NEW.status = 'expired' AND NEW.expires_at > CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'finance upload intent cannot expire before expiry' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "finance_ledger_evidence_upload_intents_guard"
  BEFORE INSERT OR UPDATE ON "finance_ledger_evidence_upload_intents"
  FOR EACH ROW EXECUTE FUNCTION "guard_finance_ledger_evidence_upload_intent"();
COMMIT;

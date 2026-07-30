BEGIN;
CREATE TYPE "finance_ledger_entry_kind" AS ENUM ('income', 'expense', 'payable');
CREATE TYPE "finance_ledger_entry_status" AS ENUM ('pending_approval', 'approved', 'rejected');
CREATE TABLE "finance_currencies" (
  "currency_code" CHAR(3) NOT NULL,
  "numeric_code" CHAR(3) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "minor_units" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "finance_currencies_pkey" PRIMARY KEY ("currency_code"),
  CONSTRAINT "finance_currencies_numeric_code_key" UNIQUE ("numeric_code"),
  CONSTRAINT "finance_currencies_code_check" CHECK ("currency_code" ~ '^[A-Z]{3}$' AND "numeric_code" ~ '^[0-9]{3}$'),
  CONSTRAINT "finance_currencies_minor_units_check" CHECK ("minor_units" BETWEEN 0 AND 4)
);
INSERT INTO "finance_currencies" ("currency_code", "numeric_code", "name", "minor_units")
VALUES ('MXN', '484', 'Mexican Peso', 2);
CREATE TABLE "finance_ledger_entries" (
  "finance_ledger_entry_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "legacy_finance_id" INTEGER,
  "club_section_id" INTEGER NOT NULL,
  "finance_category_id" INTEGER NOT NULL,
  "kind" "finance_ledger_entry_kind" NOT NULL,
  "amount_centavos" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "finance_date" DATE NOT NULL,
  "status" "finance_ledger_entry_status" NOT NULL DEFAULT 'pending_approval',
  "registered_by_id" UUID NOT NULL,
  "decided_by_id" UUID,
  "decided_at" TIMESTAMPTZ(6),
  "rejection_reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_ledger_entries_pkey" PRIMARY KEY ("finance_ledger_entry_id"),
  CONSTRAINT "finance_ledger_entries_legacy_finance_id_key" UNIQUE ("legacy_finance_id"),
  CONSTRAINT "finance_ledger_entries_amount_centavos_check" CHECK ("amount_centavos" > 0),
  CONSTRAINT "finance_ledger_entries_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "finance_ledger_entries_lifecycle_check" CHECK (
    ("status" = 'pending_approval' AND "decided_at" IS NULL AND "decided_by_id" IS NULL AND "rejection_reason" IS NULL)
    OR ("status" = 'approved' AND "decided_at" IS NOT NULL AND ("decided_by_id" IS NOT NULL OR "legacy_finance_id" IS NOT NULL) AND "rejection_reason" IS NULL)
    OR ("status" = 'rejected' AND "decided_at" IS NOT NULL AND "decided_by_id" IS NOT NULL AND NULLIF(BTRIM("rejection_reason"), '') IS NOT NULL)
  )
);
CREATE TABLE "finance_vouchers" (
  "finance_voucher_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ledger_entry_id" UUID NOT NULL,
  "amount_centavos" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "source_uri" VARCHAR(500) NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "file_size" INTEGER,
  "issuer" VARCHAR(255),
  "source_metadata" JSONB,
  "recorded_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_vouchers_pkey" PRIMARY KEY ("finance_voucher_id"),
  CONSTRAINT "finance_vouchers_amount_centavos_check" CHECK ("amount_centavos" > 0),
  CONSTRAINT "finance_vouchers_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "finance_vouchers_file_size_check" CHECK ("file_size" IS NULL OR "file_size" >= 0)
);
CREATE TABLE "finance_receipt_allocations" (
  "finance_receipt_allocation_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "finance_voucher_id" UUID NOT NULL,
  "obligation_entry_id" UUID NOT NULL,
  "amount_centavos" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_receipt_allocations_pkey" PRIMARY KEY ("finance_receipt_allocation_id"),
  CONSTRAINT "finance_receipt_allocations_voucher_obligation_key" UNIQUE ("finance_voucher_id", "obligation_entry_id"),
  CONSTRAINT "finance_receipt_allocations_amount_centavos_check" CHECK ("amount_centavos" > 0)
);
CREATE TABLE "finance_ledger_events" (
  "finance_ledger_event_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "finance_ledger_entry_id" UUID,
  "finance_voucher_id" UUID,
  "finance_receipt_allocation_id" UUID,
  "event_type" VARCHAR(64) NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_ledger_events_pkey" PRIMARY KEY ("finance_ledger_event_id"),
  CONSTRAINT "finance_ledger_events_target_check" CHECK (num_nonnulls("finance_ledger_entry_id", "finance_voucher_id", "finance_receipt_allocation_id") = 1)
);
CREATE TABLE "finance_idempotency_receipts" (
  "finance_idempotency_receipt_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actor_user_id" UUID NOT NULL,
  "idempotency_key" UUID NOT NULL,
  "command" VARCHAR(64) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "response" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_idempotency_receipts_pkey" PRIMARY KEY ("finance_idempotency_receipt_id"),
  CONSTRAINT "finance_idempotency_receipts_actor_key" UNIQUE ("actor_user_id", "idempotency_key"),
  CONSTRAINT "finance_idempotency_receipts_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$')
);
ALTER TABLE "finance_ledger_entries"
  ADD CONSTRAINT "finance_ledger_entries_legacy_finance_id_fkey" FOREIGN KEY ("legacy_finance_id") REFERENCES "finances"("finance_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "finance_ledger_entries_club_section_id_fkey" FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "finance_ledger_entries_category_id_fkey" FOREIGN KEY ("finance_category_id") REFERENCES "finances_categories"("finance_category_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "finance_ledger_entries_currency_fkey" FOREIGN KEY ("currency") REFERENCES "finance_currencies"("currency_code") ON DELETE RESTRICT,
  ADD CONSTRAINT "finance_ledger_entries_registered_by_id_fkey" FOREIGN KEY ("registered_by_id") REFERENCES "users"("user_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "finance_ledger_entries_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("user_id") ON DELETE RESTRICT;
ALTER TABLE "finance_vouchers"
  ADD CONSTRAINT "finance_vouchers_ledger_entry_id_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "finance_ledger_entries"("finance_ledger_entry_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "finance_vouchers_currency_fkey" FOREIGN KEY ("currency") REFERENCES "finance_currencies"("currency_code") ON DELETE RESTRICT,
  ADD CONSTRAINT "finance_vouchers_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("user_id") ON DELETE RESTRICT;
ALTER TABLE "finance_receipt_allocations"
  ADD CONSTRAINT "finance_receipt_allocations_voucher_id_fkey" FOREIGN KEY ("finance_voucher_id") REFERENCES "finance_vouchers"("finance_voucher_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "finance_receipt_allocations_obligation_id_fkey" FOREIGN KEY ("obligation_entry_id") REFERENCES "finance_ledger_entries"("finance_ledger_entry_id") ON DELETE RESTRICT;
ALTER TABLE "finance_ledger_events"
  ADD CONSTRAINT "finance_ledger_events_entry_id_fkey" FOREIGN KEY ("finance_ledger_entry_id") REFERENCES "finance_ledger_entries"("finance_ledger_entry_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "finance_ledger_events_voucher_id_fkey" FOREIGN KEY ("finance_voucher_id") REFERENCES "finance_vouchers"("finance_voucher_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "finance_ledger_events_allocation_id_fkey" FOREIGN KEY ("finance_receipt_allocation_id") REFERENCES "finance_receipt_allocations"("finance_receipt_allocation_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "finance_ledger_events_actor_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT;
ALTER TABLE "finance_idempotency_receipts"
  ADD CONSTRAINT "finance_idempotency_receipts_actor_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT;
CREATE FUNCTION "prevent_finance_ledger_event_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'finance ledger events are append-only'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "finance_ledger_events_prevent_mutation"
  BEFORE UPDATE OR DELETE ON "finance_ledger_events"
  FOR EACH ROW
  EXECUTE FUNCTION "prevent_finance_ledger_event_mutation"();
CREATE INDEX "finance_ledger_entries_section_status_date_idx" ON "finance_ledger_entries" ("club_section_id", "status", "finance_date");
CREATE INDEX "finance_ledger_entries_section_kind_status_idx" ON "finance_ledger_entries" ("club_section_id", "kind", "status");
CREATE INDEX "finance_vouchers_ledger_entry_idx" ON "finance_vouchers" ("ledger_entry_id");
CREATE INDEX "finance_receipt_allocations_obligation_idx" ON "finance_receipt_allocations" ("obligation_entry_id");
CREATE INDEX "finance_ledger_events_entry_created_idx" ON "finance_ledger_events" ("finance_ledger_entry_id", "created_at");
CREATE INDEX "finance_ledger_events_voucher_created_idx" ON "finance_ledger_events" ("finance_voucher_id", "created_at");
COMMIT;

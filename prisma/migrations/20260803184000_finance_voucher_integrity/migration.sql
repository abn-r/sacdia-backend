BEGIN;

CREATE TABLE "finance_ledger_evidence" (
  "finance_ledger_evidence_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "club_section_id" INTEGER NOT NULL,
  "storage_key" VARCHAR(500) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "file_size" INTEGER NOT NULL,
  "content_sha256" CHAR(64) NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_ledger_evidence_pkey" PRIMARY KEY ("finance_ledger_evidence_id"),
  CONSTRAINT "finance_ledger_evidence_storage_key_key" UNIQUE ("storage_key"),
  CONSTRAINT "finance_ledger_evidence_content_sha256_key" UNIQUE ("content_sha256"),
  CONSTRAINT "finance_ledger_evidence_storage_key_check" CHECK ("storage_key" ~ '^finance-ledger/[A-Za-z0-9._/-]+$'),
  CONSTRAINT "finance_ledger_evidence_mime_type_check" CHECK (BTRIM("mime_type") <> ''),
  CONSTRAINT "finance_ledger_evidence_file_size_check" CHECK ("file_size" >= 0),
  CONSTRAINT "finance_ledger_evidence_content_sha256_check" CHECK ("content_sha256" ~ '^[0-9a-f]{64}$')
);

ALTER TABLE "finance_vouchers"
  ADD COLUMN "finance_ledger_evidence_id" UUID,
  ADD CONSTRAINT "finance_vouchers_evidence_id_key" UNIQUE ("finance_ledger_evidence_id"),
  ADD CONSTRAINT "finance_vouchers_evidence_id_fkey" FOREIGN KEY ("finance_ledger_evidence_id") REFERENCES "finance_ledger_evidence"("finance_ledger_evidence_id") ON DELETE RESTRICT;

ALTER TABLE "finance_ledger_evidence"
  ADD CONSTRAINT "finance_ledger_evidence_club_section_id_fkey" FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "finance_ledger_evidence_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("user_id") ON DELETE RESTRICT;

CREATE FUNCTION "validate_finance_voucher_against_entry"()
RETURNS trigger AS $$
DECLARE
  entry_amount INTEGER;
  entry_currency CHAR(3);
  entry_status "finance_ledger_entry_status";
BEGIN
  SELECT "amount_centavos", "currency", "status"
    INTO entry_amount, entry_currency, entry_status
    FROM "finance_ledger_entries"
    WHERE "finance_ledger_entry_id" = NEW."ledger_entry_id"
    FOR KEY SHARE;
  IF entry_status IS DISTINCT FROM 'approved'
    OR NEW."amount_centavos" <> entry_amount
    OR NEW."currency" <> entry_currency THEN
    RAISE EXCEPTION 'finance voucher must exactly evidence an approved ledger entry'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "finance_vouchers_validate_entry"
  BEFORE INSERT OR UPDATE OF "ledger_entry_id", "amount_centavos", "currency"
  ON "finance_vouchers"
  FOR EACH ROW EXECUTE FUNCTION "validate_finance_voucher_against_entry"();

COMMIT;

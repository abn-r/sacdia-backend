-- GAP-W2-03: Add missing audit trail field modified_by_id to finances table
-- The finances table had created_by but lacked modified_by_id, breaking
-- the audit trail pattern used by other modules (e.g. member_insurances).
--
-- Adds a nullable UUID FK column pointing to users.user_id.
-- Guarded by IF NOT EXISTS so the migration is idempotent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'finances'
      AND column_name  = 'modified_by_id'
  ) THEN
    ALTER TABLE "finances"
      ADD COLUMN "modified_by_id" UUID;

    ALTER TABLE "finances"
      ADD CONSTRAINT "finances_modified_by_id_fkey"
      FOREIGN KEY ("modified_by_id")
      REFERENCES "users"("user_id")
      ON DELETE NO ACTION
      ON UPDATE NO ACTION;
  END IF;
END;
$$;

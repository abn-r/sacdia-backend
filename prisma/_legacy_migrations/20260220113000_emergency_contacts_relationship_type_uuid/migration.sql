-- Migrate emergency contacts relationship type from legacy int catalog to UUID catalog
ALTER TABLE "emergency_contacts"
  DROP CONSTRAINT IF EXISTS "emergency_contacts_relationship_type_fkey";

ALTER TABLE "emergency_contacts"
  ADD COLUMN "relationship_type_id" UUID;

DO $$
BEGIN
  IF to_regclass('public.relationship_type') IS NOT NULL THEN
    UPDATE "emergency_contacts" ec
    SET "relationship_type_id" = rt_new."relationship_type_id"
    FROM "relationship_type" rt_old
    JOIN "relationship_types" rt_new
      ON lower(trim(coalesce(rt_old."name", ''))) = lower(trim(coalesce(rt_new."name", '')))
    WHERE ec."relationship_type" = rt_old."relationship_type_id"
      AND ec."relationship_type_id" IS NULL;
  END IF;
END $$;

DO $$
DECLARE
  unmapped_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO unmapped_count
  FROM "emergency_contacts"
  WHERE "relationship_type_id" IS NULL;

  IF unmapped_count > 0 THEN
    RAISE EXCEPTION
      'Cannot migrate emergency_contacts.relationship_type -> relationship_type_id. % row(s) unmapped.',
      unmapped_count;
  END IF;
END $$;

ALTER TABLE "emergency_contacts"
  ALTER COLUMN "relationship_type_id" SET NOT NULL;

ALTER TABLE "emergency_contacts"
  ADD CONSTRAINT "emergency_contacts_relationship_type_id_fkey"
  FOREIGN KEY ("relationship_type_id")
  REFERENCES "relationship_types"("relationship_type_id")
  ON DELETE NO ACTION
  ON UPDATE NO ACTION;

ALTER TABLE "emergency_contacts"
  DROP COLUMN "relationship_type";

CREATE INDEX IF NOT EXISTS "idx_emergency_contacts_relationship_type_id"
  ON "emergency_contacts"("relationship_type_id");

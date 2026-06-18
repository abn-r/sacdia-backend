-- Inventory item photo evidence files (1-3 active images per item enforced in service).
CREATE TABLE IF NOT EXISTS "inventory_evidence_files" (
  "inventory_evidence_file_id" SERIAL PRIMARY KEY,
  "inventory_id" INTEGER NOT NULL,
  "file_url" VARCHAR(500) NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "file_type" VARCHAR(50) NOT NULL,
  "file_size" INTEGER,
  "uploaded_by_id" UUID NOT NULL,
  "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT "inventory_evidence_files_inventory_id_fkey"
    FOREIGN KEY ("inventory_id")
    REFERENCES "club_inventory"("club_inventory_id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "inventory_evidence_files_uploaded_by_id_fkey"
    FOREIGN KEY ("uploaded_by_id")
    REFERENCES "users"("user_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_inventory_evidence_files_inventory"
  ON "inventory_evidence_files"("inventory_id");

CREATE INDEX IF NOT EXISTS "idx_inventory_evidence_files_uploaded_by"
  ON "inventory_evidence_files"("uploaded_by_id");

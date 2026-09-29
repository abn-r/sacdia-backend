-- Optimistic revision for certificate import drafts.
-- Existing rows start at 0. A stale client must send the revision it read.

ALTER TABLE certificate_bulk_import_batches
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;

ALTER TABLE certificate_bulk_import_items
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;

-- Migration: add_missing_indexes_and_cascades
--
-- Adds indexes on FK columns that are frequently queried but were missing
-- index coverage, and aligns the Prisma schema onDelete declarations for
-- club_inventory and finances with the ON DELETE SET NULL behavior that was
-- already present on those FK constraints in the database since the baseline.
--
-- All CREATE INDEX statements use IF NOT EXISTS to make this migration
-- idempotent and safe to re-run.

-- ============================================================
-- club_inventory: index on inventory_category_id
-- ============================================================
CREATE INDEX IF NOT EXISTS "idx_club_inventory_inventory_category_id"
    ON "club_inventory"("inventory_category_id");

-- ============================================================
-- finances: indexes on created_by, finance_category_id, modified_by_id
-- ============================================================
CREATE INDEX IF NOT EXISTS "idx_finances_created_by"
    ON "finances"("created_by");

CREATE INDEX IF NOT EXISTS "idx_finances_finance_category_id"
    ON "finances"("finance_category_id");

CREATE INDEX IF NOT EXISTS "idx_finances_modified_by_id"
    ON "finances"("modified_by_id");

-- ============================================================
-- member_insurances: indexes on created_by_id, modified_by_id
-- ============================================================
CREATE INDEX IF NOT EXISTS "idx_member_insurances_created_by_id"
    ON "member_insurances"("created_by_id");

CREATE INDEX IF NOT EXISTS "idx_member_insurances_modified_by_id"
    ON "member_insurances"("modified_by_id");

-- ============================================================
-- camporee_payments: indexes on registered_by, approved_by, rejected_by
-- ============================================================
CREATE INDEX IF NOT EXISTS "idx_camporee_payments_registered_by"
    ON "camporee_payments"("registered_by");

CREATE INDEX IF NOT EXISTS "idx_camporee_payments_approved_by"
    ON "camporee_payments"("approved_by");

CREATE INDEX IF NOT EXISTS "idx_camporee_payments_rejected_by"
    ON "camporee_payments"("rejected_by");

-- ============================================================
-- NOTE: No ALTER TABLE is required for the onDelete changes on
-- club_inventory.club_section_id and finances.club_section_id.
-- The underlying FK constraints (club_inventory_club_section_id_fkey
-- and finances_club_section_id_fkey) were created with ON DELETE SET NULL
-- in the 0_baseline migration. The Prisma schema declarations have been
-- updated to reflect this existing behavior (onDelete: SetNull).
-- ============================================================

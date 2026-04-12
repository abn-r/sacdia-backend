-- =============================================================================
-- Migration: churches.active default fix
-- =============================================================================

-- Fix inconsistent default: churches.active was @default(false) while all other
-- catalog tables (districts, unions, local_fields, etc.) use @default(true).
-- A seeded or newly created church would start inactive — subtle bug.
-- NOTE: No UPDATE for existing rows. A church with active = false may be
-- legitimately deactivated. Changing their state silently would be data corruption.
ALTER TABLE "churches" ALTER COLUMN "active" SET DEFAULT true;

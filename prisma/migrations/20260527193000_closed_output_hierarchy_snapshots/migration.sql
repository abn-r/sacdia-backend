-- Migration: 20260527193000_closed_output_hierarchy_snapshots
-- Date: 2026-05-27
--
-- Adds immutable hierarchy snapshot references for closed/evaluated outputs.
-- Columns are nullable for backward compatibility with legacy rows.

BEGIN;

ALTER TABLE annual_folders
  ADD COLUMN IF NOT EXISTS hierarchy_context_id UUID;

ALTER TABLE club_annual_rankings
  ADD COLUMN IF NOT EXISTS hierarchy_context_id UUID;

ALTER TABLE enrollment_rankings
  ADD COLUMN IF NOT EXISTS hierarchy_context_id UUID;

ALTER TABLE section_rankings
  ADD COLUMN IF NOT EXISTS hierarchy_context_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'annual_folders_hierarchy_context_id_fkey'
  ) THEN
    ALTER TABLE annual_folders
      ADD CONSTRAINT annual_folders_hierarchy_context_id_fkey
      FOREIGN KEY (hierarchy_context_id)
      REFERENCES hierarchy_contexts(hierarchy_context_id)
      ON DELETE SET NULL
      ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'club_annual_rankings_hierarchy_context_id_fkey'
  ) THEN
    ALTER TABLE club_annual_rankings
      ADD CONSTRAINT club_annual_rankings_hierarchy_context_id_fkey
      FOREIGN KEY (hierarchy_context_id)
      REFERENCES hierarchy_contexts(hierarchy_context_id)
      ON DELETE SET NULL
      ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'enrollment_rankings_hierarchy_context_id_fkey'
  ) THEN
    ALTER TABLE enrollment_rankings
      ADD CONSTRAINT enrollment_rankings_hierarchy_context_id_fkey
      FOREIGN KEY (hierarchy_context_id)
      REFERENCES hierarchy_contexts(hierarchy_context_id)
      ON DELETE SET NULL
      ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'section_rankings_hierarchy_context_id_fkey'
  ) THEN
    ALTER TABLE section_rankings
      ADD CONSTRAINT section_rankings_hierarchy_context_id_fkey
      FOREIGN KEY (hierarchy_context_id)
      REFERENCES hierarchy_contexts(hierarchy_context_id)
      ON DELETE SET NULL
      ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_annual_folders_hierarchy_context
  ON annual_folders(hierarchy_context_id);

CREATE INDEX IF NOT EXISTS idx_club_annual_rankings_hierarchy_context
  ON club_annual_rankings(hierarchy_context_id);

CREATE INDEX IF NOT EXISTS idx_enrollment_rankings_hierarchy_context
  ON enrollment_rankings(hierarchy_context_id);

CREATE INDEX IF NOT EXISTS idx_section_rankings_hierarchy_context
  ON section_rankings(hierarchy_context_id);

COMMIT;

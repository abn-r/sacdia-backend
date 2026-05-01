-- T-B1-3: Dual-level evaluation rework on annual_folder_section_evaluations
-- Renames evaluated_by_id → lf_approved_by, evaluated_at → lf_approved_at
-- Relaxes lf_approved_at to nullable (removes NOT NULL + default)
-- Adds union_approved_by, union_approved_at, union_decision columns
-- Creates union_evaluation_decision_enum
-- Adds integrity CHECK: union action requires prior LF action

-- Create the new enum FIRST
CREATE TYPE "union_evaluation_decision_enum" AS ENUM ('APPROVED', 'REJECTED_OVERRIDE');

-- Drop the old FK on evaluated_by_id so we can rename the column
ALTER TABLE "annual_folder_section_evaluations"
  DROP CONSTRAINT IF EXISTS "annual_folder_section_evaluations_evaluated_by_id_fkey";

-- Drop the old index on evaluated_by_id before renaming
DROP INDEX IF EXISTS "idx_annual_folder_section_evaluations_evaluator";

-- Rename columns (preserves data)
ALTER TABLE "annual_folder_section_evaluations"
  RENAME COLUMN "evaluated_by_id" TO "lf_approved_by";

ALTER TABLE "annual_folder_section_evaluations"
  RENAME COLUMN "evaluated_at" TO "lf_approved_at";

-- Relax lf_approved_at to nullable (drop default + drop NOT NULL)
ALTER TABLE "annual_folder_section_evaluations"
  ALTER COLUMN "lf_approved_at" DROP DEFAULT;

ALTER TABLE "annual_folder_section_evaluations"
  ALTER COLUMN "lf_approved_at" DROP NOT NULL;

-- Relax lf_approved_by to nullable (was NOT NULL)
ALTER TABLE "annual_folder_section_evaluations"
  ALTER COLUMN "lf_approved_by" DROP NOT NULL;

-- Add new union_* columns
ALTER TABLE "annual_folder_section_evaluations"
  ADD COLUMN "union_approved_by" UUID,
  ADD COLUMN "union_approved_at" TIMESTAMPTZ(6),
  ADD COLUMN "union_decision" "union_evaluation_decision_enum";

-- Re-add FK for lf_approved_by with new name matching the Prisma relation
ALTER TABLE "annual_folder_section_evaluations"
  ADD CONSTRAINT "annual_folder_section_evaluations_lf_approved_by_fkey"
    FOREIGN KEY ("lf_approved_by") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- FK for union_approved_by
ALTER TABLE "annual_folder_section_evaluations"
  ADD CONSTRAINT "annual_folder_section_evaluations_union_approved_by_fkey"
    FOREIGN KEY ("union_approved_by") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Recreate index on renamed column
CREATE INDEX "idx_annual_folder_section_evaluations_lf_approver"
  ON "annual_folder_section_evaluations" ("lf_approved_by");

-- Integrity CHECK: union action requires prior LF action
ALTER TABLE "annual_folder_section_evaluations"
  ADD CONSTRAINT "annual_folder_section_evaluations_union_after_lf_check"
  CHECK (union_approved_at IS NULL OR lf_approved_at IS NOT NULL);

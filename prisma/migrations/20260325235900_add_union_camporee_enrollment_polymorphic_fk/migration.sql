-- Migration: add_union_camporee_enrollment_polymorphic_fk
-- Adds union_camporee_id FK to camporee_clubs and camporee_members,
-- makes camporee_id nullable, and enforces exactly-one-camporee CHECK constraint.

-- 1. Drop existing FK constraints (will be re-added as nullable below)
ALTER TABLE "camporee_clubs" DROP CONSTRAINT "camporee_clubs_camporee_id_fkey";
ALTER TABLE "camporee_members" DROP CONSTRAINT "camporee_members_camporee_id_fkey";

-- 2. Make camporee_id nullable
ALTER TABLE "camporee_clubs" ALTER COLUMN "camporee_id" DROP NOT NULL;
ALTER TABLE "camporee_members" ALTER COLUMN "camporee_id" DROP NOT NULL;

-- 3. Re-add FK for camporee_id as nullable (same CASCADE behavior)
ALTER TABLE "camporee_clubs"
  ADD CONSTRAINT "camporee_clubs_camporee_id_fkey"
  FOREIGN KEY ("camporee_id") REFERENCES "local_camporees"("local_camporee_id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "camporee_members"
  ADD CONSTRAINT "camporee_members_camporee_id_fkey"
  FOREIGN KEY ("camporee_id") REFERENCES "local_camporees"("local_camporee_id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- 4. Add union_camporee_id columns
ALTER TABLE "camporee_clubs" ADD COLUMN "union_camporee_id" INTEGER;
ALTER TABLE "camporee_members" ADD COLUMN "union_camporee_id" INTEGER;

-- 5. FK for union_camporee_id
ALTER TABLE "camporee_clubs"
  ADD CONSTRAINT "camporee_clubs_union_camporee_id_fkey"
  FOREIGN KEY ("union_camporee_id") REFERENCES "union_camporees"("union_camporee_id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "camporee_members"
  ADD CONSTRAINT "camporee_members_union_camporee_id_fkey"
  FOREIGN KEY ("union_camporee_id") REFERENCES "union_camporees"("union_camporee_id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- 6. CHECK constraints: exactly one of camporee_id / union_camporee_id must be set
ALTER TABLE "camporee_clubs"
  ADD CONSTRAINT "camporee_clubs_exactly_one_camporee_check"
  CHECK (
    (camporee_id IS NOT NULL AND union_camporee_id IS NULL)
    OR
    (camporee_id IS NULL AND union_camporee_id IS NOT NULL)
  );

ALTER TABLE "camporee_members"
  ADD CONSTRAINT "camporee_members_exactly_one_camporee_check"
  CHECK (
    (camporee_id IS NOT NULL AND union_camporee_id IS NULL)
    OR
    (camporee_id IS NULL AND union_camporee_id IS NOT NULL)
  );

-- 7. Indexes
CREATE INDEX "idx_camporee_clubs_union_camporee_id" ON "camporee_clubs"("union_camporee_id");
CREATE INDEX "idx_camporee_members_union_camporee_id" ON "camporee_members"("union_camporee_id");

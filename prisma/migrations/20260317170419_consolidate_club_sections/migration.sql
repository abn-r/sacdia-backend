-- ============================================================
-- MIGRATION: Consolidate club_adventurers, club_pathfinders,
--            club_master_guilds → club_sections
-- ============================================================
-- All 9 phases run inside a single transaction for atomicity.
-- Run the pre-migration audit script before applying this file.
-- ============================================================

BEGIN;

-- ============================================================
-- PHASE 1: Create club_sections table, temp mapping table,
--          insert data from all 3 source tables, verify.
-- ============================================================

CREATE TABLE "club_sections" (
  "club_section_id" SERIAL PRIMARY KEY,
  "active"          BOOLEAN NOT NULL DEFAULT false,
  "souls_target"    INTEGER NOT NULL DEFAULT 1,
  "fee"             INTEGER NOT NULL DEFAULT 1,
  "meeting_day"     JSONB[] DEFAULT '{}',
  "meeting_time"    JSONB[] DEFAULT '{}',
  "club_type_id"    INTEGER NOT NULL,
  "main_club_id"    INTEGER,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "modified_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "club_sections_club_type_id_fkey"
    FOREIGN KEY ("club_type_id")
    REFERENCES "club_types"("club_type_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "club_sections_main_club_id_fkey"
    FOREIGN KEY ("main_club_id")
    REFERENCES "clubs"("club_id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "club_sections_main_club_id_club_type_id_key"
    UNIQUE ("main_club_id", "club_type_id")
);

-- Temp mapping table: tracks old ID + source table → new club_section_id
CREATE TEMP TABLE _section_id_map (
  source_table  TEXT    NOT NULL,
  old_id        INTEGER NOT NULL,
  new_section_id INTEGER NOT NULL,
  PRIMARY KEY (source_table, old_id)
);

-- Insert from club_adventurers
INSERT INTO "club_sections"
  ("active", "souls_target", "fee", "meeting_day", "meeting_time", "club_type_id", "main_club_id", "created_at", "modified_at")
SELECT
  "active", "souls_target", "fee", "meeting_day", "meeting_time", "club_type_id", "main_club_id", "created_at", "modified_at"
FROM "club_adventurers";

INSERT INTO _section_id_map (source_table, old_id, new_section_id)
SELECT
  'club_adventurers',
  ca."club_adv_id",
  cs."club_section_id"
FROM "club_adventurers" ca
JOIN "club_sections" cs
  ON cs."main_club_id" = ca."main_club_id"
 AND cs."club_type_id" = ca."club_type_id";

-- Insert from club_pathfinders
INSERT INTO "club_sections"
  ("active", "souls_target", "fee", "meeting_day", "meeting_time", "club_type_id", "main_club_id", "created_at", "modified_at")
SELECT
  "active", "souls_target", "fee", "meeting_day", "meeting_time", "club_type_id", "main_club_id", "created_at", "modified_at"
FROM "club_pathfinders";

INSERT INTO _section_id_map (source_table, old_id, new_section_id)
SELECT
  'club_pathfinders',
  cp."club_pathf_id",
  cs."club_section_id"
FROM "club_pathfinders" cp
JOIN "club_sections" cs
  ON cs."main_club_id" = cp."main_club_id"
 AND cs."club_type_id" = cp."club_type_id";

-- Insert from club_master_guilds
INSERT INTO "club_sections"
  ("active", "souls_target", "fee", "meeting_day", "meeting_time", "club_type_id", "main_club_id", "created_at", "modified_at")
SELECT
  "active", "souls_target", "fee", "meeting_day", "meeting_time", "club_type_id", "main_club_id", "created_at", "modified_at"
FROM "club_master_guilds";

INSERT INTO _section_id_map (source_table, old_id, new_section_id)
SELECT
  'club_master_guilds',
  cmg."club_mg_id",
  cs."club_section_id"
FROM "club_master_guilds" cmg
JOIN "club_sections" cs
  ON cs."main_club_id" = cmg."main_club_id"
 AND cs."club_type_id" = cmg."club_type_id";

-- Verify mapping completeness (aborts transaction on mismatch)
DO $$
DECLARE
  v_adv_total    INTEGER;
  v_pathf_total  INTEGER;
  v_mg_total     INTEGER;
  v_map_adv      INTEGER;
  v_map_pathf    INTEGER;
  v_map_mg       INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_adv_total   FROM "club_adventurers";
  SELECT COUNT(*) INTO v_pathf_total FROM "club_pathfinders";
  SELECT COUNT(*) INTO v_mg_total    FROM "club_master_guilds";

  SELECT COUNT(*) INTO v_map_adv   FROM _section_id_map WHERE source_table = 'club_adventurers';
  SELECT COUNT(*) INTO v_map_pathf FROM _section_id_map WHERE source_table = 'club_pathfinders';
  SELECT COUNT(*) INTO v_map_mg    FROM _section_id_map WHERE source_table = 'club_master_guilds';

  IF v_adv_total <> v_map_adv THEN
    RAISE EXCEPTION 'Mapping incomplete for club_adventurers: % rows vs % mapped', v_adv_total, v_map_adv;
  END IF;
  IF v_pathf_total <> v_map_pathf THEN
    RAISE EXCEPTION 'Mapping incomplete for club_pathfinders: % rows vs % mapped', v_pathf_total, v_map_pathf;
  END IF;
  IF v_mg_total <> v_map_mg THEN
    RAISE EXCEPTION 'Mapping incomplete for club_master_guilds: % rows vs % mapped', v_mg_total, v_map_mg;
  END IF;

  RAISE NOTICE 'Phase 1 OK — mapped %/% adventurers, %/% pathfinders, %/% master_guilds',
    v_map_adv, v_adv_total,
    v_map_pathf, v_pathf_total,
    v_map_mg, v_mg_total;
END $$;

-- ============================================================
-- PHASE 2: Add club_section_id column to all 10 dependent tables
-- ============================================================

ALTER TABLE "activities"               ADD COLUMN "club_section_id" INTEGER;
ALTER TABLE "activity_instances"       ADD COLUMN "club_section_id" INTEGER;
ALTER TABLE "folder_assignments"       ADD COLUMN "club_section_id" INTEGER;
ALTER TABLE "camporee_clubs"           ADD COLUMN "club_section_id" INTEGER;
ALTER TABLE "club_inventory"           ADD COLUMN "club_section_id" INTEGER;
ALTER TABLE "club_role_assignments"    ADD COLUMN "club_section_id" INTEGER;
ALTER TABLE "finances"                 ADD COLUMN "club_section_id" INTEGER;
ALTER TABLE "folders_modules_records"  ADD COLUMN "club_section_id" INTEGER;
ALTER TABLE "folders_section_records"  ADD COLUMN "club_section_id" INTEGER;
ALTER TABLE "units"                    ADD COLUMN "club_section_id" INTEGER;

-- ============================================================
-- PHASE 3: Populate club_section_id in each dependent table
--          using the mapping table
-- ============================================================

-- activities
UPDATE "activities" a
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_adventurers' AND m.old_id = a."club_adv_id";

UPDATE "activities" a
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_pathfinders' AND m.old_id = a."club_pathf_id";

UPDATE "activities" a
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_master_guilds' AND m.old_id = a."club_mg_id";

-- activity_instances
UPDATE "activity_instances" ai
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_adventurers' AND m.old_id = ai."club_adv_id";

UPDATE "activity_instances" ai
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_pathfinders' AND m.old_id = ai."club_pathf_id";

UPDATE "activity_instances" ai
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_master_guilds' AND m.old_id = ai."club_mg_id";

-- folder_assignments
UPDATE "folder_assignments" fa
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_adventurers' AND m.old_id = fa."club_adv_id";

UPDATE "folder_assignments" fa
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_pathfinders' AND m.old_id = fa."club_pathf_id";

UPDATE "folder_assignments" fa
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_master_guilds' AND m.old_id = fa."club_mg_id";

-- camporee_clubs
UPDATE "camporee_clubs" cc
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_adventurers' AND m.old_id = cc."club_adv_id";

UPDATE "camporee_clubs" cc
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_pathfinders' AND m.old_id = cc."club_pathf_id";

UPDATE "camporee_clubs" cc
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_master_guilds' AND m.old_id = cc."club_mg_id";

-- club_inventory
UPDATE "club_inventory" ci
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_adventurers' AND m.old_id = ci."club_adv_id";

UPDATE "club_inventory" ci
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_pathfinders' AND m.old_id = ci."club_pathf_id";

UPDATE "club_inventory" ci
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_master_guilds' AND m.old_id = ci."club_mg_id";

-- club_role_assignments
UPDATE "club_role_assignments" cra
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_adventurers' AND m.old_id = cra."club_adv_id";

UPDATE "club_role_assignments" cra
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_pathfinders' AND m.old_id = cra."club_pathf_id";

UPDATE "club_role_assignments" cra
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_master_guilds' AND m.old_id = cra."club_mg_id";

-- finances
UPDATE "finances" f
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_adventurers' AND m.old_id = f."club_adv_id";

UPDATE "finances" f
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_pathfinders' AND m.old_id = f."club_pathf_id";

UPDATE "finances" f
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_master_guilds' AND m.old_id = f."club_mg_id";

-- folders_modules_records
UPDATE "folders_modules_records" fmr
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_adventurers' AND m.old_id = fmr."club_adv_id";

UPDATE "folders_modules_records" fmr
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_pathfinders' AND m.old_id = fmr."club_pathf_id";

UPDATE "folders_modules_records" fmr
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_master_guilds' AND m.old_id = fmr."club_mg_id";

-- folders_section_records
UPDATE "folders_section_records" fsr
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_adventurers' AND m.old_id = fsr."club_adv_id";

UPDATE "folders_section_records" fsr
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_pathfinders' AND m.old_id = fsr."club_pathf_id";

UPDATE "folders_section_records" fsr
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_master_guilds' AND m.old_id = fsr."club_mg_id";

-- units
UPDATE "units" u
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_adventurers' AND m.old_id = u."club_adv_id";

UPDATE "units" u
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_pathfinders' AND m.old_id = u."club_pathf_id";

UPDATE "units" u
SET "club_section_id" = m.new_section_id
FROM _section_id_map m
WHERE m.source_table = 'club_master_guilds' AND m.old_id = u."club_mg_id";

-- ============================================================
-- PHASE 4: Add FK constraints + indexes
-- ============================================================

-- activities (NoAction)
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_club_section_id_fkey"
    FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE INDEX "idx_activities_club_section_id" ON "activities"("club_section_id");

-- activity_instances (NoAction)
ALTER TABLE "activity_instances"
  ADD CONSTRAINT "activity_instances_club_section_id_fkey"
    FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE INDEX "idx_activity_instances_club_section_id" ON "activity_instances"("club_section_id");

-- folder_assignments (NoAction)
ALTER TABLE "folder_assignments"
  ADD CONSTRAINT "folder_assignments_club_section_id_fkey"
    FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE INDEX "idx_folder_assignments_club_section_id" ON "folder_assignments"("club_section_id");

-- camporee_clubs (NoAction)
ALTER TABLE "camporee_clubs"
  ADD CONSTRAINT "camporee_clubs_club_section_id_fkey"
    FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE INDEX "idx_camporee_clubs_club_section_id" ON "camporee_clubs"("club_section_id");

-- club_inventory (SetNull)
ALTER TABLE "club_inventory"
  ADD CONSTRAINT "club_inventory_club_section_id_fkey"
    FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
CREATE INDEX "idx_club_inventory_club_section_id" ON "club_inventory"("club_section_id");

-- club_role_assignments (Cascade)
ALTER TABLE "club_role_assignments"
  ADD CONSTRAINT "club_role_assignments_club_section_id_fkey"
    FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
CREATE INDEX "idx_club_role_assignments_club_section_id" ON "club_role_assignments"("club_section_id");

-- finances (SetNull)
ALTER TABLE "finances"
  ADD CONSTRAINT "finances_club_section_id_fkey"
    FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
CREATE INDEX "idx_finances_club_section_id" ON "finances"("club_section_id");

-- folders_modules_records (NoAction)
ALTER TABLE "folders_modules_records"
  ADD CONSTRAINT "folders_modules_records_club_section_id_fkey"
    FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE INDEX "idx_folders_modules_records_club_section_id" ON "folders_modules_records"("club_section_id");

-- folders_section_records (NoAction)
ALTER TABLE "folders_section_records"
  ADD CONSTRAINT "folders_section_records_club_section_id_fkey"
    FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE INDEX "idx_folders_section_records_club_section_id" ON "folders_section_records"("club_section_id");

-- units (NoAction)
ALTER TABLE "units"
  ADD CONSTRAINT "units_club_section_id_fkey"
    FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE INDEX "idx_units_club_section_id" ON "units"("club_section_id");

-- ============================================================
-- PHASE 5: Update unique constraints
-- ============================================================

-- club_role_assignments: drop BOTH old unique constraints/indexes, create new
ALTER TABLE "club_role_assignments"
  DROP CONSTRAINT IF EXISTS "club_role_assignment_unique",
  DROP CONSTRAINT IF EXISTS "club_role_assignment_unique_refactored";
DROP INDEX IF EXISTS "club_role_assignment_unique";
DROP INDEX IF EXISTS "club_role_assignment_unique_refactored";

ALTER TABLE "club_role_assignments"
  ADD CONSTRAINT "club_role_assignment_unique"
    UNIQUE ("user_id", "role_id", "club_section_id", "ecclesiastical_year_id", "start_date");

-- activity_instances: drop old unique constraint/index, create new
ALTER TABLE "activity_instances"
  DROP CONSTRAINT IF EXISTS "activity_instances_unique_instance_per_activity";
DROP INDEX IF EXISTS "activity_instances_unique_instance_per_activity";

ALTER TABLE "activity_instances"
  ADD CONSTRAINT "activity_instances_unique_instance_per_activity"
    UNIQUE ("activity_id", "club_section_id");

-- ============================================================
-- PHASE 6: Drop old FK columns from all 10 dependent tables
-- ============================================================

-- activities
ALTER TABLE "activities"
  DROP CONSTRAINT IF EXISTS "activities_club_adv_id_fkey",
  DROP CONSTRAINT IF EXISTS "activities_club_mg_id_fkey",
  DROP CONSTRAINT IF EXISTS "activities_club_pathf_id_fkey";
ALTER TABLE "activities"
  DROP COLUMN IF EXISTS "club_adv_id",
  DROP COLUMN IF EXISTS "club_pathf_id",
  DROP COLUMN IF EXISTS "club_mg_id";

-- activity_instances
ALTER TABLE "activity_instances"
  DROP CONSTRAINT IF EXISTS "activity_instances_club_adv_id_fkey",
  DROP CONSTRAINT IF EXISTS "activity_instances_club_pathf_id_fkey",
  DROP CONSTRAINT IF EXISTS "activity_instances_club_mg_id_fkey";
DROP INDEX IF EXISTS "idx_activity_instances_adv";
DROP INDEX IF EXISTS "idx_activity_instances_pathf";
DROP INDEX IF EXISTS "idx_activity_instances_mg";
ALTER TABLE "activity_instances"
  DROP COLUMN IF EXISTS "club_adv_id",
  DROP COLUMN IF EXISTS "club_pathf_id",
  DROP COLUMN IF EXISTS "club_mg_id";

-- folder_assignments (orphan FKs — no constraints to drop, just columns)
ALTER TABLE "folder_assignments"
  DROP COLUMN IF EXISTS "club_adv_id",
  DROP COLUMN IF EXISTS "club_pathf_id",
  DROP COLUMN IF EXISTS "club_mg_id";

-- camporee_clubs
ALTER TABLE "camporee_clubs"
  DROP CONSTRAINT IF EXISTS "camporee_clubs_club_adv_id_fkey",
  DROP CONSTRAINT IF EXISTS "camporee_clubs_club_mg_id_fkey",
  DROP CONSTRAINT IF EXISTS "camporee_clubs_club_pathf_id_fkey";
ALTER TABLE "camporee_clubs"
  DROP COLUMN IF EXISTS "club_adv_id",
  DROP COLUMN IF EXISTS "club_pathf_id",
  DROP COLUMN IF EXISTS "club_mg_id";

-- club_inventory
ALTER TABLE "club_inventory"
  DROP CONSTRAINT IF EXISTS "club_inventory_club_adv_id_fkey",
  DROP CONSTRAINT IF EXISTS "club_inventory_club_mg_id_fkey",
  DROP CONSTRAINT IF EXISTS "club_inventory_club_pathf_id_fkey";
ALTER TABLE "club_inventory"
  DROP COLUMN IF EXISTS "club_adv_id",
  DROP COLUMN IF EXISTS "club_pathf_id",
  DROP COLUMN IF EXISTS "club_mg_id";

-- club_role_assignments
ALTER TABLE "club_role_assignments"
  DROP CONSTRAINT IF EXISTS "club_role_assignments_club_adv_id_fkey",
  DROP CONSTRAINT IF EXISTS "club_role_assignments_club_mg_id_fkey",
  DROP CONSTRAINT IF EXISTS "club_role_assignments_club_pathf_id_fkey";
DROP INDEX IF EXISTS "idx_club_role_assignments_club_adv";
DROP INDEX IF EXISTS "idx_club_role_assignments_club_mg";
DROP INDEX IF EXISTS "idx_club_role_assignments_club_pathf";
ALTER TABLE "club_role_assignments"
  DROP COLUMN IF EXISTS "club_adv_id",
  DROP COLUMN IF EXISTS "club_pathf_id",
  DROP COLUMN IF EXISTS "club_mg_id";

-- finances
ALTER TABLE "finances"
  DROP CONSTRAINT IF EXISTS "finances_club_adv_id_fkey",
  DROP CONSTRAINT IF EXISTS "finances_club_mg_id_fkey",
  DROP CONSTRAINT IF EXISTS "finances_club_pathf_id_fkey";
ALTER TABLE "finances"
  DROP COLUMN IF EXISTS "club_adv_id",
  DROP COLUMN IF EXISTS "club_pathf_id",
  DROP COLUMN IF EXISTS "club_mg_id";

-- folders_modules_records
ALTER TABLE "folders_modules_records"
  DROP CONSTRAINT IF EXISTS "fk_act_club_adventurers",
  DROP CONSTRAINT IF EXISTS "fk_act_club_master_guild",
  DROP CONSTRAINT IF EXISTS "fk_act_club_pathfinders";
ALTER TABLE "folders_modules_records"
  DROP COLUMN IF EXISTS "club_adv_id",
  DROP COLUMN IF EXISTS "club_pathf_id",
  DROP COLUMN IF EXISTS "club_mg_id";

-- folders_section_records
ALTER TABLE "folders_section_records"
  DROP CONSTRAINT IF EXISTS "fk_act_club_adventurers",
  DROP CONSTRAINT IF EXISTS "fk_act_club_master_guild",
  DROP CONSTRAINT IF EXISTS "fk_act_club_pathfinders";
ALTER TABLE "folders_section_records"
  DROP COLUMN IF EXISTS "club_adv_id",
  DROP COLUMN IF EXISTS "club_pathf_id",
  DROP COLUMN IF EXISTS "club_mg_id";

-- units
ALTER TABLE "units"
  DROP CONSTRAINT IF EXISTS "fk_act_club_adventurers",
  DROP CONSTRAINT IF EXISTS "fk_act_club_master_guild",
  DROP CONSTRAINT IF EXISTS "fk_act_club_pathfinders";
ALTER TABLE "units"
  DROP COLUMN IF EXISTS "club_adv_id",
  DROP COLUMN IF EXISTS "club_pathf_id",
  DROP COLUMN IF EXISTS "club_mg_id";

-- ============================================================
-- PHASE 7: Rename original tables with _deprecated suffix
--          (7-day grace period before dropping)
-- ============================================================

ALTER TABLE "club_adventurers"  RENAME TO "club_adventurers_deprecated";
ALTER TABLE "club_pathfinders"  RENAME TO "club_pathfinders_deprecated";
ALTER TABLE "club_master_guilds" RENAME TO "club_master_guilds_deprecated";

-- ============================================================
-- PHASE 8: Update permission strings
--          club_instances% → club_sections%
-- ============================================================

UPDATE "permissions"
SET "permission_name" = REPLACE("permission_name", 'club_instances', 'club_sections')
WHERE "permission_name" LIKE 'club_instances%';

-- ============================================================
-- PHASE 9: Drop temp mapping table
-- ============================================================

DROP TABLE _section_id_map;

COMMIT;

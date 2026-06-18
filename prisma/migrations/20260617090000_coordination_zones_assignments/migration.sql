-- Coordination zones and assignments
-- Canon: docs/canon/runtime-coordination.md

CREATE TYPE "coordinator_assignment_type" AS ENUM ('GENERAL', 'ZONE', 'SECTION');

CREATE TABLE "coordination_zones" (
  "zone_id" SERIAL PRIMARY KEY,
  "local_field_id" INTEGER NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coordination_zones_local_field_id_fkey"
    FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "coordination_zone_districts" (
  "zone_district_id" SERIAL PRIMARY KEY,
  "zone_id" INTEGER NOT NULL,
  "districlub_type_id" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coordination_zone_districts_zone_id_fkey"
    FOREIGN KEY ("zone_id") REFERENCES "coordination_zones"("zone_id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "coordination_zone_districts_districlub_type_id_fkey"
    FOREIGN KEY ("districlub_type_id") REFERENCES "districts"("districlub_type_id")
    ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE TABLE "coordinator_assignments" (
  "assignment_id" UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  "user_id" UUID NOT NULL,
  "local_field_id" INTEGER NOT NULL,
  "assignment_type" "coordinator_assignment_type" NOT NULL,
  "zone_id" INTEGER,
  "club_type_id" INTEGER,
  "club_section_id" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "start_date" DATE NOT NULL DEFAULT CURRENT_DATE,
  "end_date" DATE,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coordinator_assignments_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("user_id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "coordinator_assignments_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("user_id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "coordinator_assignments_local_field_id_fkey"
    FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "coordinator_assignments_zone_id_fkey"
    FOREIGN KEY ("zone_id") REFERENCES "coordination_zones"("zone_id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "coordinator_assignments_club_type_id_fkey"
    FOREIGN KEY ("club_type_id") REFERENCES "club_types"("club_type_id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "coordinator_assignments_club_section_id_fkey"
    FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "coordinator_assignments_valid_shape_chk" CHECK (
    (
      "assignment_type" = 'GENERAL'
      AND "zone_id" IS NULL
      AND "club_type_id" IS NULL
      AND "club_section_id" IS NULL
    ) OR (
      "assignment_type" = 'ZONE'
      AND "zone_id" IS NOT NULL
      AND "club_type_id" IS NOT NULL
      AND "club_section_id" IS NULL
    ) OR (
      "assignment_type" = 'SECTION'
      AND "zone_id" IS NULL
      AND "club_type_id" IS NULL
      AND "club_section_id" IS NOT NULL
    )
  ),
  CONSTRAINT "coordinator_assignments_valid_dates_chk" CHECK (
    "end_date" IS NULL OR "end_date" >= "start_date"
  )
);

CREATE UNIQUE INDEX "uq_coordination_zones_lf_name"
  ON "coordination_zones"("local_field_id", "name");
CREATE INDEX "idx_coordination_zones_lf_active"
  ON "coordination_zones"("local_field_id", "active");

CREATE UNIQUE INDEX "uq_coordination_zone_district_pair"
  ON "coordination_zone_districts"("zone_id", "districlub_type_id");
CREATE UNIQUE INDEX "uq_coordination_zone_district_active_district"
  ON "coordination_zone_districts"("districlub_type_id")
  WHERE "active" = true;
CREATE INDEX "idx_coordination_zone_district_active"
  ON "coordination_zone_districts"("districlub_type_id", "active");
CREATE INDEX "idx_coordination_zone_district_zone_active"
  ON "coordination_zone_districts"("zone_id", "active");

CREATE UNIQUE INDEX "uq_coordinator_general_active_per_lf"
  ON "coordinator_assignments"("local_field_id")
  WHERE "active" = true AND "assignment_type" = 'GENERAL';
CREATE UNIQUE INDEX "uq_coordinator_zone_type_active"
  ON "coordinator_assignments"("zone_id", "club_type_id")
  WHERE "active" = true AND "assignment_type" = 'ZONE';
CREATE UNIQUE INDEX "uq_coordinator_section_active"
  ON "coordinator_assignments"("club_section_id")
  WHERE "active" = true AND "assignment_type" = 'SECTION';
CREATE INDEX "idx_coordinator_assignments_user_active"
  ON "coordinator_assignments"("user_id", "active");
CREATE INDEX "idx_coordinator_assignments_lf_active"
  ON "coordinator_assignments"("local_field_id", "active");
CREATE INDEX "idx_coordinator_assignments_type_active"
  ON "coordinator_assignments"("assignment_type", "active");
CREATE INDEX "idx_coordinator_assignments_zone_type_active"
  ON "coordinator_assignments"("zone_id", "club_type_id", "active");
CREATE INDEX "idx_coordinator_assignments_section_active"
  ON "coordinator_assignments"("club_section_id", "active");

COMMENT ON TABLE "coordination_zones" IS 'Local-field coordination zones that group districts.';
COMMENT ON TABLE "coordination_zone_districts" IS 'District memberships for coordination zones.';
COMMENT ON TABLE "coordinator_assignments" IS 'Coordinator authority assignments; effective scope resolves to club_section_ids.';

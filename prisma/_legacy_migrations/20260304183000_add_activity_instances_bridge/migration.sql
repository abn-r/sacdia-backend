-- Bridge table to support activities linked to multiple club instances
CREATE TABLE "activity_instances" (
    "activity_instance_id" SERIAL NOT NULL,
    "activity_id" INTEGER NOT NULL,
    "club_adv_id" INTEGER,
    "club_pathf_id" INTEGER,
    "club_mg_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_instances_pkey" PRIMARY KEY ("activity_instance_id"),
    CONSTRAINT "activity_instances_single_target_chk" CHECK (
      (("club_adv_id" IS NOT NULL)::int +
       ("club_pathf_id" IS NOT NULL)::int +
       ("club_mg_id" IS NOT NULL)::int) = 1
    )
);

ALTER TABLE "activity_instances"
ADD CONSTRAINT "activity_instances_activity_id_fkey"
FOREIGN KEY ("activity_id") REFERENCES "activities"("activity_id")
ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "activity_instances"
ADD CONSTRAINT "activity_instances_club_adv_id_fkey"
FOREIGN KEY ("club_adv_id") REFERENCES "club_adventurers"("club_adv_id")
ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "activity_instances"
ADD CONSTRAINT "activity_instances_club_pathf_id_fkey"
FOREIGN KEY ("club_pathf_id") REFERENCES "club_pathfinders"("club_pathf_id")
ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "activity_instances"
ADD CONSTRAINT "activity_instances_club_mg_id_fkey"
FOREIGN KEY ("club_mg_id") REFERENCES "club_master_guilds"("club_mg_id")
ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE INDEX "idx_activity_instances_activity" ON "activity_instances"("activity_id");
CREATE INDEX "idx_activity_instances_adv" ON "activity_instances"("club_adv_id");
CREATE INDEX "idx_activity_instances_pathf" ON "activity_instances"("club_pathf_id");
CREATE INDEX "idx_activity_instances_mg" ON "activity_instances"("club_mg_id");

CREATE UNIQUE INDEX "activity_instances_unique_instance_per_activity"
ON "activity_instances"("activity_id", "club_adv_id", "club_pathf_id", "club_mg_id");

-- Backfill legacy activity instance references
INSERT INTO "activity_instances" ("activity_id", "club_adv_id", "active")
SELECT "activity_id", "club_adv_id", true
FROM "activities"
WHERE "club_adv_id" IS NOT NULL
ON CONFLICT ("activity_id", "club_adv_id", "club_pathf_id", "club_mg_id") DO NOTHING;

INSERT INTO "activity_instances" ("activity_id", "club_pathf_id", "active")
SELECT "activity_id", "club_pathf_id", true
FROM "activities"
WHERE "club_pathf_id" IS NOT NULL
ON CONFLICT ("activity_id", "club_adv_id", "club_pathf_id", "club_mg_id") DO NOTHING;

INSERT INTO "activity_instances" ("activity_id", "club_mg_id", "active")
SELECT "activity_id", "club_mg_id", true
FROM "activities"
WHERE "club_mg_id" IS NOT NULL
ON CONFLICT ("activity_id", "club_adv_id", "club_pathf_id", "club_mg_id") DO NOTHING;

-- Camporee agenda visibility + schedule blocks
-- Additive migration: keeps existing camporee_events as canonical event records.

ALTER TABLE "local_camporees"
  ADD COLUMN "agenda_visible_from" TIMESTAMPTZ;

ALTER TABLE "union_camporees"
  ADD COLUMN "agenda_visible_from" TIMESTAMPTZ;

CREATE TABLE "camporee_event_schedule_blocks" (
  "camporee_event_schedule_block_id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "camporee_event_id" INTEGER NOT NULL,
  "title" VARCHAR(150),
  "description" TEXT,
  "day_number" INTEGER NOT NULL,
  "starts_at" VARCHAR(5),
  "ends_at" VARCHAR(5),
  "venue_id" INTEGER,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "capacity" INTEGER,
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by" UUID,
  "modified_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "modified_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "camporee_event_schedule_blocks_event_fkey"
    FOREIGN KEY ("camporee_event_id") REFERENCES "camporee_events"("camporee_event_id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "camporee_event_schedule_blocks_venue_fkey"
    FOREIGN KEY ("venue_id") REFERENCES "camporee_venues"("camporee_venue_id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "camporee_event_schedule_blocks_day_chk"
    CHECK ("day_number" >= 1),
  CONSTRAINT "camporee_event_schedule_blocks_time_chk"
    CHECK (
      ("starts_at" IS NULL OR "starts_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND
      ("ends_at" IS NULL OR "ends_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    ),
  CONSTRAINT "camporee_event_schedule_blocks_capacity_chk"
    CHECK ("capacity" IS NULL OR "capacity" >= 0)
);

CREATE TABLE "camporee_event_schedule_block_assignments" (
  "camporee_event_schedule_block_assignment_id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "schedule_block_id" UUID NOT NULL,
  "camporee_club_id" INTEGER,
  "club_section_id" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by" UUID,
  "modified_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "modified_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "camporee_schedule_block_assignments_block_fkey"
    FOREIGN KEY ("schedule_block_id") REFERENCES "camporee_event_schedule_blocks"("camporee_event_schedule_block_id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "camporee_schedule_block_assignments_camporee_club_fkey"
    FOREIGN KEY ("camporee_club_id") REFERENCES "camporee_clubs"("camporee_club_id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "camporee_schedule_block_assignments_club_section_fkey"
    FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX "idx_camporee_event_schedule_blocks_event"
  ON "camporee_event_schedule_blocks"("camporee_event_id", "active", "display_order");
CREATE INDEX "idx_camporee_event_schedule_blocks_day_time"
  ON "camporee_event_schedule_blocks"("day_number", "starts_at");
CREATE INDEX "idx_camporee_event_schedule_blocks_venue"
  ON "camporee_event_schedule_blocks"("venue_id");
CREATE INDEX "idx_camporee_schedule_block_assignments_block"
  ON "camporee_event_schedule_block_assignments"("schedule_block_id", "active");
CREATE INDEX "idx_camporee_schedule_block_assignments_section"
  ON "camporee_event_schedule_block_assignments"("club_section_id", "active");
CREATE INDEX "idx_camporee_schedule_block_assignments_camporee_club"
  ON "camporee_event_schedule_block_assignments"("camporee_club_id");

-- Align canonical camporee event type catalog for agenda usage.
INSERT INTO "camporee_event_types" ("code", "name", "description", "display_order", "active")
VALUES
  ('scoring',      'Puntuable',   'Evento evaluable con rúbricas y puntaje oficial',       1, TRUE),
  ('recreational', 'Recreativo',  'Actividad recreativa o de integración',                  2, TRUE),
  ('rest',         'Descanso',    'Espacio de descanso, comida o transición',               3, TRUE),
  ('spiritual',    'Espiritual',  'Actividad espiritual institucional',                     4, TRUE),
  ('devotional',   'Devocional',  'Devocional, culto o reflexión breve',                    5, TRUE),
  ('general',      'General',     'Actividad general de agenda',                            6, TRUE)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "display_order" = EXCLUDED."display_order",
  "active" = TRUE,
  "modified_at" = NOW();

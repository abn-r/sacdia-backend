-- Migration: 20260521000001_add_camporee_agenda_fields
-- Date: 2026-05-21
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Wires the Variant K timeline UI to real backend data (camporee-agenda-events SDD).
-- Adds:
--   1. camporee_event_status enum (5 values: programado, publicado, en_curso, realizado, cancelado)
--   2. camporee_venues table (physical venues scoped to union or local_field)
--   3. Agenda columns on camporee_events (day/time/venue/leader/sections/category/status/capacity)
--   4. CHECK constraints for validation
--   5. Indexes for filter performance
--
-- Additive only — no existing columns are removed or renamed.
-- All new camporee_events columns have safe defaults; zero production rows exist.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Status enum
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE camporee_event_status AS ENUM (
  'programado',
  'publicado',
  'en_curso',
  'realizado',
  'cancelado'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Venues table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE camporee_venues (
  camporee_venue_id  SERIAL       PRIMARY KEY,
  scope              VARCHAR(20)  NOT NULL,
  union_id           INTEGER      REFERENCES unions(union_id) ON DELETE RESTRICT,
  local_field_id     INTEGER      REFERENCES local_fields(local_field_id) ON DELETE RESTRICT,
  name               VARCHAR(150) NOT NULL,
  description        VARCHAR(500),
  capacity           INTEGER,
  active             BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  modified_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by         UUID,
  modified_by        UUID,

  CONSTRAINT camporee_venues_scope_chk
    CHECK (scope IN ('union', 'local_field')),
  CONSTRAINT camporee_venues_scope_fk_chk
    CHECK (
      (scope = 'union'       AND union_id IS NOT NULL AND local_field_id IS NULL) OR
      (scope = 'local_field' AND local_field_id IS NOT NULL AND union_id IS NULL)
    ),
  CONSTRAINT camporee_venues_capacity_chk
    CHECK (capacity IS NULL OR capacity >= 0)
);

CREATE INDEX camporee_venues_union_idx       ON camporee_venues(union_id, active);
CREATE INDEX camporee_venues_local_field_idx ON camporee_venues(local_field_id, active);
CREATE INDEX camporee_venues_scope_idx       ON camporee_venues(scope, active);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Extend camporee_events with agenda fields
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE camporee_events
  ADD COLUMN day_number           INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN starts_at            VARCHAR(5),
  ADD COLUMN ends_at              VARCHAR(5),
  ADD COLUMN venue_id             INTEGER REFERENCES camporee_venues(camporee_venue_id) ON DELETE SET NULL,
  ADD COLUMN leader_user_id       UUID REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN leader_name_override VARCHAR(100),
  ADD COLUMN leader_role          VARCHAR(100),
  ADD COLUMN sections             TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN display_category     VARCHAR(40) NOT NULL DEFAULT 'logistico',
  ADD COLUMN status               camporee_event_status NOT NULL DEFAULT 'programado',
  ADD COLUMN capacity             INTEGER,
  ADD COLUMN registered_count     INTEGER NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Constraints on camporee_events
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE camporee_events
  ADD CONSTRAINT camporee_events_display_category_chk
    CHECK (display_category IN ('espiritual','competencia','taller','ceremonial','social','logistico')),
  ADD CONSTRAINT camporee_events_sections_chk
    CHECK (sections <@ ARRAY['adventurers','pathfinders','master_guides']::text[]),
  ADD CONSTRAINT camporee_events_day_number_chk
    CHECK (day_number >= 1),
  ADD CONSTRAINT camporee_events_time_chk
    CHECK (
      (starts_at IS NULL OR starts_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND
      (ends_at   IS NULL OR ends_at   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    ),
  ADD CONSTRAINT camporee_events_capacity_chk
    CHECK (capacity IS NULL OR capacity >= 0),
  ADD CONSTRAINT camporee_events_registered_chk
    CHECK (registered_count >= 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Indexes on camporee_events
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX camporee_events_day_idx       ON camporee_events(day_number, active);
CREATE INDEX camporee_events_status_idx    ON camporee_events(status, active);
CREATE INDEX camporee_events_category_idx  ON camporee_events(display_category, active);
CREATE INDEX camporee_events_venue_idx     ON camporee_events(venue_id);
CREATE INDEX camporee_events_leader_idx    ON camporee_events(leader_user_id);

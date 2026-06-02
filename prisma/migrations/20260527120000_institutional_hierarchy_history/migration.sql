-- Migration: 20260527120000_institutional_hierarchy_history
-- Date: 2026-05-27
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Separates institutional authority from geography. `countries` remains
-- geographic; `divisions` becomes the top-level institutional authority.
-- The migration is additive except for enforcing real division ownership in
-- `scoring_categories` by replacing the legacy DIVISION origin_id=0 sentinel.
--
-- Safety goals:
--   1. Create canonical DIA division as the initial unambiguous division.
--   2. Backfill every current hierarchy edge into effective-dated history.
--   3. Enforce one open interval per entity and anti-overlap at DB level.
--   4. Migrate scoring categories from origin_id=0 to real DIA division_id.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Divisions catalog + translations
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS divisions (
  division_id  SERIAL       PRIMARY KEY,
  code         VARCHAR(50)  NOT NULL UNIQUE,
  name         VARCHAR(100) NOT NULL UNIQUE,
  abbreviation VARCHAR(16)  NOT NULL UNIQUE,
  active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ(6) DEFAULT NOW(),
  modified_at  TIMESTAMPTZ(6) DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_divisions_active ON divisions(active);

CREATE TABLE IF NOT EXISTS divisions_translations (
  id          SERIAL PRIMARY KEY,
  division_id INTEGER NOT NULL,
  locale      VARCHAR(10) NOT NULL,
  name        TEXT,
  created_at  TIMESTAMPTZ(6) DEFAULT NOW(),
  updated_at  TIMESTAMPTZ(6) DEFAULT NOW(),

  CONSTRAINT divisions_translations_division_id_fkey
    FOREIGN KEY (division_id)
    REFERENCES divisions(division_id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT divisions_translations_unique_locale
    UNIQUE (division_id, locale),
  CONSTRAINT divisions_translations_locale_not_es
    CHECK (locale <> 'es')
);

CREATE INDEX IF NOT EXISTS divisions_translations_locale_idx ON divisions_translations(locale);
CREATE INDEX IF NOT EXISTS divisions_translations_division_id_idx ON divisions_translations(division_id);

-- Canonical initial division. We intentionally pin DIA to id=1 so existing
-- union writes can use a DB default during the compatibility window.
INSERT INTO divisions (division_id, code, name, abbreviation, active, created_at, modified_at)
VALUES (1, 'DIA', 'División Interamericana', 'DIA', TRUE, NOW(), NOW())
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    abbreviation = EXCLUDED.abbreviation,
    active = TRUE,
    modified_at = NOW();

SELECT setval(
  pg_get_serial_sequence('divisions', 'division_id'),
  GREATEST((SELECT COALESCE(MAX(division_id), 1) FROM divisions), 1),
  TRUE
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Current hierarchy FK: unions -> divisions
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE unions ADD COLUMN IF NOT EXISTS division_id INTEGER;

UPDATE unions
SET division_id = 1,
    modified_at = NOW()
WHERE division_id IS NULL;

ALTER TABLE unions ALTER COLUMN division_id SET DEFAULT 1;
ALTER TABLE unions ALTER COLUMN division_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unions_division_id_fkey'
  ) THEN
    ALTER TABLE unions
      ADD CONSTRAINT unions_division_id_fkey
      FOREIGN KEY (division_id)
      REFERENCES divisions(division_id)
      ON DELETE RESTRICT
      ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_unions_division_id ON unions(division_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Effective-dated relationship history tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS union_division_history (
  union_division_history_id BIGSERIAL PRIMARY KEY,
  union_id    INTEGER NOT NULL REFERENCES unions(union_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  division_id INTEGER NOT NULL REFERENCES divisions(division_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  valid_from  DATE NOT NULL,
  valid_to    DATE,
  precision   VARCHAR(30) NOT NULL DEFAULT 'system_backfill',
  created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE NO ACTION,

  CONSTRAINT union_division_history_period_chk
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT union_division_history_precision_chk
    CHECK (precision IN ('exact','day','month','year','system_backfill','unknown'))
);

CREATE TABLE IF NOT EXISTS local_field_union_history (
  local_field_union_history_id BIGSERIAL PRIMARY KEY,
  local_field_id INTEGER NOT NULL REFERENCES local_fields(local_field_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  union_id       INTEGER NOT NULL REFERENCES unions(union_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  valid_from     DATE NOT NULL,
  valid_to       DATE,
  precision      VARCHAR(30) NOT NULL DEFAULT 'system_backfill',
  created_at     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  created_by     UUID REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE NO ACTION,

  CONSTRAINT local_field_union_history_period_chk
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT local_field_union_history_precision_chk
    CHECK (precision IN ('exact','day','month','year','system_backfill','unknown'))
);

CREATE TABLE IF NOT EXISTS district_local_field_history (
  district_local_field_history_id BIGSERIAL PRIMARY KEY,
  districlub_type_id INTEGER NOT NULL REFERENCES districts(districlub_type_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  local_field_id     INTEGER NOT NULL REFERENCES local_fields(local_field_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  valid_from         DATE NOT NULL,
  valid_to           DATE,
  precision          VARCHAR(30) NOT NULL DEFAULT 'system_backfill',
  created_at         TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  created_by         UUID REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE NO ACTION,

  CONSTRAINT district_local_field_history_period_chk
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT district_local_field_history_precision_chk
    CHECK (precision IN ('exact','day','month','year','system_backfill','unknown'))
);

CREATE TABLE IF NOT EXISTS church_district_history (
  church_district_history_id BIGSERIAL PRIMARY KEY,
  church_id          INTEGER NOT NULL REFERENCES churches(church_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  districlub_type_id INTEGER NOT NULL REFERENCES districts(districlub_type_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  valid_from         DATE NOT NULL,
  valid_to           DATE,
  precision          VARCHAR(30) NOT NULL DEFAULT 'system_backfill',
  created_at         TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  created_by         UUID REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE NO ACTION,

  CONSTRAINT church_district_history_period_chk
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT church_district_history_precision_chk
    CHECK (precision IN ('exact','day','month','year','system_backfill','unknown'))
);

CREATE TABLE IF NOT EXISTS club_institutional_history (
  club_institutional_history_id BIGSERIAL PRIMARY KEY,
  club_id            INTEGER NOT NULL REFERENCES clubs(club_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  division_id        INTEGER NOT NULL REFERENCES divisions(division_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  union_id           INTEGER NOT NULL REFERENCES unions(union_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  local_field_id     INTEGER NOT NULL REFERENCES local_fields(local_field_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  districlub_type_id INTEGER NOT NULL REFERENCES districts(districlub_type_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  church_id          INTEGER NOT NULL REFERENCES churches(church_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  valid_from         DATE NOT NULL,
  valid_to           DATE,
  precision          VARCHAR(30) NOT NULL DEFAULT 'system_backfill',
  created_at         TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  created_by         UUID REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE NO ACTION,

  CONSTRAINT club_institutional_history_period_chk
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT club_institutional_history_precision_chk
    CHECK (precision IN ('exact','day','month','year','system_backfill','unknown'))
);

CREATE TABLE IF NOT EXISTS hierarchy_contexts (
  hierarchy_context_id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  division_id          INTEGER NOT NULL REFERENCES divisions(division_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  union_id             INTEGER REFERENCES unions(union_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  local_field_id       INTEGER REFERENCES local_fields(local_field_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  districlub_type_id   INTEGER REFERENCES districts(districlub_type_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  church_id            INTEGER REFERENCES churches(church_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  club_id              INTEGER REFERENCES clubs(club_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  as_of                TIMESTAMPTZ(6) NOT NULL,
  source               VARCHAR(40) NOT NULL,
  precision            VARCHAR(30) NOT NULL DEFAULT 'system_backfill',
  context              JSONB,
  created_at           TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  created_by           UUID REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE NO ACTION,

  CONSTRAINT hierarchy_contexts_source_chk
    CHECK (source IN ('current','as_of','snapshot','system_backfill')),
  CONSTRAINT hierarchy_contexts_precision_chk
    CHECK (precision IN ('exact','day','month','year','system_backfill','unknown'))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Backfill history from current FKs. All backfilled intervals are open and
--    explicitly marked with unknown historical precision.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO union_division_history (union_id, division_id, valid_from, valid_to, precision)
SELECT u.union_id,
       u.division_id,
       COALESCE(u.created_at::date, DATE '2026-01-01'),
       NULL,
       'system_backfill'
FROM unions u
WHERE NOT EXISTS (
  SELECT 1
  FROM union_division_history h
  WHERE h.union_id = u.union_id
    AND h.valid_to IS NULL
);

INSERT INTO local_field_union_history (local_field_id, union_id, valid_from, valid_to, precision)
SELECT lf.local_field_id,
       lf.union_id,
       COALESCE(lf.created_at::date, DATE '2026-01-01'),
       NULL,
       'system_backfill'
FROM local_fields lf
WHERE NOT EXISTS (
  SELECT 1
  FROM local_field_union_history h
  WHERE h.local_field_id = lf.local_field_id
    AND h.valid_to IS NULL
);

INSERT INTO district_local_field_history (districlub_type_id, local_field_id, valid_from, valid_to, precision)
SELECT d.districlub_type_id,
       d.local_field_id,
       COALESCE(d.created_at::date, DATE '2026-01-01'),
       NULL,
       'system_backfill'
FROM districts d
WHERE NOT EXISTS (
  SELECT 1
  FROM district_local_field_history h
  WHERE h.districlub_type_id = d.districlub_type_id
    AND h.valid_to IS NULL
);

INSERT INTO church_district_history (church_id, districlub_type_id, valid_from, valid_to, precision)
SELECT c.church_id,
       c.districlub_type_id,
       COALESCE(c.created_at::date, DATE '2026-01-01'),
       NULL,
       'system_backfill'
FROM churches c
WHERE NOT EXISTS (
  SELECT 1
  FROM church_district_history h
  WHERE h.church_id = c.church_id
    AND h.valid_to IS NULL
);

INSERT INTO club_institutional_history (
  club_id,
  division_id,
  union_id,
  local_field_id,
  districlub_type_id,
  church_id,
  valid_from,
  valid_to,
  precision
)
SELECT c.club_id,
       u.division_id,
       lf.union_id,
       c.local_field_id,
       c.districlub_type_id,
       c.church_id,
       COALESCE(c.created_at::date, DATE '2026-01-01'),
       NULL,
       'system_backfill'
FROM clubs c
JOIN local_fields lf ON lf.local_field_id = c.local_field_id
JOIN unions u ON u.union_id = lf.union_id
WHERE NOT EXISTS (
  SELECT 1
  FROM club_institutional_history h
  WHERE h.club_id = c.club_id
    AND h.valid_to IS NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Indexes, one-open-interval guards and anti-overlap constraints.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_union_division_history_division_id
  ON union_division_history(division_id);
CREATE INDEX IF NOT EXISTS idx_union_division_history_union_period
  ON union_division_history(union_id, valid_from, valid_to);
CREATE UNIQUE INDEX IF NOT EXISTS uq_union_division_history_open
  ON union_division_history(union_id)
  WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_local_field_union_history_union_id
  ON local_field_union_history(union_id);
CREATE INDEX IF NOT EXISTS idx_local_field_union_history_field_period
  ON local_field_union_history(local_field_id, valid_from, valid_to);
CREATE UNIQUE INDEX IF NOT EXISTS uq_local_field_union_history_open
  ON local_field_union_history(local_field_id)
  WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_district_local_field_history_field_id
  ON district_local_field_history(local_field_id);
CREATE INDEX IF NOT EXISTS idx_district_local_field_history_district_period
  ON district_local_field_history(districlub_type_id, valid_from, valid_to);
CREATE UNIQUE INDEX IF NOT EXISTS uq_district_local_field_history_open
  ON district_local_field_history(districlub_type_id)
  WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_church_district_history_district_id
  ON church_district_history(districlub_type_id);
CREATE INDEX IF NOT EXISTS idx_church_district_history_church_period
  ON church_district_history(church_id, valid_from, valid_to);
CREATE UNIQUE INDEX IF NOT EXISTS uq_church_district_history_open
  ON church_district_history(church_id)
  WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_club_institutional_history_division_id
  ON club_institutional_history(division_id);
CREATE INDEX IF NOT EXISTS idx_club_institutional_history_union_id
  ON club_institutional_history(union_id);
CREATE INDEX IF NOT EXISTS idx_club_institutional_history_local_field_id
  ON club_institutional_history(local_field_id);
CREATE INDEX IF NOT EXISTS idx_club_institutional_history_district_id
  ON club_institutional_history(districlub_type_id);
CREATE INDEX IF NOT EXISTS idx_club_institutional_history_church_id
  ON club_institutional_history(church_id);
CREATE INDEX IF NOT EXISTS idx_club_institutional_history_club_period
  ON club_institutional_history(club_id, valid_from, valid_to);
CREATE UNIQUE INDEX IF NOT EXISTS uq_club_institutional_history_open
  ON club_institutional_history(club_id)
  WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_hierarchy_contexts_division_as_of
  ON hierarchy_contexts(division_id, as_of);
CREATE INDEX IF NOT EXISTS idx_hierarchy_contexts_union_as_of
  ON hierarchy_contexts(union_id, as_of);
CREATE INDEX IF NOT EXISTS idx_hierarchy_contexts_local_field_as_of
  ON hierarchy_contexts(local_field_id, as_of);
CREATE INDEX IF NOT EXISTS idx_hierarchy_contexts_district_as_of
  ON hierarchy_contexts(districlub_type_id, as_of);
CREATE INDEX IF NOT EXISTS idx_hierarchy_contexts_church_as_of
  ON hierarchy_contexts(church_id, as_of);
CREATE INDEX IF NOT EXISTS idx_hierarchy_contexts_club_as_of
  ON hierarchy_contexts(club_id, as_of);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'union_division_history_no_overlap') THEN
    ALTER TABLE union_division_history
      ADD CONSTRAINT union_division_history_no_overlap
      EXCLUDE USING gist (
        union_id WITH =,
        daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'local_field_union_history_no_overlap') THEN
    ALTER TABLE local_field_union_history
      ADD CONSTRAINT local_field_union_history_no_overlap
      EXCLUDE USING gist (
        local_field_id WITH =,
        daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'district_local_field_history_no_overlap') THEN
    ALTER TABLE district_local_field_history
      ADD CONSTRAINT district_local_field_history_no_overlap
      EXCLUDE USING gist (
        districlub_type_id WITH =,
        daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'church_district_history_no_overlap') THEN
    ALTER TABLE church_district_history
      ADD CONSTRAINT church_district_history_no_overlap
      EXCLUDE USING gist (
        church_id WITH =,
        daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'club_institutional_history_no_overlap') THEN
    ALTER TABLE club_institutional_history
      ADD CONSTRAINT club_institutional_history_no_overlap
      EXCLUDE USING gist (
        club_id WITH =,
        daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
      );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Scoring category ownership: replace DIVISION origin_id=0 sentinel.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE scoring_categories
SET origin_id = 1,
    modified_at = NOW()
WHERE origin_level = 'DIVISION'
  AND origin_id = 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scoring_categories_origin_id_positive_chk'
  ) THEN
    ALTER TABLE scoring_categories
      ADD CONSTRAINT scoring_categories_origin_id_positive_chk
      CHECK (origin_id > 0);
  END IF;
END $$;

COMMIT;

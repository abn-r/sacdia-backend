-- Migration: 20260723120000_institutional_history_foundation
-- Date: 2026-07-23
--
-- Adds bitemporal recording metadata to institutional relationship history,
-- typed name versions, and an append-only reorganization/lineage ledger.
-- Authority is WORLD_CHURCH_EXECUTIVE only; no resolution or file payload fields.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Reorganization ledger (referenced by history revisions)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE institutional_reorganizations (
  reorganization_id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  type VARCHAR(32) NOT NULL,
  effective_on DATE NOT NULL,
  description TEXT NOT NULL,
  authority_source VARCHAR(64) NOT NULL DEFAULT 'WORLD_CHURCH_EXECUTIVE',
  idempotency_key UUID NOT NULL,
  approved_by UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  recorded_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  corrects_reorganization_id UUID NULL,

  CONSTRAINT institutional_reorganizations_type_chk
    CHECK (type IN (
      'ESTABLISHMENT',
      'RENAME',
      'TRANSFER',
      'SPLIT',
      'MERGE',
      'CLOSURE',
      'CORRECTION'
    )),
  CONSTRAINT institutional_reorganizations_authority_source_chk
    CHECK (authority_source = 'WORLD_CHURCH_EXECUTIVE'),
  CONSTRAINT institutional_reorganizations_idempotency_key_uq
    UNIQUE (idempotency_key),
  CONSTRAINT institutional_reorganizations_corrects_fkey
    FOREIGN KEY (corrects_reorganization_id)
    REFERENCES institutional_reorganizations(reorganization_id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION
);

CREATE INDEX idx_institutional_reorganizations_effective_on
  ON institutional_reorganizations(effective_on);
CREATE INDEX idx_institutional_reorganizations_corrects
  ON institutional_reorganizations(corrects_reorganization_id);

CREATE TABLE institutional_reorganization_participants (
  participant_id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  reorganization_id UUID NOT NULL
    REFERENCES institutional_reorganizations(reorganization_id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION,
  division_id INTEGER NULL
    REFERENCES divisions(division_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  union_id INTEGER NULL
    REFERENCES unions(union_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  local_field_id INTEGER NULL
    REFERENCES local_fields(local_field_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  districlub_type_id INTEGER NULL
    REFERENCES districts(districlub_type_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  church_id INTEGER NULL
    REFERENCES churches(church_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  club_id INTEGER NULL
    REFERENCES clubs(club_id) ON DELETE RESTRICT ON UPDATE NO ACTION,

  CONSTRAINT institutional_reorganization_participants_entity_xor_chk
    CHECK (
      (
        (CASE WHEN division_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN union_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN local_field_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN districlub_type_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN church_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN club_id IS NOT NULL THEN 1 ELSE 0 END)
      ) = 1
    )
);

CREATE INDEX idx_institutional_reorg_participants_reorganization
  ON institutional_reorganization_participants(reorganization_id);
CREATE INDEX idx_institutional_reorg_participants_division
  ON institutional_reorganization_participants(division_id)
  WHERE division_id IS NOT NULL;
CREATE INDEX idx_institutional_reorg_participants_union
  ON institutional_reorganization_participants(union_id)
  WHERE union_id IS NOT NULL;
CREATE INDEX idx_institutional_reorg_participants_local_field
  ON institutional_reorganization_participants(local_field_id)
  WHERE local_field_id IS NOT NULL;
CREATE INDEX idx_institutional_reorg_participants_district
  ON institutional_reorganization_participants(districlub_type_id)
  WHERE districlub_type_id IS NOT NULL;
CREATE INDEX idx_institutional_reorg_participants_church
  ON institutional_reorganization_participants(church_id)
  WHERE church_id IS NOT NULL;
CREATE INDEX idx_institutional_reorg_participants_club
  ON institutional_reorganization_participants(club_id)
  WHERE club_id IS NOT NULL;

CREATE TABLE institutional_lineage_edges (
  lineage_edge_id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  reorganization_id UUID NOT NULL
    REFERENCES institutional_reorganizations(reorganization_id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION,
  from_participant_id UUID NOT NULL
    REFERENCES institutional_reorganization_participants(participant_id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION,
  to_participant_id UUID NOT NULL
    REFERENCES institutional_reorganization_participants(participant_id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION,
  relation_type VARCHAR(32) NOT NULL,

  CONSTRAINT institutional_lineage_edges_relation_type_chk
    CHECK (relation_type IN (
      'SPLIT_FROM',
      'MERGED_FROM',
      'CONTINUES_AS',
      'CORRECTS'
    )),
  CONSTRAINT institutional_lineage_edges_distinct_participants_chk
    CHECK (from_participant_id <> to_participant_id)
);

CREATE INDEX idx_institutional_lineage_edges_reorganization
  ON institutional_lineage_edges(reorganization_id);
CREATE INDEX idx_institutional_lineage_edges_from
  ON institutional_lineage_edges(from_participant_id);
CREATE INDEX idx_institutional_lineage_edges_to
  ON institutional_lineage_edges(to_participant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Bitemporal columns on existing relationship history
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE union_division_history
  ADD COLUMN recorded_from TIMESTAMPTZ(6),
  ADD COLUMN recorded_to TIMESTAMPTZ(6),
  ADD COLUMN supersedes_history_id BIGINT,
  ADD COLUMN reorganization_id UUID;

UPDATE union_division_history
SET recorded_from = created_at
WHERE recorded_from IS NULL;

ALTER TABLE union_division_history
  ALTER COLUMN recorded_from SET DEFAULT NOW(),
  ALTER COLUMN recorded_from SET NOT NULL;

ALTER TABLE union_division_history
  ADD CONSTRAINT union_division_history_supersedes_fkey
    FOREIGN KEY (supersedes_history_id)
    REFERENCES union_division_history(union_division_history_id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION,
  ADD CONSTRAINT union_division_history_reorganization_fkey
    FOREIGN KEY (reorganization_id)
    REFERENCES institutional_reorganizations(reorganization_id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION,
  ADD CONSTRAINT union_division_history_recorded_period_chk
    CHECK (recorded_to IS NULL OR recorded_to >= recorded_from);

ALTER TABLE local_field_union_history
  ADD COLUMN recorded_from TIMESTAMPTZ(6),
  ADD COLUMN recorded_to TIMESTAMPTZ(6),
  ADD COLUMN supersedes_history_id BIGINT,
  ADD COLUMN reorganization_id UUID;

UPDATE local_field_union_history
SET recorded_from = created_at
WHERE recorded_from IS NULL;

ALTER TABLE local_field_union_history
  ALTER COLUMN recorded_from SET DEFAULT NOW(),
  ALTER COLUMN recorded_from SET NOT NULL;

ALTER TABLE local_field_union_history
  ADD CONSTRAINT local_field_union_history_supersedes_fkey
    FOREIGN KEY (supersedes_history_id)
    REFERENCES local_field_union_history(local_field_union_history_id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION,
  ADD CONSTRAINT local_field_union_history_reorganization_fkey
    FOREIGN KEY (reorganization_id)
    REFERENCES institutional_reorganizations(reorganization_id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION,
  ADD CONSTRAINT local_field_union_history_recorded_period_chk
    CHECK (recorded_to IS NULL OR recorded_to >= recorded_from);

ALTER TABLE district_local_field_history
  ADD COLUMN recorded_from TIMESTAMPTZ(6),
  ADD COLUMN recorded_to TIMESTAMPTZ(6),
  ADD COLUMN supersedes_history_id BIGINT,
  ADD COLUMN reorganization_id UUID;

UPDATE district_local_field_history
SET recorded_from = created_at
WHERE recorded_from IS NULL;

ALTER TABLE district_local_field_history
  ALTER COLUMN recorded_from SET DEFAULT NOW(),
  ALTER COLUMN recorded_from SET NOT NULL;

ALTER TABLE district_local_field_history
  ADD CONSTRAINT district_local_field_history_supersedes_fkey
    FOREIGN KEY (supersedes_history_id)
    REFERENCES district_local_field_history(district_local_field_history_id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION,
  ADD CONSTRAINT district_local_field_history_reorganization_fkey
    FOREIGN KEY (reorganization_id)
    REFERENCES institutional_reorganizations(reorganization_id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION,
  ADD CONSTRAINT district_local_field_history_recorded_period_chk
    CHECK (recorded_to IS NULL OR recorded_to >= recorded_from);

ALTER TABLE church_district_history
  ADD COLUMN recorded_from TIMESTAMPTZ(6),
  ADD COLUMN recorded_to TIMESTAMPTZ(6),
  ADD COLUMN supersedes_history_id BIGINT,
  ADD COLUMN reorganization_id UUID;

UPDATE church_district_history
SET recorded_from = created_at
WHERE recorded_from IS NULL;

ALTER TABLE church_district_history
  ALTER COLUMN recorded_from SET DEFAULT NOW(),
  ALTER COLUMN recorded_from SET NOT NULL;

ALTER TABLE church_district_history
  ADD CONSTRAINT church_district_history_supersedes_fkey
    FOREIGN KEY (supersedes_history_id)
    REFERENCES church_district_history(church_district_history_id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION,
  ADD CONSTRAINT church_district_history_reorganization_fkey
    FOREIGN KEY (reorganization_id)
    REFERENCES institutional_reorganizations(reorganization_id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION,
  ADD CONSTRAINT church_district_history_recorded_period_chk
    CHECK (recorded_to IS NULL OR recorded_to >= recorded_from);

ALTER TABLE club_institutional_history
  ADD COLUMN recorded_from TIMESTAMPTZ(6),
  ADD COLUMN recorded_to TIMESTAMPTZ(6),
  ADD COLUMN supersedes_history_id BIGINT,
  ADD COLUMN reorganization_id UUID;

UPDATE club_institutional_history
SET recorded_from = created_at
WHERE recorded_from IS NULL;

ALTER TABLE club_institutional_history
  ALTER COLUMN recorded_from SET DEFAULT NOW(),
  ALTER COLUMN recorded_from SET NOT NULL;

ALTER TABLE club_institutional_history
  ADD CONSTRAINT club_institutional_history_supersedes_fkey
    FOREIGN KEY (supersedes_history_id)
    REFERENCES club_institutional_history(club_institutional_history_id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION,
  ADD CONSTRAINT club_institutional_history_reorganization_fkey
    FOREIGN KEY (reorganization_id)
    REFERENCES institutional_reorganizations(reorganization_id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION,
  ADD CONSTRAINT club_institutional_history_recorded_period_chk
    CHECK (recorded_to IS NULL OR recorded_to >= recorded_from);

-- Replace open-interval uniqueness and overlap guards so corrections can keep
-- superseded rows while only current knowledge (recorded_to IS NULL) competes.
DROP INDEX IF EXISTS uq_union_division_history_open;
DROP INDEX IF EXISTS uq_local_field_union_history_open;
DROP INDEX IF EXISTS uq_district_local_field_history_open;
DROP INDEX IF EXISTS uq_church_district_history_open;
DROP INDEX IF EXISTS uq_club_institutional_history_open;

ALTER TABLE union_division_history DROP CONSTRAINT IF EXISTS union_division_history_no_overlap;
ALTER TABLE local_field_union_history DROP CONSTRAINT IF EXISTS local_field_union_history_no_overlap;
ALTER TABLE district_local_field_history DROP CONSTRAINT IF EXISTS district_local_field_history_no_overlap;
ALTER TABLE church_district_history DROP CONSTRAINT IF EXISTS church_district_history_no_overlap;
ALTER TABLE club_institutional_history DROP CONSTRAINT IF EXISTS club_institutional_history_no_overlap;

CREATE UNIQUE INDEX uq_union_division_history_open
  ON union_division_history(union_id)
  WHERE recorded_to IS NULL AND valid_to IS NULL;
CREATE UNIQUE INDEX uq_local_field_union_history_open
  ON local_field_union_history(local_field_id)
  WHERE recorded_to IS NULL AND valid_to IS NULL;
CREATE UNIQUE INDEX uq_district_local_field_history_open
  ON district_local_field_history(districlub_type_id)
  WHERE recorded_to IS NULL AND valid_to IS NULL;
CREATE UNIQUE INDEX uq_church_district_history_open
  ON church_district_history(church_id)
  WHERE recorded_to IS NULL AND valid_to IS NULL;
CREATE UNIQUE INDEX uq_club_institutional_history_open
  ON club_institutional_history(club_id)
  WHERE recorded_to IS NULL AND valid_to IS NULL;

ALTER TABLE union_division_history
  ADD CONSTRAINT union_division_history_no_overlap
  EXCLUDE USING gist (
    union_id WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
  ) WHERE (recorded_to IS NULL);

ALTER TABLE local_field_union_history
  ADD CONSTRAINT local_field_union_history_no_overlap
  EXCLUDE USING gist (
    local_field_id WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
  ) WHERE (recorded_to IS NULL);

ALTER TABLE district_local_field_history
  ADD CONSTRAINT district_local_field_history_no_overlap
  EXCLUDE USING gist (
    districlub_type_id WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
  ) WHERE (recorded_to IS NULL);

ALTER TABLE church_district_history
  ADD CONSTRAINT church_district_history_no_overlap
  EXCLUDE USING gist (
    church_id WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
  ) WHERE (recorded_to IS NULL);

ALTER TABLE club_institutional_history
  ADD CONSTRAINT club_institutional_history_no_overlap
  EXCLUDE USING gist (
    club_id WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
  ) WHERE (recorded_to IS NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Referentially safe name versions (typed XOR FKs, no polymorphic entity_id)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE institutional_name_versions (
  name_version_id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  division_id INTEGER NULL
    REFERENCES divisions(division_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  union_id INTEGER NULL
    REFERENCES unions(union_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  local_field_id INTEGER NULL
    REFERENCES local_fields(local_field_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  districlub_type_id INTEGER NULL
    REFERENCES districts(districlub_type_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  church_id INTEGER NULL
    REFERENCES churches(church_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  club_id INTEGER NULL
    REFERENCES clubs(club_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  name VARCHAR(200) NOT NULL,
  abbreviation VARCHAR(32),
  valid_from DATE NOT NULL,
  valid_to DATE,
  precision VARCHAR(30) NOT NULL DEFAULT 'system_backfill',
  recorded_from TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  recorded_to TIMESTAMPTZ(6),
  supersedes_name_version_id UUID,
  reorganization_id UUID
    REFERENCES institutional_reorganizations(reorganization_id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION,
  recorded_by UUID
    REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE NO ACTION,

  CONSTRAINT institutional_name_versions_entity_xor_chk
    CHECK (
      (
        (CASE WHEN division_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN union_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN local_field_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN districlub_type_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN church_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN club_id IS NOT NULL THEN 1 ELSE 0 END)
      ) = 1
    ),
  CONSTRAINT institutional_name_versions_period_chk
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT institutional_name_versions_recorded_period_chk
    CHECK (recorded_to IS NULL OR recorded_to >= recorded_from),
  CONSTRAINT institutional_name_versions_precision_chk
    CHECK (precision IN ('exact','day','month','year','system_backfill','unknown')),
  CONSTRAINT institutional_name_versions_supersedes_fkey
    FOREIGN KEY (supersedes_name_version_id)
    REFERENCES institutional_name_versions(name_version_id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX uq_institutional_name_versions_division_open
  ON institutional_name_versions(division_id)
  WHERE division_id IS NOT NULL AND recorded_to IS NULL AND valid_to IS NULL;
CREATE UNIQUE INDEX uq_institutional_name_versions_union_open
  ON institutional_name_versions(union_id)
  WHERE union_id IS NOT NULL AND recorded_to IS NULL AND valid_to IS NULL;
CREATE UNIQUE INDEX uq_institutional_name_versions_local_field_open
  ON institutional_name_versions(local_field_id)
  WHERE local_field_id IS NOT NULL AND recorded_to IS NULL AND valid_to IS NULL;
CREATE UNIQUE INDEX uq_institutional_name_versions_district_open
  ON institutional_name_versions(districlub_type_id)
  WHERE districlub_type_id IS NOT NULL AND recorded_to IS NULL AND valid_to IS NULL;
CREATE UNIQUE INDEX uq_institutional_name_versions_church_open
  ON institutional_name_versions(church_id)
  WHERE church_id IS NOT NULL AND recorded_to IS NULL AND valid_to IS NULL;
CREATE UNIQUE INDEX uq_institutional_name_versions_club_open
  ON institutional_name_versions(club_id)
  WHERE club_id IS NOT NULL AND recorded_to IS NULL AND valid_to IS NULL;

ALTER TABLE institutional_name_versions
  ADD CONSTRAINT institutional_name_versions_division_no_overlap
  EXCLUDE USING gist (
    division_id WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
  ) WHERE (division_id IS NOT NULL AND recorded_to IS NULL);

ALTER TABLE institutional_name_versions
  ADD CONSTRAINT institutional_name_versions_union_no_overlap
  EXCLUDE USING gist (
    union_id WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
  ) WHERE (union_id IS NOT NULL AND recorded_to IS NULL);

ALTER TABLE institutional_name_versions
  ADD CONSTRAINT institutional_name_versions_local_field_no_overlap
  EXCLUDE USING gist (
    local_field_id WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
  ) WHERE (local_field_id IS NOT NULL AND recorded_to IS NULL);

ALTER TABLE institutional_name_versions
  ADD CONSTRAINT institutional_name_versions_district_no_overlap
  EXCLUDE USING gist (
    districlub_type_id WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
  ) WHERE (districlub_type_id IS NOT NULL AND recorded_to IS NULL);

ALTER TABLE institutional_name_versions
  ADD CONSTRAINT institutional_name_versions_church_no_overlap
  EXCLUDE USING gist (
    church_id WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
  ) WHERE (church_id IS NOT NULL AND recorded_to IS NULL);

ALTER TABLE institutional_name_versions
  ADD CONSTRAINT institutional_name_versions_club_no_overlap
  EXCLUDE USING gist (
    club_id WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
  ) WHERE (club_id IS NOT NULL AND recorded_to IS NULL);

CREATE TABLE institutional_name_version_translations (
  id BIGSERIAL PRIMARY KEY,
  name_version_id UUID NOT NULL
    REFERENCES institutional_name_versions(name_version_id)
    ON DELETE CASCADE
    ON UPDATE NO ACTION,
  locale VARCHAR(10) NOT NULL,
  name TEXT,
  abbreviation TEXT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

  CONSTRAINT institutional_name_version_translations_locale_not_es
    CHECK (locale <> 'es'),
  CONSTRAINT institutional_name_version_translations_unique_locale
    UNIQUE (name_version_id, locale)
);

CREATE INDEX idx_institutional_name_version_translations_locale
  ON institutional_name_version_translations(locale);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Append-only protection for ledger tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION prevent_institutional_ledger_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'institutional ledger table % is append-only',
    TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_institutional_reorganizations_append_only
  BEFORE UPDATE OR DELETE ON institutional_reorganizations
  FOR EACH ROW
  EXECUTE FUNCTION prevent_institutional_ledger_mutation();

CREATE TRIGGER trg_institutional_reorganization_participants_append_only
  BEFORE UPDATE OR DELETE ON institutional_reorganization_participants
  FOR EACH ROW
  EXECUTE FUNCTION prevent_institutional_ledger_mutation();

CREATE TRIGGER trg_institutional_lineage_edges_append_only
  BEFORE UPDATE OR DELETE ON institutional_lineage_edges
  FOR EACH ROW
  EXECUTE FUNCTION prevent_institutional_ledger_mutation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Conservative name-version backfill from current projections only
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO institutional_name_versions (
  division_id, name, abbreviation, valid_from, valid_to, precision, recorded_from
)
SELECT d.division_id,
       d.name,
       d.abbreviation,
       COALESCE(d.created_at::date, CURRENT_DATE),
       NULL,
       'system_backfill',
       COALESCE(d.created_at, NOW())
FROM divisions d
WHERE NOT EXISTS (
  SELECT 1
  FROM institutional_name_versions n
  WHERE n.division_id = d.division_id
    AND n.recorded_to IS NULL
    AND n.valid_to IS NULL
);

INSERT INTO institutional_name_versions (
  union_id, name, abbreviation, valid_from, valid_to, precision, recorded_from
)
SELECT u.union_id,
       u.name,
       u.abbreviation,
       COALESCE(u.created_at::date, CURRENT_DATE),
       NULL,
       'system_backfill',
       COALESCE(u.created_at, NOW())
FROM unions u
WHERE NOT EXISTS (
  SELECT 1
  FROM institutional_name_versions n
  WHERE n.union_id = u.union_id
    AND n.recorded_to IS NULL
    AND n.valid_to IS NULL
);

INSERT INTO institutional_name_versions (
  local_field_id, name, abbreviation, valid_from, valid_to, precision, recorded_from
)
SELECT lf.local_field_id,
       lf.name,
       lf.abbreviation,
       COALESCE(lf.created_at::date, CURRENT_DATE),
       NULL,
       'system_backfill',
       COALESCE(lf.created_at, NOW())
FROM local_fields lf
WHERE NOT EXISTS (
  SELECT 1
  FROM institutional_name_versions n
  WHERE n.local_field_id = lf.local_field_id
    AND n.recorded_to IS NULL
    AND n.valid_to IS NULL
);

INSERT INTO institutional_name_versions (
  districlub_type_id, name, abbreviation, valid_from, valid_to, precision, recorded_from
)
SELECT d.districlub_type_id,
       d.name,
       NULL,
       COALESCE(d.created_at::date, CURRENT_DATE),
       NULL,
       'system_backfill',
       COALESCE(d.created_at, NOW())
FROM districts d
WHERE NOT EXISTS (
  SELECT 1
  FROM institutional_name_versions n
  WHERE n.districlub_type_id = d.districlub_type_id
    AND n.recorded_to IS NULL
    AND n.valid_to IS NULL
);

INSERT INTO institutional_name_versions (
  church_id, name, abbreviation, valid_from, valid_to, precision, recorded_from
)
SELECT c.church_id,
       c.name,
       NULL,
       COALESCE(c.created_at::date, CURRENT_DATE),
       NULL,
       'system_backfill',
       COALESCE(c.created_at, NOW())
FROM churches c
WHERE NOT EXISTS (
  SELECT 1
  FROM institutional_name_versions n
  WHERE n.church_id = c.church_id
    AND n.recorded_to IS NULL
    AND n.valid_to IS NULL
);

INSERT INTO institutional_name_versions (
  club_id, name, abbreviation, valid_from, valid_to, precision, recorded_from
)
SELECT c.club_id,
       c.name,
       NULL,
       COALESCE(c.created_at::date, CURRENT_DATE),
       NULL,
       'system_backfill',
       COALESCE(c.created_at, NOW())
FROM clubs c
WHERE NOT EXISTS (
  SELECT 1
  FROM institutional_name_versions n
  WHERE n.club_id = c.club_id
    AND n.recorded_to IS NULL
    AND n.valid_to IS NULL
);

INSERT INTO institutional_name_version_translations (
  name_version_id, locale, name, abbreviation
)
SELECT n.name_version_id, t.locale, t.name, NULL
FROM institutional_name_versions n
JOIN divisions_translations t ON t.division_id = n.division_id
WHERE n.division_id IS NOT NULL
  AND n.recorded_to IS NULL
  AND n.valid_to IS NULL
ON CONFLICT (name_version_id, locale) DO NOTHING;

INSERT INTO institutional_name_version_translations (
  name_version_id, locale, name, abbreviation
)
SELECT n.name_version_id, t.locale, t.name, NULL
FROM institutional_name_versions n
JOIN unions_translations t ON t.union_id = n.union_id
WHERE n.union_id IS NOT NULL
  AND n.recorded_to IS NULL
  AND n.valid_to IS NULL
ON CONFLICT (name_version_id, locale) DO NOTHING;

INSERT INTO institutional_name_version_translations (
  name_version_id, locale, name, abbreviation
)
SELECT n.name_version_id, t.locale, t.name, NULL
FROM institutional_name_versions n
JOIN local_fields_translations t ON t.local_field_id = n.local_field_id
WHERE n.local_field_id IS NOT NULL
  AND n.recorded_to IS NULL
  AND n.valid_to IS NULL
ON CONFLICT (name_version_id, locale) DO NOTHING;

INSERT INTO institutional_name_version_translations (
  name_version_id, locale, name, abbreviation
)
SELECT n.name_version_id, t.locale, t.name, NULL
FROM institutional_name_versions n
JOIN districts_translations t ON t.districlub_type_id = n.districlub_type_id
WHERE n.districlub_type_id IS NOT NULL
  AND n.recorded_to IS NULL
  AND n.valid_to IS NULL
ON CONFLICT (name_version_id, locale) DO NOTHING;

INSERT INTO institutional_name_version_translations (
  name_version_id, locale, name, abbreviation
)
SELECT n.name_version_id, t.locale, t.name, NULL
FROM institutional_name_versions n
JOIN churches_translations t ON t.church_id = n.church_id
WHERE n.church_id IS NOT NULL
  AND n.recorded_to IS NULL
  AND n.valid_to IS NULL
ON CONFLICT (name_version_id, locale) DO NOTHING;

COMMIT;

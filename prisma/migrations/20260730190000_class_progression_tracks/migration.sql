BEGIN;

CREATE TYPE formative_program_type_enum AS ENUM ('STANDARD', 'GUIDE_MAJOR');

ALTER TABLE classes
  ADD COLUMN formative_program_type formative_program_type_enum NOT NULL DEFAULT 'STANDARD';

CREATE INDEX idx_classes_formative_program_type
  ON classes (formative_program_type);

CREATE TABLE class_progression_tracks (
  class_progression_track_id SERIAL PRIMARY KEY,
  club_type_id INTEGER NOT NULL UNIQUE REFERENCES club_types(club_type_id) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX idx_class_progression_tracks_active
  ON class_progression_tracks (active);

CREATE TABLE class_progression_track_transitions (
  class_progression_track_transition_id SERIAL PRIMARY KEY,
  from_track_id INTEGER NOT NULL REFERENCES class_progression_tracks(class_progression_track_id) ON DELETE RESTRICT,
  to_track_id INTEGER NOT NULL REFERENCES class_progression_tracks(class_progression_track_id) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT class_progression_track_transition_unique UNIQUE (from_track_id, to_track_id),
  CONSTRAINT class_progression_track_transition_distinct_check CHECK (from_track_id <> to_track_id)
);

CREATE INDEX idx_class_progression_transitions_from_active
  ON class_progression_track_transitions (from_track_id, active);

-- The reviewed asset-code catalog is the stable identity; class names are never used.
UPDATE classes
SET formative_program_type = 'GUIDE_MAJOR'
WHERE asset_code IN ('GM-01', 'GM-02', 'GM-03');

INSERT INTO class_progression_tracks (club_type_id)
SELECT DISTINCT club_type_id
FROM classes
ON CONFLICT (club_type_id) DO NOTHING;

-- Only catalog-approved crossover boundaries are configured. Missing rows stay fail-closed.
INSERT INTO class_progression_track_transitions (from_track_id, to_track_id)
SELECT source_track.class_progression_track_id, target_track.class_progression_track_id
FROM classes source_class
JOIN classes target_class ON source_class.asset_code = 'AV-06' AND target_class.asset_code = 'CQ-01'
JOIN class_progression_tracks source_track ON source_track.club_type_id = source_class.club_type_id
JOIN class_progression_tracks target_track ON target_track.club_type_id = target_class.club_type_id
WHERE source_class.asset_code = 'AV-06'
ON CONFLICT (from_track_id, to_track_id) DO NOTHING;

INSERT INTO class_progression_track_transitions (from_track_id, to_track_id)
SELECT source_track.class_progression_track_id, target_track.class_progression_track_id
FROM classes source_class
JOIN classes target_class ON source_class.asset_code = 'CQ-06' AND target_class.asset_code = 'GM-01'
JOIN class_progression_tracks source_track ON source_track.club_type_id = source_class.club_type_id
JOIN class_progression_tracks target_track ON target_track.club_type_id = target_class.club_type_id
WHERE source_class.asset_code = 'CQ-06'
ON CONFLICT (from_track_id, to_track_id) DO NOTHING;

COMMIT;

-- Club sections are typed slots of the parent club, not named sub-clubs.
-- Backfill missing catalog types (inactive) then drop club_sections.name.

BEGIN;

INSERT INTO club_sections (main_club_id, club_type_id, active)
SELECT c.club_id, ct.club_type_id, false
FROM clubs c
CROSS JOIN club_types ct
WHERE ct.active = true
  AND c.club_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM club_sections cs
    WHERE cs.main_club_id = c.club_id
      AND cs.club_type_id = ct.club_type_id
  );

ALTER TABLE club_sections DROP COLUMN IF EXISTS name;

COMMIT;

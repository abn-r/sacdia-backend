-- The honor catalog import flagged requirements whose text carries a number
-- ("Escoger 3 palabras…", "Coleccionar 300 tarjetas…") as "choose N" groups,
-- but they have no sub-items: 232 rows on 2026-11-05. A choice group with no
-- children can never be satisfied, so members could not finish those honors.
--
-- They are plain requirements: clear the choice flags. Groups that do have
-- sub-items are left alone, even when choice_min exceeds them (2 rows, for a
-- manual review).
--
-- Data-only and idempotent: a re-run finds no rows.

UPDATE honor_requirements AS r
SET is_choice_group = false,
    choice_min = NULL,
    modified_at = now()
WHERE r.is_choice_group = true
  AND NOT EXISTS (
    SELECT 1
    FROM honor_requirements AS child
    WHERE child.parent_id = r.requirement_id
      AND child.active = true
  );

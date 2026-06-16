-- Backfill legacy approved honors created before completion_mode existed.
-- Approved honors with legacy external artifacts should not remain UNDECIDED;
-- otherwise clients render an impossible "choose a mode" state in the history.
UPDATE users_honors uh
SET completion_mode = 'EXTERNAL'::honor_completion_mode_enum
WHERE uh.validation_status = 'APPROVED'::honor_validation_status_enum
  AND uh.completion_mode = 'UNDECIDED'::honor_completion_mode_enum
  AND (
    NULLIF(uh.document, '') IS NOT NULL
    OR NULLIF(uh.certificate, '') IS NOT NULL
    OR jsonb_array_length(COALESCE(uh.images::jsonb, '[]'::jsonb)) > 0
    OR EXISTS (
      SELECT 1
      FROM evidence_files ef
      WHERE ef.user_honor_id = uh.user_honor_id
        AND ef.active = true
    )
  );

-- Eager backfill: ensure every (annual_folder × template section) pair has an evaluation row.
-- Dev data may be empty, but this migration must be idempotent for any existing rows.
-- PK uses gen_random_uuid() (confirmed via \d annual_folder_section_evaluations).
INSERT INTO "annual_folder_section_evaluations" (
  "evaluation_id",
  "annual_folder_id",
  "section_id",
  "earned_points",
  "max_points",
  "notes",
  "status",
  "created_at",
  "modified_at"
)
SELECT
  gen_random_uuid(),
  f."annual_folder_id",
  s."section_id",
  0,
  s."max_points",
  NULL,
  'PENDING'::"annual_folder_section_status_enum",
  NOW(),
  NOW()
FROM "annual_folders" f
JOIN "folder_template_sections" s
  ON s."folder_template_id" = f."folder_template_id"
WHERE NOT EXISTS (
  SELECT 1
  FROM "annual_folder_section_evaluations" e
  WHERE e."annual_folder_id" = f."annual_folder_id"
    AND e."section_id" = s."section_id"
);

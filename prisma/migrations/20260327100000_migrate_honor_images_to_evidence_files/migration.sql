-- ============================================================
-- Migration: migrate_honor_images_to_evidence_files
-- Copies image URLs stored in users_honors.images (JSON array)
-- into the normalized evidence_files table via user_honor_id FK.
--
-- Design decisions:
--   - Idempotent: skips users_honors records that already have
--     evidence_files rows (user_honor_id is not null).
--   - Dual-read period: does NOT remove users_honors.images.
--     The JSON column stays as backup until a future cleanup migration.
--   - MIME type is inferred from URL file extension. Defaults to
--     'image/jpeg' for unknown or missing extensions.
--   - file_name is extracted as the last path segment of the URL,
--     falling back to 'image-<n>' when no filename is present.
--   - uploaded_at uses users_honors.created_at when available,
--     otherwise NOW().
-- ============================================================

INSERT INTO evidence_files (
  user_honor_id,
  file_url,
  file_name,
  file_type,
  uploaded_by_id,
  uploaded_at,
  active
)
SELECT
  uh.user_honor_id,

  -- Raw URL string extracted from the JSON element.
  -- Each element may be a plain string or an object {"url": "..."},
  -- so we try string cast first, then fall back to ->> 'url'.
  CASE
    WHEN jsonb_typeof(img_element) = 'string' THEN img_element #>> '{}'
    ELSE img_element ->> 'url'
  END AS file_url,

  -- Extract filename from the last URL path segment.
  -- Example: "https://cdn.example.com/r2/foto-1.jpg" -> "foto-1.jpg"
  -- Falls back to 'honor-image' when the segment is empty.
  COALESCE(
    NULLIF(
      regexp_replace(
        CASE
          WHEN jsonb_typeof(img_element) = 'string' THEN img_element #>> '{}'
          ELSE img_element ->> 'url'
        END,
        '^.*/([^/?#]+)([?#].*)?$', '\1'
      ),
      CASE
        WHEN jsonb_typeof(img_element) = 'string' THEN img_element #>> '{}'
        ELSE img_element ->> 'url'
      END
    ),
    'honor-image'
  ) AS file_name,

  -- Infer MIME type from the file extension in the URL.
  CASE
    WHEN lower(
      CASE
        WHEN jsonb_typeof(img_element) = 'string' THEN img_element #>> '{}'
        ELSE img_element ->> 'url'
      END
    ) ~ '\.(jpe?g)([?#].*)?$' THEN 'image/jpeg'
    WHEN lower(
      CASE
        WHEN jsonb_typeof(img_element) = 'string' THEN img_element #>> '{}'
        ELSE img_element ->> 'url'
      END
    ) ~ '\.png([?#].*)?$' THEN 'image/png'
    WHEN lower(
      CASE
        WHEN jsonb_typeof(img_element) = 'string' THEN img_element #>> '{}'
        ELSE img_element ->> 'url'
      END
    ) ~ '\.gif([?#].*)?$' THEN 'image/gif'
    WHEN lower(
      CASE
        WHEN jsonb_typeof(img_element) = 'string' THEN img_element #>> '{}'
        ELSE img_element ->> 'url'
      END
    ) ~ '\.webp([?#].*)?$' THEN 'image/webp'
    WHEN lower(
      CASE
        WHEN jsonb_typeof(img_element) = 'string' THEN img_element #>> '{}'
        ELSE img_element ->> 'url'
      END
    ) ~ '\.heic([?#].*)?$' THEN 'image/heic'
    ELSE 'image/jpeg'
  END AS file_type,

  -- Use the honor owner as the uploader.
  uh.user_id AS uploaded_by_id,

  -- Prefer the record's own created_at; fall back to current time.
  COALESCE(uh.created_at, NOW()) AS uploaded_at,

  TRUE AS active

FROM users_honors uh,
     -- Expand the JSON array. jsonb_array_elements requires a jsonb value;
     -- the images column is declared as json so we cast it.
     jsonb_array_elements(
       CASE
         WHEN uh.images IS NULL THEN '[]'::jsonb
         ELSE uh.images::jsonb
       END
     ) AS img_element

WHERE
  -- Only process records that have at least one image URL.
  uh.images IS NOT NULL
  AND uh.images::text <> '[]'
  AND uh.images::text <> 'null'

  -- Skip malformed JSON gracefully: jsonb cast above will error if
  -- images is not valid JSON. We guard by attempting the cast inside
  -- a WHERE clause that filters to array-type values only.
  AND jsonb_typeof(uh.images::jsonb) = 'array'

  -- Idempotency guard: skip if evidence_files rows already exist
  -- for this user_honor_id (re-running is safe).
  AND NOT EXISTS (
    SELECT 1
    FROM evidence_files ef
    WHERE ef.user_honor_id = uh.user_honor_id
  )

  -- Only migrate records with a non-empty URL string inside the element.
  AND (
    (jsonb_typeof(img_element) = 'string' AND img_element #>> '{}' <> '')
    OR
    (jsonb_typeof(img_element) <> 'string' AND img_element ->> 'url' IS NOT NULL AND img_element ->> 'url' <> '')
  );

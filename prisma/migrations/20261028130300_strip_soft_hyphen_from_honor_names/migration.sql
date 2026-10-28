-- Strip invisible soft hyphens (U+00AD) from honor names.
--
-- QA found the honor "Albañilería" stored with U+00AD between "í" and "a",
-- which breaks search and exact-name matching. The value only exists in the
-- database (no committed seed carries it), so it is cleaned here.
--
-- chr(173) is U+00AD in a UTF8 database. Written as chr() so the migration
-- itself stays free of invisible characters.
--
-- Idempotent: the WHERE clauses only match rows that still contain the
-- character, so a second run touches nothing.

UPDATE honors
SET name = replace(name, chr(173), ''),
    modified_at = now()
WHERE position(chr(173) in name) > 0;

UPDATE honors_translations
SET name = replace(name, chr(173), '')
WHERE name IS NOT NULL
  AND position(chr(173) in name) > 0;

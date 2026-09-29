-- Inclusive ecclesiastical periods must not overlap.
-- Adjacent ranges such as 2004-12-31 and 2005-01-01 remain valid.
-- Creating a historical period does not activate it; that rule stays in the
-- catalog service. This constraint only rejects intersecting ranges.
--
-- Dry-run before applying on a database that already has years:
-- SELECT a.year_id, b.year_id
-- FROM ecclesiastical_years a
-- JOIN ecclesiastical_years b
--   ON a.year_id < b.year_id
--  AND daterange(a.start_date, a.end_date, '[]')
--      && daterange(b.start_date, b.end_date, '[]');

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE ecclesiastical_years
  DROP CONSTRAINT IF EXISTS ecclesiastical_years_no_overlap;

ALTER TABLE ecclesiastical_years
  ADD CONSTRAINT ecclesiastical_years_no_overlap
  EXCLUDE USING gist (
    daterange(start_date, end_date, '[]') WITH &&
  );

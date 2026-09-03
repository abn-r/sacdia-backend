-- Allow one regular active enrollment plus one cross-type enrollment per
-- (user, ecclesiastical year). Cross-type is the invested Guía Mayor privilege
-- to catch up Aventureros/Conquistadores classes in the same year.
--
-- Replaces uniq_enrollments_active_user_year, which forbade any second active
-- row and blocked that privilege.

DROP INDEX IF EXISTS uniq_enrollments_active_user_year;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_enrollments_active_user_year_regular
  ON enrollments (user_id, ecclesiastical_year_id)
  WHERE active = true AND cross_type_enrollment = false;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_enrollments_active_user_year_cross_type
  ON enrollments (user_id, ecclesiastical_year_id)
  WHERE active = true AND cross_type_enrollment = true;

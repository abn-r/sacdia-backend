-- A pastor's district investiture assignment only counts while the pastor
-- belongs to the district's Field. When the pastor changes Field (or loses it,
-- as account deletion does) or the district moves to another Field, the
-- assignment is deactivated; until the district gets a new pastor the Field
-- director-lf / assistant-lf authorize (fieldAuthorizesSection). Reactivation
-- stays governed by the FIELD_MISMATCH check in DistrictInvestiturePastorService.assign.
--
-- users.local_field_id is written from several code paths, so the rule lives
-- in the database instead of being patched into each one. The triggers only
-- clear `active`; rows are never deleted and the quota slot is freed because
-- the quota counts active rows.

CREATE OR REPLACE FUNCTION drop_district_pastors_on_user_field_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE district_investiture_pastors dip
  SET active = false,
      modified_at = now()
  FROM districts d
  WHERE dip.user_id = NEW.user_id
    AND dip.active
    AND d.districlub_type_id = dip.districlub_type_id
    AND d.local_field_id IS DISTINCT FROM NEW.local_field_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_drop_district_pastors_on_field_change ON users;
CREATE TRIGGER trg_users_drop_district_pastors_on_field_change
  AFTER UPDATE OF local_field_id ON users
  FOR EACH ROW
  WHEN (OLD.local_field_id IS DISTINCT FROM NEW.local_field_id)
  EXECUTE FUNCTION drop_district_pastors_on_user_field_change();

CREATE OR REPLACE FUNCTION drop_district_pastors_on_district_field_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE district_investiture_pastors dip
  SET active = false,
      modified_at = now()
  FROM users u
  WHERE dip.districlub_type_id = NEW.districlub_type_id
    AND dip.active
    AND u.user_id = dip.user_id
    AND u.local_field_id IS DISTINCT FROM NEW.local_field_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_districts_drop_district_pastors_on_field_change ON districts;
CREATE TRIGGER trg_districts_drop_district_pastors_on_field_change
  AFTER UPDATE OF local_field_id ON districts
  FOR EACH ROW
  WHEN (OLD.local_field_id IS DISTINCT FROM NEW.local_field_id)
  EXECUTE FUNCTION drop_district_pastors_on_district_field_change();

-- One-off backfill: deactivate active assignments that already cross Fields.
UPDATE district_investiture_pastors dip
SET active = false,
    modified_at = now()
FROM districts d, users u
WHERE dip.active
  AND d.districlub_type_id = dip.districlub_type_id
  AND u.user_id = dip.user_id
  AND u.local_field_id IS DISTINCT FROM d.local_field_id;

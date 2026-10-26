-- Persist the extended inventory item fields the mobile form already collects
-- (condition, serial number, purchase date, estimated value, location,
-- responsible person and notes). Until now the API silently dropped them.
--
-- All columns are additive. Existing rows get condition = 'bueno' (the default)
-- and NULL in the rest, so no backfill is needed.

ALTER TABLE club_inventory
  ADD COLUMN condition       VARCHAR(10)   NOT NULL DEFAULT 'bueno',
  ADD COLUMN serial_number   VARCHAR(100),
  ADD COLUMN purchase_date   DATE,
  ADD COLUMN estimated_value DECIMAL(12,2),
  ADD COLUMN location        VARCHAR(150),
  ADD COLUMN assigned_to     VARCHAR(150),
  ADD COLUMN notes           TEXT;

ALTER TABLE club_inventory
  ADD CONSTRAINT club_inventory_condition_check
    CHECK (condition IN ('bueno', 'regular', 'malo')),
  ADD CONSTRAINT club_inventory_estimated_value_check
    CHECK (estimated_value IS NULL OR estimated_value >= 0);

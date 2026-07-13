-- Camporee lifecycle and timezone audit.
-- Existing rows receive the provisional IANA timezone through the DEFAULT;
-- verification fields intentionally remain NULL. Existing dates and deadlines
-- are not rewritten.

ALTER TABLE "local_camporees"
  ADD COLUMN "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Mexico_City',
  ADD COLUMN "timezone_verified_at" TIMESTAMPTZ(6),
  ADD COLUMN "timezone_verified_by" UUID,
  ADD COLUMN "club_registration_opens_at" TIMESTAMPTZ(6);

ALTER TABLE "union_camporees"
  ADD COLUMN "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Mexico_City',
  ADD COLUMN "timezone_verified_at" TIMESTAMPTZ(6),
  ADD COLUMN "timezone_verified_by" UUID,
  ADD COLUMN "club_registration_opens_at" TIMESTAMPTZ(6);

ALTER TABLE "local_camporees"
  ADD CONSTRAINT "fk_local_camporees_timezone_verified_by"
  FOREIGN KEY ("timezone_verified_by") REFERENCES "users"("user_id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "union_camporees"
  ADD CONSTRAINT "fk_union_camporees_timezone_verified_by"
  FOREIGN KEY ("timezone_verified_by") REFERENCES "users"("user_id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX "idx_local_camporees_timezone_verified_by"
  ON "local_camporees"("timezone_verified_by");

CREATE INDEX "idx_union_camporees_timezone_verified_by"
  ON "union_camporees"("timezone_verified_by");

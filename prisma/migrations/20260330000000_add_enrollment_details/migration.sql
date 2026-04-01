-- AlterTable: Add new fields to club_enrollments
ALTER TABLE "club_enrollments"
  ADD COLUMN "latitude"               DOUBLE PRECISION,
  ADD COLUMN "longitude"              DOUBLE PRECISION,
  ADD COLUMN "meeting_schedule"       JSONB,
  ADD COLUMN "souls_target"           INTEGER,
  ADD COLUMN "fee"                    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "fee_amount"             DECIMAL(10,2),
  ADD COLUMN "director_id"            UUID,
  ADD COLUMN "deputy_director_ids"    UUID[],
  ADD COLUMN "secretary_id"           UUID,
  ADD COLUMN "treasurer_id"           UUID,
  ADD COLUMN "secretary_treasurer_id" UUID;

-- AddForeignKey: director_id -> users
ALTER TABLE "club_enrollments"
  ADD CONSTRAINT "club_enrollments_director_id_fkey"
  FOREIGN KEY ("director_id") REFERENCES "users"("user_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey: secretary_id -> users
ALTER TABLE "club_enrollments"
  ADD CONSTRAINT "club_enrollments_secretary_id_fkey"
  FOREIGN KEY ("secretary_id") REFERENCES "users"("user_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey: treasurer_id -> users
ALTER TABLE "club_enrollments"
  ADD CONSTRAINT "club_enrollments_treasurer_id_fkey"
  FOREIGN KEY ("treasurer_id") REFERENCES "users"("user_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey: secretary_treasurer_id -> users
ALTER TABLE "club_enrollments"
  ADD CONSTRAINT "club_enrollments_secretary_treasurer_id_fkey"
  FOREIGN KEY ("secretary_treasurer_id") REFERENCES "users"("user_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

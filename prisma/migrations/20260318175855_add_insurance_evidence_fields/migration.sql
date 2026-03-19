ALTER TABLE "member_insurances"
  ADD COLUMN "evidence_file_url" VARCHAR(500),
  ADD COLUMN "evidence_file_name" VARCHAR(255),
  ADD COLUMN "created_by_id" UUID,
  ADD COLUMN "modified_by_id" UUID;

ALTER TABLE "member_insurances"
  ADD CONSTRAINT "member_insurances_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("user_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "member_insurances"
  ADD CONSTRAINT "member_insurances_modified_by_id_fkey"
    FOREIGN KEY ("modified_by_id") REFERENCES "users"("user_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;

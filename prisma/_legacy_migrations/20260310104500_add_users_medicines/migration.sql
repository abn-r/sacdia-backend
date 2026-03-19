-- Normalize medicines catalog defaults for runtime activation
UPDATE "medicines"
SET "active" = TRUE
WHERE "active" IS NULL;

UPDATE "medicines"
SET "modified_at" = NOW()
WHERE "modified_at" IS NULL;

ALTER TABLE "medicines"
ALTER COLUMN "active" SET NOT NULL,
ALTER COLUMN "active" SET DEFAULT TRUE,
ALTER COLUMN "modified_at" SET NOT NULL,
ALTER COLUMN "modified_at" SET DEFAULT NOW();

-- Add user-to-medicines sensitive relation
CREATE TABLE "users_medicines" (
  "user_medicine_id" SERIAL NOT NULL,
  "user_id" UUID NOT NULL,
  "medicine_id" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,

  CONSTRAINT "user_medicines_pkey" PRIMARY KEY ("user_medicine_id"),
  CONSTRAINT "user_medicines_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("user_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "user_medicines_medicine_id_fkey"
    FOREIGN KEY ("medicine_id") REFERENCES "medicines"("medicine_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "user_medicines_user_id_medicine_id_key"
ON "users_medicines"("user_id", "medicine_id");

CREATE INDEX "idx_users_medicines_user_id"
ON "users_medicines"("user_id");

CREATE INDEX "idx_users_medicines_medicine_id"
ON "users_medicines"("medicine_id");

CREATE TABLE "investiture_pastor_quota" (
    "quota_id" INTEGER NOT NULL DEFAULT 1,
    "slots" INTEGER NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investiture_pastor_quota_pkey" PRIMARY KEY ("quota_id")
);

ALTER TABLE "investiture_pastor_quota"
ADD CONSTRAINT "investiture_pastor_quota_singleton_check"
CHECK ("quota_id" = 1);

ALTER TABLE "investiture_pastor_quota"
ADD CONSTRAINT "investiture_pastor_quota_slots_check"
CHECK ("slots" >= 0);

CREATE TABLE "district_investiture_pastors" (
    "districlub_type_id" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assigned_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "district_investiture_pastors_pkey" PRIMARY KEY ("districlub_type_id","user_id")
);

CREATE INDEX "idx_district_investiture_pastors_active"
ON "district_investiture_pastors" ("districlub_type_id", "active");

ALTER TABLE "district_investiture_pastors"
ADD CONSTRAINT "district_investiture_pastors_districlub_type_id_fkey"
FOREIGN KEY ("districlub_type_id") REFERENCES "districts"("districlub_type_id") ON DELETE CASCADE ON UPDATE NO ACTION;

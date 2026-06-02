ALTER TYPE "investiture_status_enum" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "investiture_action_enum" ADD VALUE IF NOT EXISTS 'EXPIRED';

ALTER TABLE "classes"
  ADD COLUMN "available_from_year_id" INTEGER,
  ADD COLUMN "available_until_year_id" INTEGER,
  ADD COLUMN "min_duration_years" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "max_duration_years" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "classes"
  ADD CONSTRAINT "classes_available_from_year_id_fkey"
    FOREIGN KEY ("available_from_year_id") REFERENCES "ecclesiastical_years"("year_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "classes_available_until_year_id_fkey"
    FOREIGN KEY ("available_until_year_id") REFERENCES "ecclesiastical_years"("year_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "classes_min_duration_years_check"
    CHECK ("min_duration_years" >= 1),
  ADD CONSTRAINT "classes_max_duration_years_check"
    CHECK ("max_duration_years" >= 1),
  ADD CONSTRAINT "classes_duration_years_order_check"
    CHECK ("max_duration_years" >= "min_duration_years");

CREATE INDEX "idx_classes_available_from_year" ON "classes"("available_from_year_id");
CREATE INDEX "idx_classes_available_until_year" ON "classes"("available_until_year_id");

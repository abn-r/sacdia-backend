CREATE TABLE "local_field_class_thresholds" (
    "local_field_id" INTEGER NOT NULL,
    "ecclesiastical_year_id" INTEGER NOT NULL,
    "minimum_percent" INTEGER NOT NULL DEFAULT 80,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_field_class_thresholds_pkey" PRIMARY KEY ("local_field_id","ecclesiastical_year_id")
);

ALTER TABLE "local_field_class_thresholds"
ADD CONSTRAINT "local_field_class_thresholds_minimum_percent_check"
CHECK ("minimum_percent" >= 0 AND "minimum_percent" <= 100);

ALTER TABLE "local_field_class_thresholds"
ADD CONSTRAINT "local_field_class_thresholds_local_field_id_fkey"
FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "local_field_class_thresholds"
ADD CONSTRAINT "local_field_class_thresholds_ecclesiastical_year_id_fkey"
FOREIGN KEY ("ecclesiastical_year_id") REFERENCES "ecclesiastical_years"("year_id") ON DELETE CASCADE ON UPDATE NO ACTION;

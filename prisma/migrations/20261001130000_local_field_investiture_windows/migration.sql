CREATE TABLE "local_field_investiture_windows" (
    "local_field_id" INTEGER NOT NULL,
    "ecclesiastical_year_id" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_field_investiture_windows_pkey" PRIMARY KEY ("local_field_id","ecclesiastical_year_id")
);

ALTER TABLE "local_field_investiture_windows"
ADD CONSTRAINT "local_field_investiture_windows_range_check"
CHECK ("start_date" <= "end_date");

ALTER TABLE "local_field_investiture_windows"
ADD CONSTRAINT "local_field_investiture_windows_local_field_id_fkey"
FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "local_field_investiture_windows"
ADD CONSTRAINT "local_field_investiture_windows_ecclesiastical_year_id_fkey"
FOREIGN KEY ("ecclesiastical_year_id") REFERENCES "ecclesiastical_years"("year_id") ON DELETE CASCADE ON UPDATE NO ACTION;

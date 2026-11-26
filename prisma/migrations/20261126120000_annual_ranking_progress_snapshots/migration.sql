-- Annual-progress snapshots: one row per club enrollment (section + year) with the
-- live annual-progress points computed by the nightly rankings job. Territory
-- supervision reads these rows instead of scoring every section on request.
-- Derived data only: every FK cascades (config SET NULL). Strictly additive.
-- Render runs `prisma migrate deploy` at the END OF THE BUILD. Re-runnable.

CREATE TABLE IF NOT EXISTS "annual_ranking_progress_snapshots" (
    "club_enrollment_id" UUID NOT NULL,
    "ecclesiastical_year_id" INTEGER NOT NULL,
    "club_section_id" INTEGER NOT NULL,
    "club_id" INTEGER NOT NULL,
    "club_type_id" INTEGER NOT NULL,
    "local_field_id" INTEGER NOT NULL,
    "annual_ranking_config_id" UUID,
    "current_points" INTEGER NOT NULL,
    "max_points" INTEGER NOT NULL,
    "calculated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "annual_ranking_progress_snapshots_pkey" PRIMARY KEY ("club_enrollment_id"),
    CONSTRAINT "annual_ranking_progress_snapshots_club_enrollment_id_fkey"
        FOREIGN KEY ("club_enrollment_id") REFERENCES "club_enrollments"("club_enrollment_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "annual_ranking_progress_snapshots_ecclesiastical_year_id_fkey"
        FOREIGN KEY ("ecclesiastical_year_id") REFERENCES "ecclesiastical_years"("year_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "annual_ranking_progress_snapshots_club_section_id_fkey"
        FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "annual_ranking_progress_snapshots_club_id_fkey"
        FOREIGN KEY ("club_id") REFERENCES "clubs"("club_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "annual_ranking_progress_snapshots_club_type_id_fkey"
        FOREIGN KEY ("club_type_id") REFERENCES "club_types"("club_type_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "annual_ranking_progress_snapshots_local_field_id_fkey"
        FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "annual_ranking_progress_snapshots_annual_ranking_config_id_fkey"
        FOREIGN KEY ("annual_ranking_config_id") REFERENCES "annual_ranking_configs"("annual_ranking_config_id")
        ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_annual_ranking_progress_snapshots_year_local_field"
    ON "annual_ranking_progress_snapshots"("ecclesiastical_year_id", "local_field_id");

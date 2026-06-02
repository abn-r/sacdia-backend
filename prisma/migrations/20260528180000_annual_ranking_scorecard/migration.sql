-- Annual ranking scorecard configuration
-- Global recognition tiers are percentage bands.
-- Annual maximum points are configured per local field + ecclesiastical year + club type.

CREATE TABLE "ranking_tiers" (
  "ranking_tier_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(100) NOT NULL,
  "slug" VARCHAR(80) NOT NULL,
  "band_percentage" DECIMAL(5,2) NOT NULL,
  "color" VARCHAR(20),
  "icon" VARCHAR(100),
  "sort_order" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "ranking_tiers_pkey" PRIMARY KEY ("ranking_tier_id"),
  CONSTRAINT "ranking_tiers_slug_key" UNIQUE ("slug"),
  CONSTRAINT "ranking_tiers_band_percentage_check"
    CHECK ("band_percentage" > 0 AND "band_percentage" <= 100)
);

CREATE UNIQUE INDEX "ranking_tiers_active_sort_order_unique"
  ON "ranking_tiers" ("sort_order")
  WHERE "active" = true;

CREATE INDEX "idx_ranking_tiers_active_order"
  ON "ranking_tiers" ("active", "sort_order");

CREATE TABLE "annual_ranking_configs" (
  "annual_ranking_config_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "local_field_id" INTEGER NOT NULL,
  "ecclesiastical_year_id" INTEGER NOT NULL,
  "club_type_id" INTEGER NOT NULL,
  "max_points" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" UUID,
  "updated_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "annual_ranking_configs_pkey" PRIMARY KEY ("annual_ranking_config_id"),
  CONSTRAINT "annual_ranking_configs_max_points_check"
    CHECK ("max_points" > 0),
  CONSTRAINT "annual_ranking_configs_unique_scope"
    UNIQUE ("local_field_id", "ecclesiastical_year_id", "club_type_id"),
  CONSTRAINT "annual_ranking_configs_local_field_id_fkey"
    FOREIGN KEY ("local_field_id") REFERENCES "local_fields" ("local_field_id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "annual_ranking_configs_ecclesiastical_year_id_fkey"
    FOREIGN KEY ("ecclesiastical_year_id") REFERENCES "ecclesiastical_years" ("year_id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "annual_ranking_configs_club_type_id_fkey"
    FOREIGN KEY ("club_type_id") REFERENCES "club_types" ("club_type_id")
    ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX "idx_annual_ranking_configs_year_type"
  ON "annual_ranking_configs" ("ecclesiastical_year_id", "club_type_id");

CREATE INDEX "idx_annual_ranking_configs_active"
  ON "annual_ranking_configs" ("active");

CREATE TABLE "annual_ranking_component_configs" (
  "annual_ranking_component_config_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "annual_ranking_config_id" UUID NOT NULL,
  "component_key" VARCHAR(50) NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "max_points" INTEGER NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "annual_ranking_component_configs_pkey"
    PRIMARY KEY ("annual_ranking_component_config_id"),
  CONSTRAINT "annual_ranking_component_configs_max_points_check"
    CHECK ("max_points" > 0),
  CONSTRAINT "annual_ranking_component_configs_unique_component"
    UNIQUE ("annual_ranking_config_id", "component_key"),
  CONSTRAINT "annual_ranking_component_configs_config_id_fkey"
    FOREIGN KEY ("annual_ranking_config_id")
    REFERENCES "annual_ranking_configs" ("annual_ranking_config_id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX "idx_annual_ranking_component_configs_active_order"
  ON "annual_ranking_component_configs" ("active", "sort_order");

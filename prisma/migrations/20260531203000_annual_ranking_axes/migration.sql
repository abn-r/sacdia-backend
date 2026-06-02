-- Annual ranking axes
-- Splits annual ranking configuration into administrative and operational
-- budgets while preserving existing component point assignments.

CREATE TABLE "annual_ranking_axis_configs" (
  "annual_ranking_axis_config_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "annual_ranking_config_id" UUID NOT NULL,
  "axis_key" VARCHAR(50) NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "max_points" INTEGER NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "annual_ranking_axis_configs_pkey"
    PRIMARY KEY ("annual_ranking_axis_config_id"),
  CONSTRAINT "annual_ranking_axis_configs_max_points_check"
    CHECK ("max_points" > 0),
  CONSTRAINT "annual_ranking_axis_configs_unique_axis"
    UNIQUE ("annual_ranking_config_id", "axis_key"),
  CONSTRAINT "annual_ranking_axis_configs_config_id_fkey"
    FOREIGN KEY ("annual_ranking_config_id")
    REFERENCES "annual_ranking_configs" ("annual_ranking_config_id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX "idx_annual_ranking_axis_configs_active_order"
  ON "annual_ranking_axis_configs" ("active", "sort_order");

CREATE INDEX "idx_annual_ranking_axis_configs_config_active_order"
  ON "annual_ranking_axis_configs" (
    "annual_ranking_config_id",
    "active",
    "sort_order"
  );

ALTER TABLE "annual_ranking_component_configs"
  ADD COLUMN "annual_ranking_axis_config_id" UUID;

WITH "axis_points" AS (
  SELECT
    "config"."annual_ranking_config_id",
    "config"."max_points",
    COALESCE(SUM("component"."max_points") FILTER (
      WHERE "component"."active" = true
        AND "component"."component_key" IN (
          'annual_folder',
          'annual_evidence_folder',
          'monthly_reports_timeliness',
          'finance',
          'finance_compliance',
          'institutional_data_completeness'
        )
    ), 0)::INTEGER AS "administrative_points",
    COALESCE(SUM("component"."max_points") FILTER (
      WHERE "component"."active" = true
        AND "component"."component_key" IN (
          'activities_registered',
          'attendance_participation',
          'camporee',
          'camporee_events',
          'class_investiture_progress',
          'sacdia_operational_usage'
        )
    ), 0)::INTEGER AS "operational_points"
  FROM "annual_ranking_configs" AS "config"
  LEFT JOIN "annual_ranking_component_configs" AS "component"
    ON "component"."annual_ranking_config_id" =
      "config"."annual_ranking_config_id"
  GROUP BY "config"."annual_ranking_config_id", "config"."max_points"
)
INSERT INTO "annual_ranking_axis_configs" (
  "annual_ranking_config_id",
  "axis_key",
  "label",
  "max_points",
  "sort_order"
)
SELECT
  "annual_ranking_config_id",
  'administrative',
  'Cumplimiento Administrativo',
  CASE
    WHEN "administrative_points" > 0 THEN "administrative_points"
    ELSE CEIL("max_points"::NUMERIC / 2)::INTEGER
  END,
  1
FROM "axis_points"
WHERE "administrative_points" > 0
   OR ("administrative_points" = 0 AND "operational_points" = 0);

WITH "axis_points" AS (
  SELECT
    "config"."annual_ranking_config_id",
    "config"."max_points",
    COALESCE(SUM("component"."max_points") FILTER (
      WHERE "component"."active" = true
        AND "component"."component_key" IN (
          'annual_folder',
          'annual_evidence_folder',
          'monthly_reports_timeliness',
          'finance',
          'finance_compliance',
          'institutional_data_completeness'
        )
    ), 0)::INTEGER AS "administrative_points",
    COALESCE(SUM("component"."max_points") FILTER (
      WHERE "component"."active" = true
        AND "component"."component_key" IN (
          'activities_registered',
          'attendance_participation',
          'camporee',
          'camporee_events',
          'class_investiture_progress',
          'sacdia_operational_usage'
        )
    ), 0)::INTEGER AS "operational_points"
  FROM "annual_ranking_configs" AS "config"
  LEFT JOIN "annual_ranking_component_configs" AS "component"
    ON "component"."annual_ranking_config_id" =
      "config"."annual_ranking_config_id"
  GROUP BY "config"."annual_ranking_config_id", "config"."max_points"
)
INSERT INTO "annual_ranking_axis_configs" (
  "annual_ranking_config_id",
  "axis_key",
  "label",
  "max_points",
  "sort_order"
)
SELECT
  "annual_ranking_config_id",
  'operational',
  'Vida Operativa del Club',
  CASE
    WHEN "operational_points" > 0 THEN "operational_points"
    ELSE "max_points" - CEIL("max_points"::NUMERIC / 2)::INTEGER
  END,
  2
FROM "axis_points"
WHERE "operational_points" > 0
   OR (
    "administrative_points" = 0
    AND "operational_points" = 0
    AND "max_points" > 1
  );

UPDATE "annual_ranking_component_configs" AS "component"
SET "annual_ranking_axis_config_id" =
  "axis"."annual_ranking_axis_config_id"
FROM "annual_ranking_axis_configs" AS "axis"
WHERE "axis"."annual_ranking_config_id" =
    "component"."annual_ranking_config_id"
  AND "axis"."axis_key" = 'administrative'
  AND "component"."component_key" IN (
    'annual_folder',
    'annual_evidence_folder',
    'monthly_reports_timeliness',
    'finance',
    'finance_compliance',
    'institutional_data_completeness'
  );

UPDATE "annual_ranking_component_configs" AS "component"
SET "annual_ranking_axis_config_id" =
  "axis"."annual_ranking_axis_config_id"
FROM "annual_ranking_axis_configs" AS "axis"
WHERE "axis"."annual_ranking_config_id" =
    "component"."annual_ranking_config_id"
  AND "axis"."axis_key" = 'operational'
  AND "component"."component_key" IN (
    'activities_registered',
    'attendance_participation',
    'camporee',
    'camporee_events',
    'class_investiture_progress',
    'sacdia_operational_usage'
  );

-- Unknown component keys are not silently assigned to an axis.
-- They are disabled for manual remediation and keep the nullable FK.
UPDATE "annual_ranking_component_configs"
SET "active" = false
WHERE "annual_ranking_axis_config_id" IS NULL;

ALTER TABLE "annual_ranking_component_configs"
  ADD CONSTRAINT "annual_ranking_component_configs_axis_id_fkey"
  FOREIGN KEY ("annual_ranking_axis_config_id")
  REFERENCES "annual_ranking_axis_configs" ("annual_ranking_axis_config_id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE INDEX "idx_annual_ranking_component_configs_axis_id"
  ON "annual_ranking_component_configs" ("annual_ranking_axis_config_id");

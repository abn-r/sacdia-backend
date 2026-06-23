-- Hierarchical annual ranking configs
-- Ranking budgets can be owned by either a Union or a Local Field.
-- Union configs take precedence over Local Field configs for fields under that Union.

ALTER TABLE "annual_ranking_configs"
  ADD COLUMN "union_id" INTEGER;

ALTER TABLE "annual_ranking_configs"
  ALTER COLUMN "local_field_id" DROP NOT NULL;

ALTER TABLE "annual_ranking_configs"
  ADD CONSTRAINT "annual_ranking_configs_union_id_fkey"
  FOREIGN KEY ("union_id") REFERENCES "unions" ("union_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "annual_ranking_configs"
  ADD CONSTRAINT "annual_ranking_configs_exactly_one_scope_check"
  CHECK (num_nonnulls("union_id", "local_field_id") = 1);

ALTER TABLE "annual_ranking_configs"
  DROP CONSTRAINT IF EXISTS "annual_ranking_configs_unique_scope";

CREATE UNIQUE INDEX "annual_ranking_configs_unique_union_scope"
  ON "annual_ranking_configs" ("union_id", "ecclesiastical_year_id", "club_type_id")
  WHERE "union_id" IS NOT NULL;

CREATE UNIQUE INDEX "annual_ranking_configs_unique_local_field_scope"
  ON "annual_ranking_configs" ("local_field_id", "ecclesiastical_year_id", "club_type_id")
  WHERE "local_field_id" IS NOT NULL;

CREATE INDEX "idx_annual_ranking_configs_union_id"
  ON "annual_ranking_configs" ("union_id");

CREATE INDEX "idx_annual_ranking_configs_local_field_id"
  ON "annual_ranking_configs" ("local_field_id");

-- New templates are drafts by default; they must be explicitly activated after
-- their sections match the effective annual_evidence_folder ranking budget.
ALTER TABLE "folder_templates"
  ALTER COLUMN "active" SET DEFAULT false;

-- Normalize accepted legacy component aliases so runtime/API responses expose
-- canonical component keys going forward.
UPDATE "annual_ranking_component_configs"
SET "component_key" = CASE "component_key"
  WHEN 'annual_folder' THEN 'annual_evidence_folder'
  WHEN 'finance' THEN 'finance_compliance'
  WHEN 'camporee' THEN 'camporee_events'
  ELSE "component_key"
END
WHERE "component_key" IN ('annual_folder', 'finance', 'camporee');

-- Existing active templates that do not satisfy the new ranking-driven budget
-- invariant are demoted to drafts. Existing annual_folders keep their snapshot;
-- new folders can only be created after a template is re-published with a
-- section sum equal to the effective annual_evidence_folder component.
UPDATE "folder_templates" AS template
SET "active" = false
WHERE template."active" = true
  AND template."folder_template_id" IN (
    SELECT invalid_template."folder_template_id"
    FROM "folder_templates" AS invalid_template
    LEFT JOIN "local_fields" AS owner_lf
      ON owner_lf."local_field_id" = invalid_template."owner_local_field_id"
    LEFT JOIN LATERAL (
      SELECT config."annual_ranking_config_id"
      FROM "annual_ranking_configs" AS config
      WHERE config."active" = true
        AND config."ecclesiastical_year_id" = invalid_template."ecclesiastical_year_id"
        AND config."club_type_id" = invalid_template."club_type_id"
        AND (
          (
            invalid_template."owner_union_id" IS NOT NULL
            AND config."union_id" = invalid_template."owner_union_id"
            AND config."local_field_id" IS NULL
          )
          OR (
            invalid_template."owner_local_field_id" IS NOT NULL
            AND (
              (
                config."union_id" = owner_lf."union_id"
                AND config."local_field_id" IS NULL
              )
              OR (
                config."union_id" IS NULL
                AND config."local_field_id" = invalid_template."owner_local_field_id"
              )
            )
          )
        )
      ORDER BY
        CASE WHEN config."union_id" IS NOT NULL THEN 0 ELSE 1 END,
        config."created_at" DESC
      LIMIT 1
    ) effective_config ON TRUE
    LEFT JOIN (
      SELECT "folder_template_id", SUM("max_points")::int AS section_max_points
      FROM "folder_template_sections"
      GROUP BY "folder_template_id"
    ) section_points
      ON section_points."folder_template_id" = invalid_template."folder_template_id"
    LEFT JOIN "annual_ranking_component_configs" AS folder_component
      ON folder_component."annual_ranking_config_id" = effective_config."annual_ranking_config_id"
     AND folder_component."active" = true
     AND folder_component."component_key" IN ('annual_evidence_folder', 'annual_folder')
    WHERE invalid_template."active" = true
      AND (
        effective_config."annual_ranking_config_id" IS NULL
        OR folder_component."annual_ranking_component_config_id" IS NULL
        OR COALESCE(section_points.section_max_points, 0) <> folder_component."max_points"
      )
  );

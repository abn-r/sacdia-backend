-- Migration: 20260520225303_camporee_events
-- Date: 2026-05-20
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Adds the Camporee Events feature:
--   1. camporee_event_types + camporee_event_types_translations (i18n catalog)
--   2. camporee_event_templates (reusable templates scoped by union or local_field)
--   3. camporee_events (instances assigned to a specific camporee)
--   4. Seed initial event types (spiritual, recreational, cultural, sports, technical)
--   5. RBAC permissions for camporee_event_types and camporee_events
--
-- Additive only — no existing data is modified.
-- Idempotent: ON CONFLICT DO NOTHING for seed inserts.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. camporee_event_types
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "camporee_event_types" (
  "event_type_id"   SERIAL PRIMARY KEY,
  "code"            VARCHAR(40)  NOT NULL UNIQUE,
  "name"            VARCHAR(100) NOT NULL,
  "description"     TEXT,
  "display_order"   INT,
  "active"          BOOLEAN      NOT NULL DEFAULT TRUE,
  "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "modified_at"     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_camporee_event_types_active" ON "camporee_event_types" ("active");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. camporee_event_types_translations
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "camporee_event_types_translations" (
  "id"              BIGSERIAL    PRIMARY KEY,
  "event_type_id"   INT          NOT NULL REFERENCES "camporee_event_types" ("event_type_id") ON DELETE CASCADE ON UPDATE CASCADE,
  "locale"          VARCHAR(10)  NOT NULL,
  "name"            TEXT,
  "description"     TEXT,
  "created_at"      TIMESTAMPTZ  DEFAULT NOW(),
  "updated_at"      TIMESTAMPTZ  DEFAULT NOW(),
  CONSTRAINT "camporee_event_types_translations_unique_locale" UNIQUE ("event_type_id", "locale"),
  CHECK ("locale" <> 'es')
);

CREATE INDEX "camporee_event_types_translations_locale_idx"         ON "camporee_event_types_translations" ("locale");
CREATE INDEX "camporee_event_types_translations_event_type_id_idx"  ON "camporee_event_types_translations" ("event_type_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. camporee_event_templates
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "camporee_event_templates" (
  "event_template_id"     SERIAL       PRIMARY KEY,
  "scope"                 VARCHAR(20)  NOT NULL,
  "union_id"              INT          REFERENCES "unions" ("union_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  "local_field_id"        INT          REFERENCES "local_fields" ("local_field_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  "event_type_id"         INT          NOT NULL REFERENCES "camporee_event_types" ("event_type_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  "title"                 VARCHAR(150) NOT NULL,
  "description"           TEXT,
  "requirements"          TEXT,
  "development"           TEXT,
  "prerequisites"         TEXT,
  "materials"             TEXT,
  "auxiliaries"           TEXT,
  "max_points"            INT          NOT NULL,
  "min_points"            INT          NOT NULL DEFAULT 0,
  "penalties"             JSONB        NOT NULL DEFAULT '[]',
  "participants_mode"     VARCHAR(20)  NOT NULL,
  "participants_count"    INT,
  "participants_by_class" JSONB,
  "duration_seconds"      INT,
  "active"                BOOLEAN      NOT NULL DEFAULT TRUE,
  "created_at"            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "modified_at"           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "created_by"            UUID         REFERENCES "users" ("user_id") ON DELETE SET NULL ON UPDATE NO ACTION,
  "modified_by"           UUID         REFERENCES "users" ("user_id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "chk_camporee_event_templates_scope" CHECK (
    (scope = 'union'       AND union_id IS NOT NULL AND local_field_id IS NULL)
    OR
    (scope = 'local_field' AND local_field_id IS NOT NULL AND union_id IS NULL)
  ),
  CONSTRAINT "chk_camporee_event_templates_points" CHECK (max_points >= min_points),
  CONSTRAINT "chk_camporee_event_templates_participants_mode" CHECK (participants_mode IN ('count', 'by_class')),
  CONSTRAINT "chk_camporee_event_templates_participants_data" CHECK (
    (participants_mode = 'count'    AND participants_count IS NOT NULL AND participants_count > 0)
    OR
    (participants_mode = 'by_class' AND participants_by_class IS NOT NULL)
  )
);

CREATE INDEX "idx_camporee_event_templates_scope_union"       ON "camporee_event_templates" ("scope", "union_id");
CREATE INDEX "idx_camporee_event_templates_scope_lf"          ON "camporee_event_templates" ("scope", "local_field_id");
CREATE INDEX "idx_camporee_event_templates_event_type"        ON "camporee_event_templates" ("event_type_id");
CREATE INDEX "idx_camporee_event_templates_active"            ON "camporee_event_templates" ("active");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. camporee_events (instances)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "camporee_events" (
  "camporee_event_id"     SERIAL       PRIMARY KEY,
  "local_camporee_id"     INT          REFERENCES "local_camporees" ("local_camporee_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "union_camporee_id"     INT          REFERENCES "union_camporees" ("union_camporee_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "event_template_id"     INT          REFERENCES "camporee_event_templates" ("event_template_id") ON DELETE SET NULL ON UPDATE NO ACTION,
  "event_type_id"         INT          NOT NULL REFERENCES "camporee_event_types" ("event_type_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  -- snapshot of template fields (survives template edits/deletion)
  "title"                 VARCHAR(150) NOT NULL,
  "description"           TEXT,
  "requirements"          TEXT,
  "development"           TEXT,
  "prerequisites"         TEXT,
  "materials"             TEXT,
  "auxiliaries"           TEXT,
  "max_points"            INT          NOT NULL,
  "min_points"            INT          NOT NULL DEFAULT 0,
  "penalties"             JSONB        NOT NULL DEFAULT '[]',
  "participants_mode"     VARCHAR(20)  NOT NULL,
  "participants_count"    INT,
  "participants_by_class" JSONB,
  "duration_seconds"      INT,
  "display_order"         INT          NOT NULL DEFAULT 0,
  "active"                BOOLEAN      NOT NULL DEFAULT TRUE,
  "created_at"            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "modified_at"           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "created_by"            UUID         REFERENCES "users" ("user_id") ON DELETE SET NULL ON UPDATE NO ACTION,
  "modified_by"           UUID         REFERENCES "users" ("user_id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "chk_camporee_events_camporee_exclusive" CHECK (
    (local_camporee_id IS NOT NULL AND union_camporee_id IS NULL)
    OR
    (local_camporee_id IS NULL     AND union_camporee_id IS NOT NULL)
  ),
  CONSTRAINT "chk_camporee_events_points" CHECK (max_points >= min_points),
  CONSTRAINT "chk_camporee_events_participants_mode" CHECK (participants_mode IN ('count', 'by_class')),
  CONSTRAINT "chk_camporee_events_participants_data" CHECK (
    (participants_mode = 'count'    AND participants_count IS NOT NULL AND participants_count > 0)
    OR
    (participants_mode = 'by_class' AND participants_by_class IS NOT NULL)
  )
);

CREATE INDEX "idx_camporee_events_local_camporee"  ON "camporee_events" ("local_camporee_id");
CREATE INDEX "idx_camporee_events_union_camporee"  ON "camporee_events" ("union_camporee_id");
CREATE INDEX "idx_camporee_events_template"        ON "camporee_events" ("event_template_id");
CREATE INDEX "idx_camporee_events_active"          ON "camporee_events" ("active");
CREATE INDEX "idx_camporee_events_display_order"   ON "camporee_events" ("local_camporee_id", "display_order");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Seed initial event types
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "camporee_event_types" ("code", "name", "description", "display_order", "active")
VALUES
  ('spiritual',     'Espiritual',    'Eventos de naturaleza espiritual y devocional',       1, TRUE),
  ('recreational',  'Recreativo',    'Eventos recreativos y de entretenimiento',             2, TRUE),
  ('cultural',      'Cultural',      'Eventos de expresión cultural y artística',            3, TRUE),
  ('sports',        'Deportivo',     'Eventos deportivos y de competencia física',           4, TRUE),
  ('technical',     'Técnico',       'Eventos de habilidades técnicas y especializadas',     5, TRUE)
ON CONFLICT ("code") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RBAC permissions
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO permissions (permission_name, description, active)
VALUES
  ('camporee_event_types:read',   'Ver catálogo de tipos de evento de camporee',          TRUE),
  ('camporee_event_types:create', 'Crear tipos de evento de camporee',                    TRUE),
  ('camporee_event_types:update', 'Editar tipos de evento de camporee',                   TRUE),
  ('camporee_event_types:delete', 'Eliminar tipos de evento de camporee (soft delete)',   TRUE),
  ('camporee_events:read',        'Ver eventos y templates de camporee',                  TRUE),
  ('camporee_events:create',      'Crear eventos y templates de camporee',                TRUE),
  ('camporee_events:update',      'Editar eventos y templates de camporee',               TRUE),
  ('camporee_events:delete',      'Eliminar eventos y templates de camporee',             TRUE)
ON CONFLICT (permission_name) DO NOTHING;

-- camporee_event_types:* → super-admin (GLOBAL)
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = ANY(ARRAY[
  'camporee_event_types:read',
  'camporee_event_types:create',
  'camporee_event_types:update',
  'camporee_event_types:delete'
])
WHERE r.role_name = 'super-admin'
  AND r.role_category = 'GLOBAL'
  AND r.active = TRUE
  AND p.active = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- camporee_event_types:* → admin (GLOBAL)
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = ANY(ARRAY[
  'camporee_event_types:read',
  'camporee_event_types:create',
  'camporee_event_types:update',
  'camporee_event_types:delete'
])
WHERE r.role_name = 'admin'
  AND r.role_category = 'GLOBAL'
  AND r.active = TRUE
  AND p.active = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- camporee_events:* → super-admin (GLOBAL)
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = ANY(ARRAY[
  'camporee_events:read',
  'camporee_events:create',
  'camporee_events:update',
  'camporee_events:delete'
])
WHERE r.role_name = 'super-admin'
  AND r.role_category = 'GLOBAL'
  AND r.active = TRUE
  AND p.active = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- camporee_events:* → admin (GLOBAL)
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = ANY(ARRAY[
  'camporee_events:read',
  'camporee_events:create',
  'camporee_events:update',
  'camporee_events:delete'
])
WHERE r.role_name = 'admin'
  AND r.role_category = 'GLOBAL'
  AND r.active = TRUE
  AND p.active = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- camporee_events:* → director-union (GLOBAL)
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = ANY(ARRAY[
  'camporee_events:read',
  'camporee_events:create',
  'camporee_events:update',
  'camporee_events:delete'
])
WHERE r.role_name = 'director-union'
  AND r.role_category = 'GLOBAL'
  AND r.active = TRUE
  AND p.active = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- camporee_events:* → assistant-union (GLOBAL)
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = ANY(ARRAY[
  'camporee_events:read',
  'camporee_events:create',
  'camporee_events:update',
  'camporee_events:delete'
])
WHERE r.role_name = 'assistant-union'
  AND r.role_category = 'GLOBAL'
  AND r.active = TRUE
  AND p.active = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- camporee_events:* → director-lf (GLOBAL)
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = ANY(ARRAY[
  'camporee_events:read',
  'camporee_events:create',
  'camporee_events:update',
  'camporee_events:delete'
])
WHERE r.role_name = 'director-lf'
  AND r.role_category = 'GLOBAL'
  AND r.active = TRUE
  AND p.active = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- camporee_events:* → assistant-lf (GLOBAL)
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = ANY(ARRAY[
  'camporee_events:read',
  'camporee_events:create',
  'camporee_events:update',
  'camporee_events:delete'
])
WHERE r.role_name = 'assistant-lf'
  AND r.role_category = 'GLOBAL'
  AND r.active = TRUE
  AND p.active = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- camporee_events:read + create + update + delete → director (CLUB)
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = ANY(ARRAY[
  'camporee_events:read',
  'camporee_events:create',
  'camporee_events:update',
  'camporee_events:delete'
])
WHERE r.role_name = 'director'
  AND r.role_category = 'CLUB'
  AND r.active = TRUE
  AND p.active = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- camporee_events:read + create + update → deputy-director (CLUB) [subdirector]
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = ANY(ARRAY[
  'camporee_events:read',
  'camporee_events:create',
  'camporee_events:update'
])
WHERE r.role_name = 'deputy-director'
  AND r.role_category = 'CLUB'
  AND r.active = TRUE
  AND p.active = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

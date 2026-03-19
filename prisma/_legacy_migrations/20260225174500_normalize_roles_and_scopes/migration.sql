-- Normalize role slugs to English canonical names and add missing global roles.

-- 1) Ensure canonical role rows exist before moving references.
INSERT INTO "roles" ("role_name", "role_category", "active", "created_at", "modified_at")
SELECT 'deputy_director', 'CLUB'::"role_category", true, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "roles" WHERE lower("role_name") = 'deputy_director'
);

INSERT INTO "roles" ("role_name", "role_category", "active", "created_at", "modified_at")
SELECT 'secretary', 'CLUB'::"role_category", true, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "roles" WHERE lower("role_name") = 'secretary'
);

INSERT INTO "roles" ("role_name", "role_category", "active", "created_at", "modified_at")
SELECT 'treasurer', 'CLUB'::"role_category", true, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "roles" WHERE lower("role_name") = 'treasurer'
);

INSERT INTO "roles" ("role_name", "role_category", "active", "created_at", "modified_at")
SELECT 'counselor', 'CLUB'::"role_category", true, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "roles" WHERE lower("role_name") = 'counselor'
);

INSERT INTO "roles" ("role_name", "role_category", "active", "created_at", "modified_at")
SELECT 'assistant_admin', 'GLOBAL'::"role_category", true, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "roles" WHERE lower("role_name") = 'assistant_admin'
);

-- 2) Helper pattern repeated for each legacy role rename:
--    a) Remove duplicate references where both old/new role assignments already exist.
--    b) Repoint remaining references to canonical role.
--    c) Delete legacy role row.

-- subdirector -> deputy_director
WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'deputy_director'
  WHERE lower(old_role."role_name") = 'subdirector'
)
DELETE FROM "users_roles" old_ur
USING "users_roles" new_ur, ids
WHERE old_ur."role_id" = ids.old_role_id
  AND new_ur."role_id" = ids.new_role_id
  AND old_ur."user_id" = new_ur."user_id";

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'deputy_director'
  WHERE lower(old_role."role_name") = 'subdirector'
)
UPDATE "users_roles" ur
SET "role_id" = ids.new_role_id,
    "modified_at" = now()
FROM ids
WHERE ur."role_id" = ids.old_role_id
  AND ids.old_role_id <> ids.new_role_id;

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'deputy_director'
  WHERE lower(old_role."role_name") = 'subdirector'
)
DELETE FROM "role_permissions" old_rp
USING "role_permissions" new_rp, ids
WHERE old_rp."role_id" = ids.old_role_id
  AND new_rp."role_id" = ids.new_role_id
  AND old_rp."permission_id" = new_rp."permission_id";

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'deputy_director'
  WHERE lower(old_role."role_name") = 'subdirector'
)
UPDATE "role_permissions" rp
SET "role_id" = ids.new_role_id,
    "modified_at" = now()
FROM ids
WHERE rp."role_id" = ids.old_role_id
  AND ids.old_role_id <> ids.new_role_id;

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'deputy_director'
  WHERE lower(old_role."role_name") = 'subdirector'
)
DELETE FROM "club_role_assignments" old_a
USING "club_role_assignments" new_a, ids
WHERE old_a."role_id" = ids.old_role_id
  AND new_a."role_id" = ids.new_role_id
  AND old_a."user_id" = new_a."user_id"
  AND old_a."club_adv_id" IS NOT DISTINCT FROM new_a."club_adv_id"
  AND old_a."club_pathf_id" IS NOT DISTINCT FROM new_a."club_pathf_id"
  AND old_a."club_mg_id" IS NOT DISTINCT FROM new_a."club_mg_id"
  AND old_a."ecclesiastical_year_id" = new_a."ecclesiastical_year_id"
  AND old_a."start_date" = new_a."start_date";

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'deputy_director'
  WHERE lower(old_role."role_name") = 'subdirector'
)
UPDATE "club_role_assignments" assignment
SET "role_id" = ids.new_role_id,
    "modified_at" = now()
FROM ids
WHERE assignment."role_id" = ids.old_role_id
  AND ids.old_role_id <> ids.new_role_id;

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'deputy_director'
  WHERE lower(old_role."role_name") = 'subdirector'
)
DELETE FROM "roles" old_role
USING ids
WHERE old_role."role_id" = ids.old_role_id
  AND ids.old_role_id <> ids.new_role_id;

-- secretario -> secretary
WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'secretary'
  WHERE lower(old_role."role_name") = 'secretario'
)
DELETE FROM "users_roles" old_ur
USING "users_roles" new_ur, ids
WHERE old_ur."role_id" = ids.old_role_id
  AND new_ur."role_id" = ids.new_role_id
  AND old_ur."user_id" = new_ur."user_id";

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'secretary'
  WHERE lower(old_role."role_name") = 'secretario'
)
UPDATE "users_roles" ur
SET "role_id" = ids.new_role_id,
    "modified_at" = now()
FROM ids
WHERE ur."role_id" = ids.old_role_id
  AND ids.old_role_id <> ids.new_role_id;

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'secretary'
  WHERE lower(old_role."role_name") = 'secretario'
)
DELETE FROM "role_permissions" old_rp
USING "role_permissions" new_rp, ids
WHERE old_rp."role_id" = ids.old_role_id
  AND new_rp."role_id" = ids.new_role_id
  AND old_rp."permission_id" = new_rp."permission_id";

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'secretary'
  WHERE lower(old_role."role_name") = 'secretario'
)
UPDATE "role_permissions" rp
SET "role_id" = ids.new_role_id,
    "modified_at" = now()
FROM ids
WHERE rp."role_id" = ids.old_role_id
  AND ids.old_role_id <> ids.new_role_id;

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'secretary'
  WHERE lower(old_role."role_name") = 'secretario'
)
DELETE FROM "club_role_assignments" old_a
USING "club_role_assignments" new_a, ids
WHERE old_a."role_id" = ids.old_role_id
  AND new_a."role_id" = ids.new_role_id
  AND old_a."user_id" = new_a."user_id"
  AND old_a."club_adv_id" IS NOT DISTINCT FROM new_a."club_adv_id"
  AND old_a."club_pathf_id" IS NOT DISTINCT FROM new_a."club_pathf_id"
  AND old_a."club_mg_id" IS NOT DISTINCT FROM new_a."club_mg_id"
  AND old_a."ecclesiastical_year_id" = new_a."ecclesiastical_year_id"
  AND old_a."start_date" = new_a."start_date";

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'secretary'
  WHERE lower(old_role."role_name") = 'secretario'
)
UPDATE "club_role_assignments" assignment
SET "role_id" = ids.new_role_id,
    "modified_at" = now()
FROM ids
WHERE assignment."role_id" = ids.old_role_id
  AND ids.old_role_id <> ids.new_role_id;

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'secretary'
  WHERE lower(old_role."role_name") = 'secretario'
)
DELETE FROM "roles" old_role
USING ids
WHERE old_role."role_id" = ids.old_role_id
  AND ids.old_role_id <> ids.new_role_id;

-- tesorero -> treasurer
WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'treasurer'
  WHERE lower(old_role."role_name") = 'tesorero'
)
DELETE FROM "users_roles" old_ur
USING "users_roles" new_ur, ids
WHERE old_ur."role_id" = ids.old_role_id
  AND new_ur."role_id" = ids.new_role_id
  AND old_ur."user_id" = new_ur."user_id";

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'treasurer'
  WHERE lower(old_role."role_name") = 'tesorero'
)
UPDATE "users_roles" ur
SET "role_id" = ids.new_role_id,
    "modified_at" = now()
FROM ids
WHERE ur."role_id" = ids.old_role_id
  AND ids.old_role_id <> ids.new_role_id;

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'treasurer'
  WHERE lower(old_role."role_name") = 'tesorero'
)
DELETE FROM "role_permissions" old_rp
USING "role_permissions" new_rp, ids
WHERE old_rp."role_id" = ids.old_role_id
  AND new_rp."role_id" = ids.new_role_id
  AND old_rp."permission_id" = new_rp."permission_id";

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'treasurer'
  WHERE lower(old_role."role_name") = 'tesorero'
)
UPDATE "role_permissions" rp
SET "role_id" = ids.new_role_id,
    "modified_at" = now()
FROM ids
WHERE rp."role_id" = ids.old_role_id
  AND ids.old_role_id <> ids.new_role_id;

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'treasurer'
  WHERE lower(old_role."role_name") = 'tesorero'
)
DELETE FROM "club_role_assignments" old_a
USING "club_role_assignments" new_a, ids
WHERE old_a."role_id" = ids.old_role_id
  AND new_a."role_id" = ids.new_role_id
  AND old_a."user_id" = new_a."user_id"
  AND old_a."club_adv_id" IS NOT DISTINCT FROM new_a."club_adv_id"
  AND old_a."club_pathf_id" IS NOT DISTINCT FROM new_a."club_pathf_id"
  AND old_a."club_mg_id" IS NOT DISTINCT FROM new_a."club_mg_id"
  AND old_a."ecclesiastical_year_id" = new_a."ecclesiastical_year_id"
  AND old_a."start_date" = new_a."start_date";

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'treasurer'
  WHERE lower(old_role."role_name") = 'tesorero'
)
UPDATE "club_role_assignments" assignment
SET "role_id" = ids.new_role_id,
    "modified_at" = now()
FROM ids
WHERE assignment."role_id" = ids.old_role_id
  AND ids.old_role_id <> ids.new_role_id;

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'treasurer'
  WHERE lower(old_role."role_name") = 'tesorero'
)
DELETE FROM "roles" old_role
USING ids
WHERE old_role."role_id" = ids.old_role_id
  AND ids.old_role_id <> ids.new_role_id;

-- consejero -> counselor
WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'counselor'
  WHERE lower(old_role."role_name") = 'consejero'
)
DELETE FROM "users_roles" old_ur
USING "users_roles" new_ur, ids
WHERE old_ur."role_id" = ids.old_role_id
  AND new_ur."role_id" = ids.new_role_id
  AND old_ur."user_id" = new_ur."user_id";

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'counselor'
  WHERE lower(old_role."role_name") = 'consejero'
)
UPDATE "users_roles" ur
SET "role_id" = ids.new_role_id,
    "modified_at" = now()
FROM ids
WHERE ur."role_id" = ids.old_role_id
  AND ids.old_role_id <> ids.new_role_id;

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'counselor'
  WHERE lower(old_role."role_name") = 'consejero'
)
DELETE FROM "role_permissions" old_rp
USING "role_permissions" new_rp, ids
WHERE old_rp."role_id" = ids.old_role_id
  AND new_rp."role_id" = ids.new_role_id
  AND old_rp."permission_id" = new_rp."permission_id";

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'counselor'
  WHERE lower(old_role."role_name") = 'consejero'
)
UPDATE "role_permissions" rp
SET "role_id" = ids.new_role_id,
    "modified_at" = now()
FROM ids
WHERE rp."role_id" = ids.old_role_id
  AND ids.old_role_id <> ids.new_role_id;

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'counselor'
  WHERE lower(old_role."role_name") = 'consejero'
)
DELETE FROM "club_role_assignments" old_a
USING "club_role_assignments" new_a, ids
WHERE old_a."role_id" = ids.old_role_id
  AND new_a."role_id" = ids.new_role_id
  AND old_a."user_id" = new_a."user_id"
  AND old_a."club_adv_id" IS NOT DISTINCT FROM new_a."club_adv_id"
  AND old_a."club_pathf_id" IS NOT DISTINCT FROM new_a."club_pathf_id"
  AND old_a."club_mg_id" IS NOT DISTINCT FROM new_a."club_mg_id"
  AND old_a."ecclesiastical_year_id" = new_a."ecclesiastical_year_id"
  AND old_a."start_date" = new_a."start_date";

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'counselor'
  WHERE lower(old_role."role_name") = 'consejero'
)
UPDATE "club_role_assignments" assignment
SET "role_id" = ids.new_role_id,
    "modified_at" = now()
FROM ids
WHERE assignment."role_id" = ids.old_role_id
  AND ids.old_role_id <> ids.new_role_id;

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'counselor'
  WHERE lower(old_role."role_name") = 'consejero'
)
DELETE FROM "roles" old_role
USING ids
WHERE old_role."role_id" = ids.old_role_id
  AND ids.old_role_id <> ids.new_role_id;

-- assistant -> assistant_admin
WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'assistant_admin'
  WHERE lower(old_role."role_name") = 'assistant'
)
DELETE FROM "users_roles" old_ur
USING "users_roles" new_ur, ids
WHERE old_ur."role_id" = ids.old_role_id
  AND new_ur."role_id" = ids.new_role_id
  AND old_ur."user_id" = new_ur."user_id";

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'assistant_admin'
  WHERE lower(old_role."role_name") = 'assistant'
)
UPDATE "users_roles" ur
SET "role_id" = ids.new_role_id,
    "modified_at" = now()
FROM ids
WHERE ur."role_id" = ids.old_role_id
  AND ids.old_role_id <> ids.new_role_id;

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'assistant_admin'
  WHERE lower(old_role."role_name") = 'assistant'
)
DELETE FROM "role_permissions" old_rp
USING "role_permissions" new_rp, ids
WHERE old_rp."role_id" = ids.old_role_id
  AND new_rp."role_id" = ids.new_role_id
  AND old_rp."permission_id" = new_rp."permission_id";

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'assistant_admin'
  WHERE lower(old_role."role_name") = 'assistant'
)
UPDATE "role_permissions" rp
SET "role_id" = ids.new_role_id,
    "modified_at" = now()
FROM ids
WHERE rp."role_id" = ids.old_role_id
  AND ids.old_role_id <> ids.new_role_id;

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'assistant_admin'
  WHERE lower(old_role."role_name") = 'assistant'
)
DELETE FROM "club_role_assignments" old_a
USING "club_role_assignments" new_a, ids
WHERE old_a."role_id" = ids.old_role_id
  AND new_a."role_id" = ids.new_role_id
  AND old_a."user_id" = new_a."user_id"
  AND old_a."club_adv_id" IS NOT DISTINCT FROM new_a."club_adv_id"
  AND old_a."club_pathf_id" IS NOT DISTINCT FROM new_a."club_pathf_id"
  AND old_a."club_mg_id" IS NOT DISTINCT FROM new_a."club_mg_id"
  AND old_a."ecclesiastical_year_id" = new_a."ecclesiastical_year_id"
  AND old_a."start_date" = new_a."start_date";

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'assistant_admin'
  WHERE lower(old_role."role_name") = 'assistant'
)
UPDATE "club_role_assignments" assignment
SET "role_id" = ids.new_role_id,
    "modified_at" = now()
FROM ids
WHERE assignment."role_id" = ids.old_role_id
  AND ids.old_role_id <> ids.new_role_id;

WITH ids AS (
  SELECT
    old_role."role_id" AS old_role_id,
    new_role."role_id" AS new_role_id
  FROM "roles" old_role
  JOIN "roles" new_role ON lower(new_role."role_name") = 'assistant_admin'
  WHERE lower(old_role."role_name") = 'assistant'
)
DELETE FROM "roles" old_role
USING ids
WHERE old_role."role_id" = ids.old_role_id
  AND ids.old_role_id <> ids.new_role_id;

-- 3) Ensure global roles required by RBAC model.
INSERT INTO "roles" ("role_name", "role_category", "active", "created_at", "modified_at")
SELECT 'super_admin', 'GLOBAL'::"role_category", true, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "roles" WHERE lower("role_name") = 'super_admin'
);

INSERT INTO "roles" ("role_name", "role_category", "active", "created_at", "modified_at")
SELECT 'admin', 'GLOBAL'::"role_category", true, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "roles" WHERE lower("role_name") = 'admin'
);

INSERT INTO "roles" ("role_name", "role_category", "active", "created_at", "modified_at")
SELECT 'coordinator', 'GLOBAL'::"role_category", true, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "roles" WHERE lower("role_name") = 'coordinator'
);

INSERT INTO "roles" ("role_name", "role_category", "active", "created_at", "modified_at")
SELECT 'pastor', 'GLOBAL'::"role_category", true, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "roles" WHERE lower("role_name") = 'pastor'
);

INSERT INTO "roles" ("role_name", "role_category", "active", "created_at", "modified_at")
SELECT 'user', 'GLOBAL'::"role_category", true, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "roles" WHERE lower("role_name") = 'user'
);

-- 4) Ensure core club roles exist.
INSERT INTO "roles" ("role_name", "role_category", "active", "created_at", "modified_at")
SELECT 'director', 'CLUB'::"role_category", true, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "roles" WHERE lower("role_name") = 'director'
);

INSERT INTO "roles" ("role_name", "role_category", "active", "created_at", "modified_at")
SELECT 'instructor', 'CLUB'::"role_category", true, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "roles" WHERE lower("role_name") = 'instructor'
);

INSERT INTO "roles" ("role_name", "role_category", "active", "created_at", "modified_at")
SELECT 'member', 'CLUB'::"role_category", true, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "roles" WHERE lower("role_name") = 'member'
);

-- 5) Force canonical categories for known roles.
UPDATE "roles"
SET "role_category" = 'GLOBAL'::"role_category",
    "modified_at" = now()
WHERE lower("role_name") IN (
  'super_admin',
  'admin',
  'assistant_admin',
  'coordinator',
  'pastor',
  'user'
)
  AND "role_category" <> 'GLOBAL'::"role_category";

UPDATE "roles"
SET "role_category" = 'CLUB'::"role_category",
    "modified_at" = now()
WHERE lower("role_name") IN (
  'director',
  'deputy_director',
  'secretary',
  'treasurer',
  'counselor',
  'instructor',
  'member'
)
  AND "role_category" <> 'CLUB'::"role_category";

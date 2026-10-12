-- Migration: 20261010120000_certificate_import_honor_instructor (M1)
-- Instructor opcional de una especialidad (D1, D2, D9). Slice B2 del plan
-- docs/plans/2026-10-09-certificate-import-instructor-data-model.md (secciones 2.2 a 2.5).
--
-- Aditiva y segura con datos existentes: columnas NULL sin default (solo
-- metadatos), FK y CHECK con NOT VALID + VALIDATE CONSTRAINT (no bloquea
-- escrituras) e indices parciales CREATE INDEX CONCURRENTLY.
--
-- CÓMO APLICARLA (manual, Neon dev -> staging -> prod, ANTES de desplegar el
-- backend que usa las columnas; la shadow DB está rota, no uses migrate dev):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261010120000_certificate_import_honor_instructor/migration.sql
--
-- IMPORTANTE: NO uses `psql -1` / `--single-transaction` ni envuelvas el archivo
-- en BEGIN/COMMIT. CREATE INDEX CONCURRENTLY no puede correr dentro de una
-- transacción. Con `-f` cada sentencia corre en su propia transacción implícita.
-- El archivo es re-ejecutable: las columnas usan IF NOT EXISTS, las
-- restricciones se recrean con DROP CONSTRAINT IF EXISTS y los índices con
-- IF NOT EXISTS. Si un CREATE INDEX CONCURRENTLY falla a medias deja un índice
-- INVALID: `DROP INDEX CONCURRENTLY <nombre>;` y vuelve a correr el archivo.
--
-- Después de aplicar, registrar en _prisma_migrations (flujo manual del repo):
--   corepack pnpm exec prisma migrate resolve --applied 20261010120000_certificate_import_honor_instructor
--
-- Rollback: solo hacia adelante. Antes de que haya datos reales: DROP INDEX,
-- DROP CONSTRAINT y DROP COLUMN en el orden inverso.

-- ============================================================
-- 1. Columnas (nullable, sin default)
-- ============================================================
ALTER TABLE certificate_bulk_import_items
  ADD COLUMN IF NOT EXISTS instructor_user_id uuid,
  ADD COLUMN IF NOT EXISTS instructor_name varchar(150);

ALTER TABLE users_honors
  ADD COLUMN IF NOT EXISTS instructor_user_id uuid,
  ADD COLUMN IF NOT EXISTS instructor_name varchar(150);

-- ============================================================
-- 2. FK a users (NO ACTION: los usuarios no se borran fisicamente, se anonimizan)
-- ============================================================
ALTER TABLE certificate_bulk_import_items
  DROP CONSTRAINT IF EXISTS certificate_bulk_import_items_instructor_user_id_fkey,
  ADD CONSTRAINT certificate_bulk_import_items_instructor_user_id_fkey
    FOREIGN KEY (instructor_user_id) REFERENCES users (user_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID;

ALTER TABLE users_honors
  DROP CONSTRAINT IF EXISTS users_honors_instructor_user_id_fkey,
  ADD CONSTRAINT users_honors_instructor_user_id_fkey
    FOREIGN KEY (instructor_user_id) REFERENCES users (user_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID;

-- ============================================================
-- 3. CHECK (exclusividad, solo HONOR en items, nombre libre de 3 a 150)
-- ============================================================
ALTER TABLE certificate_bulk_import_items
  DROP CONSTRAINT IF EXISTS certificate_bulk_import_items_instructor_exclusive_ck,
  DROP CONSTRAINT IF EXISTS certificate_bulk_import_items_instructor_honor_ck,
  DROP CONSTRAINT IF EXISTS certificate_bulk_import_items_instructor_name_ck,
  ADD CONSTRAINT certificate_bulk_import_items_instructor_exclusive_ck
    CHECK (instructor_user_id IS NULL OR instructor_name IS NULL) NOT VALID,
  ADD CONSTRAINT certificate_bulk_import_items_instructor_honor_ck
    CHECK (item_type = 'HONOR' OR (instructor_user_id IS NULL AND instructor_name IS NULL)) NOT VALID,
  ADD CONSTRAINT certificate_bulk_import_items_instructor_name_ck
    CHECK (instructor_name IS NULL OR char_length(btrim(instructor_name)) BETWEEN 3 AND 150) NOT VALID;

ALTER TABLE users_honors
  DROP CONSTRAINT IF EXISTS users_honors_instructor_exclusive_ck,
  DROP CONSTRAINT IF EXISTS users_honors_instructor_name_ck,
  ADD CONSTRAINT users_honors_instructor_exclusive_ck
    CHECK (instructor_user_id IS NULL OR instructor_name IS NULL) NOT VALID,
  ADD CONSTRAINT users_honors_instructor_name_ck
    CHECK (instructor_name IS NULL OR char_length(btrim(instructor_name)) BETWEEN 3 AND 150) NOT VALID;

-- ============================================================
-- 4. VALIDATE (todas las filas existentes tienen NULL: validación trivial y
--    sin bloquear escrituras)
-- ============================================================
ALTER TABLE certificate_bulk_import_items VALIDATE CONSTRAINT certificate_bulk_import_items_instructor_user_id_fkey;
ALTER TABLE certificate_bulk_import_items VALIDATE CONSTRAINT certificate_bulk_import_items_instructor_exclusive_ck;
ALTER TABLE certificate_bulk_import_items VALIDATE CONSTRAINT certificate_bulk_import_items_instructor_honor_ck;
ALTER TABLE certificate_bulk_import_items VALIDATE CONSTRAINT certificate_bulk_import_items_instructor_name_ck;
ALTER TABLE users_honors VALIDATE CONSTRAINT users_honors_instructor_user_id_fkey;
ALTER TABLE users_honors VALIDATE CONSTRAINT users_honors_instructor_exclusive_ck;
ALTER TABLE users_honors VALIDATE CONSTRAINT users_honors_instructor_name_ck;

-- ============================================================
-- 5. Índices parciales (CONCURRENTLY: fuera de transacción)
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_certificate_bulk_items_instructor_user
  ON certificate_bulk_import_items (instructor_user_id)
  WHERE instructor_user_id IS NOT NULL;

-- Conteo "especialidades enseñadas" por instructor (ambos flujos, D9).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_honors_instructor_user_approved
  ON users_honors (instructor_user_id)
  WHERE instructor_user_id IS NOT NULL AND active = true AND validation_status = 'APPROVED';

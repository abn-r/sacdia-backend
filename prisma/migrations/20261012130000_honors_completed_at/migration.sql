-- Migration: 20261012130000_honors_completed_at (M5)
-- Fecha de finalización de una especialidad del usuario (decisión 2026-10-12).
-- Slice B5 del plan docs/plans/2026-10-09-certificate-import-instructor-data-model.md.
-- `users_honors.date` sigue siendo la fecha de INICIO; `completed_at` es la de
-- finalización. Es opcional en borrador y obligatoria al enviar a revisión (lo
-- exige el backend, no la base).
--
-- Aditiva y segura con datos existentes: columna NULL sin default (solo
-- metadatos, no reescribe la tabla) y CHECK con NOT VALID + VALIDATE
-- CONSTRAINT (no bloquea escrituras). No crea índices: nadie filtra por esta
-- columna.
--
-- Backfill (sección 3): copia la fecha de finalización a las filas históricas de
-- la carga por certificado, donde `users_honors.date` ya guardaba la fecha de
-- finalización. Es determinista: solo toca filas APPROVED enlazadas por
-- `applied_entity_id` a un ítem HONOR APPROVED cuyo `completed_at` es IGUAL a
-- `users_honors.date`. Si difieren (por ejemplo, una fila reescrita antes de
-- SEC-1) o no hay ítem enlazado (flujo normal), `completed_at` queda en NULL:
-- en el flujo normal `date` es la fecha de inicio y no se puede inferir.
--
-- CÓMO APLICARLA (manual, Neon dev -> staging -> prod, ANTES de desplegar el
-- backend que usa la columna; la shadow DB está rota, no uses migrate dev):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261012130000_honors_completed_at/migration.sql
--
-- No usa CONCURRENTLY ni depende de otras migraciones nuevas. Con `-f` cada
-- sentencia corre en su propia transacción implícita (no necesitas `-1`).
-- El archivo es re-ejecutable: la columna usa IF NOT EXISTS, la restricción se
-- recrea con DROP CONSTRAINT IF EXISTS y el backfill solo toca filas con
-- `completed_at IS NULL`.
--
-- Después de aplicar, registrar en _prisma_migrations (flujo manual del repo):
--   corepack pnpm exec prisma migrate resolve --applied 20261012130000_honors_completed_at
--
-- Verificación sugerida:
--   SELECT count(*) FILTER (WHERE completed_at IS NOT NULL) AS con_fecha,
--          count(*) AS total
--     FROM users_honors WHERE validation_status = 'APPROVED';
--
-- Rollback: solo hacia adelante. Antes de que haya datos reales:
--   ALTER TABLE users_honors DROP CONSTRAINT IF EXISTS users_honors_completed_at_min_ck;
--   ALTER TABLE users_honors DROP COLUMN IF EXISTS completed_at;

-- ============================================================
-- 1. Columna (nullable, sin default)
-- ============================================================
ALTER TABLE users_honors
  ADD COLUMN IF NOT EXISTS completed_at date;

-- ============================================================
-- 2. CHECK de cota inferior (D6: 1960-01-01). Sin cota superior: la base no
--    conoce "hoy"; "no futuro" lo valida el DTO y el servicio.
-- ============================================================
ALTER TABLE users_honors
  DROP CONSTRAINT IF EXISTS users_honors_completed_at_min_ck,
  ADD CONSTRAINT users_honors_completed_at_min_ck
    CHECK (completed_at IS NULL OR completed_at >= DATE '1960-01-01') NOT VALID;

-- Todas las filas existentes tienen NULL: validación trivial, sin bloquear escrituras.
ALTER TABLE users_honors VALIDATE CONSTRAINT users_honors_completed_at_min_ck;

-- ============================================================
-- 3. Backfill determinista de la carga por certificado
--    (no toca modified_at ni ninguna otra columna)
-- ============================================================
UPDATE users_honors uh
   SET completed_at = uh.date
  FROM certificate_bulk_import_items i
 WHERE i.applied_entity_type = 'USER_HONOR'
   AND i.applied_entity_id = uh.user_honor_id
   AND i.item_type = 'HONOR'
   AND i.status = 'APPROVED'
   AND uh.validation_status = 'APPROVED'
   AND uh.completed_at IS NULL
   AND i.completed_at = uh.date
   AND uh.date >= DATE '1960-01-01';

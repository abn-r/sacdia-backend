-- Migration: 20261013100000_honor_instructor_proposals (M4)
-- Propuesta de instructor sobre una especialidad YA APROBADA (decision D11). Slice
-- B9 del plan docs/plans/2026-10-09-certificate-import-instructor-data-model.md
-- (secciones 2.7 y 4.9).
--
-- Tabla nueva: el miembro propone el instructor y el Campo Local lo aprueba o
-- rechaza. Solo al aprobar se escribe users_honors.instructor_*; hasta entonces
-- users_honors no se toca. Aditiva y sin riesgo sobre datos existentes: no altera
-- ninguna tabla vieja. FKs y CHECKs con NOT VALID + VALIDATE CONSTRAINT (la tabla
-- nace vacia, la validacion es trivial) e indices CREATE INDEX CONCURRENTLY.
--
-- Requiere M1 (20261010120000_certificate_import_honor_instructor) aplicada:
-- al aprobar, el backend escribe users_honors.instructor_user_id/instructor_name.
--
-- CÓMO APLICARLA (manual, Neon dev -> staging -> prod, ANTES de desplegar el
-- backend que usa la tabla; la shadow DB está rota, no uses migrate dev/deploy):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261013100000_honor_instructor_proposals/migration.sql
--
-- IMPORTANTE: NO uses `psql -1` / `--single-transaction` ni envuelvas el archivo
-- en BEGIN/COMMIT. CREATE INDEX CONCURRENTLY no puede correr dentro de una
-- transacción. Con `-f` cada sentencia corre en su propia transacción implícita.
-- El archivo es re-ejecutable: el tipo y la tabla usan IF NOT EXISTS / manejo de
-- duplicate_object, las restricciones se recrean con DROP CONSTRAINT IF EXISTS y
-- los índices con IF NOT EXISTS. Si un CREATE INDEX CONCURRENTLY falla a medias
-- deja un índice INVALID: `DROP INDEX CONCURRENTLY <nombre>;` y vuelve a correr
-- el archivo.
--
-- Después de aplicar, registrar en _prisma_migrations (flujo manual del repo):
--   corepack pnpm exec prisma migrate resolve --applied 20261013100000_honor_instructor_proposals
--
-- Rollback: solo hacia adelante. Antes de que haya propuestas reales:
--   DROP TABLE honor_instructor_proposals; DROP TYPE honor_instructor_proposal_status_enum;

-- ============================================================
-- 1. Enum de estado
-- ============================================================
DO $$
BEGIN
  CREATE TYPE honor_instructor_proposal_status_enum AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'WITHDRAWN'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. Tabla (sin local_field_id: el alcance del revisor sale del Campo Local
--    ACTUAL del dueño de la especialidad)
-- ============================================================
CREATE TABLE IF NOT EXISTS honor_instructor_proposals (
  proposal_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_honor_id      integer NOT NULL,
  proposed_by_id     uuid NOT NULL,
  instructor_user_id uuid,
  instructor_name    varchar(150),
  status             honor_instructor_proposal_status_enum NOT NULL DEFAULT 'PENDING',
  rejection_reason   text,
  reviewed_by_id     uuid,
  reviewed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  modified_at        timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. FKs (NO ACTION: ni la especialidad ni los usuarios se borran fisicamente)
-- ============================================================
ALTER TABLE honor_instructor_proposals
  DROP CONSTRAINT IF EXISTS honor_instructor_proposals_user_honor_id_fkey,
  DROP CONSTRAINT IF EXISTS honor_instructor_proposals_proposed_by_id_fkey,
  DROP CONSTRAINT IF EXISTS honor_instructor_proposals_instructor_user_id_fkey,
  DROP CONSTRAINT IF EXISTS honor_instructor_proposals_reviewed_by_id_fkey,
  ADD CONSTRAINT honor_instructor_proposals_user_honor_id_fkey
    FOREIGN KEY (user_honor_id) REFERENCES users_honors (user_honor_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID,
  ADD CONSTRAINT honor_instructor_proposals_proposed_by_id_fkey
    FOREIGN KEY (proposed_by_id) REFERENCES users (user_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID,
  ADD CONSTRAINT honor_instructor_proposals_instructor_user_id_fkey
    FOREIGN KEY (instructor_user_id) REFERENCES users (user_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID,
  ADD CONSTRAINT honor_instructor_proposals_reviewed_by_id_fkey
    FOREIGN KEY (reviewed_by_id) REFERENCES users (user_id)
    ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID;

-- ============================================================
-- 4. CHECK
--    - exactamente un instructor: usuario del sistema XOR nombre libre
--    - nombre libre de 3 a 150 caracteres
--    - APPROVED/REJECTED llevan revisor y fecha; PENDING/WITHDRAWN no los llevan juntos
--    - REJECTED exige motivo de 3 a 500 caracteres. El IS NOT NULL es explicito:
--      sin él, un motivo NULL daria NULL en el BETWEEN y el CHECK lo dejaria pasar.
-- ============================================================
ALTER TABLE honor_instructor_proposals
  DROP CONSTRAINT IF EXISTS honor_instructor_proposals_one_instructor_ck,
  DROP CONSTRAINT IF EXISTS honor_instructor_proposals_name_ck,
  DROP CONSTRAINT IF EXISTS honor_instructor_proposals_review_ck,
  DROP CONSTRAINT IF EXISTS honor_instructor_proposals_reason_ck,
  ADD CONSTRAINT honor_instructor_proposals_one_instructor_ck
    CHECK ((instructor_user_id IS NULL) <> (instructor_name IS NULL)) NOT VALID,
  ADD CONSTRAINT honor_instructor_proposals_name_ck
    CHECK (instructor_name IS NULL OR char_length(btrim(instructor_name)) BETWEEN 3 AND 150) NOT VALID,
  ADD CONSTRAINT honor_instructor_proposals_review_ck
    CHECK ((status IN ('APPROVED', 'REJECTED')) = (reviewed_by_id IS NOT NULL AND reviewed_at IS NOT NULL)) NOT VALID,
  ADD CONSTRAINT honor_instructor_proposals_reason_ck
    CHECK (status <> 'REJECTED' OR (rejection_reason IS NOT NULL AND char_length(btrim(rejection_reason)) BETWEEN 3 AND 500)) NOT VALID;

-- ============================================================
-- 5. VALIDATE (la tabla esta vacia: validacion trivial y sin bloquear escrituras)
-- ============================================================
ALTER TABLE honor_instructor_proposals VALIDATE CONSTRAINT honor_instructor_proposals_user_honor_id_fkey;
ALTER TABLE honor_instructor_proposals VALIDATE CONSTRAINT honor_instructor_proposals_proposed_by_id_fkey;
ALTER TABLE honor_instructor_proposals VALIDATE CONSTRAINT honor_instructor_proposals_instructor_user_id_fkey;
ALTER TABLE honor_instructor_proposals VALIDATE CONSTRAINT honor_instructor_proposals_reviewed_by_id_fkey;
ALTER TABLE honor_instructor_proposals VALIDATE CONSTRAINT honor_instructor_proposals_one_instructor_ck;
ALTER TABLE honor_instructor_proposals VALIDATE CONSTRAINT honor_instructor_proposals_name_ck;
ALTER TABLE honor_instructor_proposals VALIDATE CONSTRAINT honor_instructor_proposals_review_ck;
ALTER TABLE honor_instructor_proposals VALIDATE CONSTRAINT honor_instructor_proposals_reason_ck;

-- ============================================================
-- 6. Índices (CONCURRENTLY: fuera de transacción)
-- ============================================================
-- Una sola propuesta pendiente por especialidad. Reemplazar = retirar la anterior
-- en la misma transacción; dos solicitudes simultáneas no pueden dejar dos.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_honor_instructor_proposals_pending
  ON honor_instructor_proposals (user_honor_id)
  WHERE status = 'PENDING';

-- Cola del Campo Local (más antigua primero).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_honor_instructor_proposals_queue
  ON honor_instructor_proposals (created_at)
  WHERE status = 'PENDING';

-- Última propuesta por especialidad (bloque instructor_proposal de getUserHonors).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_honor_instructor_proposals_honor
  ON honor_instructor_proposals (user_honor_id, created_at DESC);

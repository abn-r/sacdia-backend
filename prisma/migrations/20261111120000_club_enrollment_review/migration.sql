-- Revisión de la inscripción anual de sección (club_enrollments).
-- Quién decidió, con qué rol de alcance, cuándo y por qué (motivo del rechazo).
-- Todas las columnas son nullable: las inscripciones existentes quedan sin revisión registrada.

ALTER TABLE "club_enrollments"
  ADD COLUMN "reviewed_by_id" UUID,
  ADD COLUMN "reviewer_role" VARCHAR(50),
  ADD COLUMN "reviewed_at" TIMESTAMPTZ(6),
  ADD COLUMN "decision_reason" TEXT;

ALTER TABLE "club_enrollments"
  ADD CONSTRAINT "club_enrollments_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Fecha de envío del registro anual: al crearlo y cada vez que vuelve a pending_validation.
ALTER TABLE "club_enrollments" ADD COLUMN "submitted_at" TIMESTAMPTZ(6);

UPDATE "club_enrollments" SET "submitted_at" = "created_at" WHERE "submitted_at" IS NULL;

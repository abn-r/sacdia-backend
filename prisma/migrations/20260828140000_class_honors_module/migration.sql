-- Especialidades de clase ancladas a un módulo opcional.
-- Spec: docs/superpowers/specs/2026-08-28-class-module-honors-design.md
-- Informativo: no bloquea progreso ni investidura.

ALTER TABLE "class_honors"
  ADD COLUMN IF NOT EXISTS "module_id" INTEGER;

ALTER TABLE "class_honors"
  DROP CONSTRAINT IF EXISTS "class_honors_module_id_fkey";

ALTER TABLE "class_honors"
  ADD CONSTRAINT "class_honors_module_id_fkey"
  FOREIGN KEY ("module_id") REFERENCES "class_modules"("module_id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX IF NOT EXISTS "idx_class_honors_module"
  ON "class_honors"("module_id");

-- Fase 8: auditoría del desbloqueo explícito de expedientes de la vía anterior.
-- POST /api/v1/admin/investiture/legacy-locks/release deja una fila por
-- enrollment liberado. No cambia investiture_status.
ALTER TYPE "investiture_action_enum" ADD VALUE IF NOT EXISTS 'LEGACY_LOCK_RELEASED';

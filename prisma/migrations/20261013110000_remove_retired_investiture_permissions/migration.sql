-- Migration: 20261013110000_remove_retired_investiture_permissions
-- Fase 8 retiró el pipeline legacy de investidura. Ningún endpoint exige ya
-- estos permisos (verificado con rg sobre src/):
--   investiture:submit, investiture:validate, investiture:mark_invested,
--   investiture_config:read|create|update|delete
-- `investiture:read` NO se toca: lo siguen exigiendo las dos rutas GET de
-- historial en InvestitureController.
--
-- Qué hace: borra las concesiones (users_permissions, role_permissions) y luego
-- las filas del catálogo `permissions`. Las FK fk_permission de ambas tablas ya
-- son ON DELETE CASCADE, por lo que no hay RESTRICT que esquivar; aun así se
-- borran explícitamente en orden hijo -> padre para que el script sea legible y
-- no dependa del CASCADE. No toca tablas de auditoría ni de historial: ninguna
-- referencia `permissions` (no guardan permission_id).
--
-- CÓMO APLICARLA (manual, Neon dev -> staging -> prod; la shadow DB está rota,
-- no uses migrate dev):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f prisma/migrations/20261013110000_remove_retired_investiture_permissions/migration.sql
--
-- `-1` ejecuta todo el archivo en UNA transacción. No incluye BEGIN/COMMIT ni
-- CONCURRENTLY. Es re-ejecutable: sobre una base ya limpia los DELETE afectan 0
-- filas.

DELETE FROM users_permissions
WHERE permission_id IN (
  SELECT permission_id FROM permissions
  WHERE permission_name IN (
    'investiture:submit',
    'investiture:validate',
    'investiture:mark_invested',
    'investiture_config:read',
    'investiture_config:create',
    'investiture_config:update',
    'investiture_config:delete'
  )
);

DELETE FROM role_permissions
WHERE permission_id IN (
  SELECT permission_id FROM permissions
  WHERE permission_name IN (
    'investiture:submit',
    'investiture:validate',
    'investiture:mark_invested',
    'investiture_config:read',
    'investiture_config:create',
    'investiture_config:update',
    'investiture_config:delete'
  )
);

DELETE FROM permissions
WHERE permission_name IN (
  'investiture:submit',
  'investiture:validate',
  'investiture:mark_invested',
  'investiture_config:read',
  'investiture_config:create',
  'investiture_config:update',
  'investiture_config:delete'
);

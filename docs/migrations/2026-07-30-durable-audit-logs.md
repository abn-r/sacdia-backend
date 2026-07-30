# Migración: Durable Audit Logs

**Fecha**: 2026-07-30

**Migración**: `20260730180000_durable_audit_logs`
**Estado**: pendiente de despliegue; el contrato estructural efectivo vive en `prisma/schema.prisma`.

## Objetivo

Extender `audit_logs` sin perder eventos históricos para que los escritores de
auditoría puedan registrar identidad, alcance, objetivo, correlación, resultado
e idempotencia de cada evento.

## Contrato persistido

La migración elimina `audit_logs_action_check` y amplía `action` de
`VARCHAR(20)` a `VARCHAR(64)`. No restringe el vocabulario de acciones: los
escritores deben usar acciones estables y de hasta 64 caracteres.

| Columna                       | Tipo y regla                                                      |
| ----------------------------- | ----------------------------------------------------------------- |
| `event_key`                   | `VARCHAR(160)`, nullable y único cuando tiene valor.              |
| `actor_kind`                  | `VARCHAR(24) NOT NULL DEFAULT 'user'`.                            |
| `actor_role_name`             | `VARCHAR(64)`, nullable.                                          |
| `actor_scope`, `target_scope` | `JSONB`, nullable; describen el alcance del actor y del objetivo. |
| `target_user_id`              | `UUID`, nullable.                                                 |
| `effective_at`                | `TIMESTAMPTZ`, nullable.                                          |
| `correlation_id`              | `UUID`, nullable; enlaza eventos de la misma operación.           |
| `idempotency_key`             | `VARCHAR(128)`, nullable.                                         |
| `result`                      | `VARCHAR(32) NOT NULL DEFAULT 'succeeded'`.                       |

`event_key` usa la restricción `audit_logs_event_key_key`; al ser nullable,
PostgreSQL permite múltiples filas históricas sin clave. La migración no agrega
una restricción única a `idempotency_key`.

## Acceso y operación

Se crean los índices `idx_audit_logs_actor_created`,
`idx_audit_logs_target_created`, `idx_audit_logs_action_created` e
`idx_audit_logs_correlation_id` para consultas por actor, objetivo, acción y
correlación. Los índices de actor, objetivo y acción ordenan `created_at DESC`.

Todo el cambio se ejecuta dentro de una transacción. Las filas existentes se
conservan: reciben los defaults `actor_kind='user'` y `result='succeeded'`; el
resto de las columnas nuevas queda en `NULL`.

## Archivos relacionados

- `prisma/migrations/20260730180000_durable_audit_logs/migration.sql`
- `prisma/schema.prisma`
- `src/audit-logs/durable-audit-schema.migration.spec.ts`

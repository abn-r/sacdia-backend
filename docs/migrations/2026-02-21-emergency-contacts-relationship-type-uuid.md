# Migración: Emergency Contacts Relationship Type a UUID

**Fecha**: 2026-02-21  
**Migración**: `20260220113000_emergency_contacts_relationship_type_uuid`  
**Estado**: ✅ Aplicada en base remota

## Contexto

`emergency_contacts.relationship_type` estaba en `INT` (catálogo legacy `relationship_type`) mientras el catálogo vigente es `relationship_types` con PK UUID (`relationship_type_id`).

## Objetivo

Unificar la relación de `emergency_contacts` hacia `relationship_types` para usar UUID de forma consistente con el resto del backend.

## Cambios realizados por la migración

1. Elimina FK legacy:
   - `emergency_contacts_relationship_type_fkey`
2. Agrega columna nueva:
   - `emergency_contacts.relationship_type_id UUID`
3. Ejecuta backfill por nombre (`relationship_type.name` -> `relationship_types.name`).
4. Falla explícitamente si quedan filas sin mapear.
5. Marca `relationship_type_id` como `NOT NULL`.
6. Crea nueva FK:
   - `emergency_contacts_relationship_type_id_fkey`
   - referencia a `relationship_types.relationship_type_id`
7. Elimina columna legacy:
   - `relationship_type`
8. Crea índice:
   - `idx_emergency_contacts_relationship_type_id`

## Evidencia de estado final

- `relationship_type_id` existe en `emergency_contacts` como `uuid` y `NOT NULL`.
- FK activa hacia `relationship_types.relationship_type_id`.
- Columna `relationship_type` eliminada.

## Archivos relacionados

- `prisma/migrations/20260220113000_emergency_contacts_relationship_type_uuid/migration.sql`
- `prisma/schema.prisma`
- `src/emergency-contacts/dto/create-emergency-contact.dto.ts`
- `src/emergency-contacts/emergency-contacts.service.ts`
- `src/admin/admin-users.service.ts`


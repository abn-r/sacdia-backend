# Database Sync - February 5, 2026

> [!IMPORTANT]
> Registro histórico del baseline aplicado el **2026-02-05**.
> No reemplaza el estado actual de migraciones en el repositorio.
> Ver también:
> - `README.md` (operación actual)
> - `docs/IMPLEMENTATION-SESSION-2026-02-13-admin-hardening.md` (migración FCM 20260204)

## Resumen

Sincronización de schema con base de datos usando `prisma db push` debido a problemas con shadow database en Supabase.

## Contexto

- **Fecha**: 5 de febrero, 2026
- **Método**: `prisma db push --accept-data-loss`
- **Razón**: Error P3006 con shadow database (schema 'extensions' no existe en DB temporal)
- **Estado previo**: Schema local tenía cambios no aplicados desde commit 60b3d3f (mejoras al módulo honors)

## Cambios Aplicados a Supabase

### 1. Tabla `users_honors` ✅

**Restricción única añadida:**
```sql
CREATE UNIQUE INDEX "users_honors_user_id_honor_id_key"
ON "users_honors"("user_id", "honor_id");
```

**Índice añadido:**
```sql
CREATE INDEX "idx_users_honors_user_id" ON "users_honors"("user_id");
```

**Propósito**: Prevenir que un usuario pueda inscribirse dos veces en el mismo honor (integridad de datos).

### 2. Tabla `certification_module_progress` ✅

**Campos añadidos:**
```sql
ALTER TABLE "certification_module_progress"
ADD COLUMN "completed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "completion_date" TIMESTAMPTZ(6);
```

**Propósito**: Rastrear estado de completitud de módulos de certificación.

### 3. Tabla `certification_section_progress` ✅

**Campos añadidos:**
```sql
ALTER TABLE "certification_section_progress"
ADD COLUMN "completed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "completion_date" TIMESTAMPTZ(6);
```

**Propósito**: Rastrear estado de completitud de secciones de certificación.

### 4. Tabla `certifications` ✅

**Campo añadido:**
```sql
ALTER TABLE "certifications"
ADD COLUMN "duration_hours" INTEGER;
```

**Propósito**: Almacenar duración estimada de cada certificación.

### 5. Tabla `folder_assignments` ✅

**Campos añadidos:**
```sql
ALTER TABLE "folder_assignments"
ADD COLUMN "club_adv_id" INTEGER,
ADD COLUMN "club_mg_id" INTEGER,
ADD COLUMN "club_pathf_id" INTEGER,
ADD COLUMN "completion_date" TIMESTAMPTZ(6),
ADD COLUMN "progress_percentage" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN "status" TEXT DEFAULT 'IN_PROGRESS',
ADD COLUMN "total_points" INTEGER DEFAULT 0;
```

**Propósito**: Soportar asignaciones de carpetas por club (no por usuario) y rastrear progreso.

### 6. Defaults UUID actualizados ✅

Varias tablas ahora usan `extensions.uuid_generate_v4()` como default:
- `club_role_assignments.assignment_id`
- `legal_representatives.id`
- `permissions.permission_id`
- `relationship_types.relationship_type_id`
- `role_permissions.role_permission_id`
- `roles.role_id`
- `users_permissions.user_permission_id`
- `users_roles.user_role_id`

### 7. Foreign Key añadida ✅

```sql
ALTER TABLE "club_inventory"
ADD CONSTRAINT "club_inventory_inventory_category_id_fkey"
FOREIGN KEY ("inventory_category_id")
REFERENCES "inventory_categories"("inventory_category_id")
ON DELETE NO ACTION ON UPDATE NO ACTION;
```

## Verificación

```bash
# Verificar que no hay duplicados antes del push
npx prisma db execute --file check_duplicates.sql
# Resultado: 0 duplicados ✅

# Aplicar cambios
npx prisma db push --accept-data-loss
# Resultado: Success in 4.36s ✅

# Verificar restricción única creada
npx prisma db pull --print | grep -A 20 "model users_honors"
# Resultado: @@unique([user_id, honor_id]) ✅
```

## Notas Importantes

1. **No se creó archivo de migración**: Usamos `db push` en lugar de `migrate dev` debido al error P3006
2. **No hubo pérdida de datos**: Verificamos que no existían duplicados antes de aplicar la restricción única
3. **Base de datos sincronizada**: El schema de Prisma ahora coincide 100% con la base de datos de Supabase
4. **Próximas migraciones**: Pueden usar `migrate dev` normalmente, este push estableció la baseline

## Relacionado con Commits

- **60b3d3f**: "feat: implement honors module security and data integrity improvements"
  - Este commit incluyó los cambios al schema que ahora fueron aplicados

## Próximos Pasos

✅ Ya completados:
- [x] Aplicar restricción única a `users_honors`
- [x] Sincronizar todos los cambios pendientes de schema
- [x] Verificar que no hay pérdida de datos
- [x] Documentar cambios aplicados

⚠️ Recomendaciones:
- Las próximas migraciones deberían usar `migrate dev` normalmente
- Si el error P3006 persiste, considerar usar un pooler de conexión diferente o configurar `shadowDatabaseUrl`
- Mantener este documento como referencia de la baseline del 5 de febrero

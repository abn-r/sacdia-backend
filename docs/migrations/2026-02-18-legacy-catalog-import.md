# Importacion de Catalogos Legacy (Respaldos SQL)

Este proyecto incluye el script `scripts/import-legacy-catalogs.ts` para cargar respaldos legacy desde:

- `/Users/abner/Downloads/Sacdia/Respaldos`

## Que hace

- Lee cada archivo `*_rows.sql` en orden de dependencias.
- Reutiliza los `INSERT` legacy y convierte diferencias de esquema:
  - `club_types.ct_id -> club_types.club_type_id`
  - `districts.district_id -> districts.districlub_type_id`
  - `churches.district_id -> churches.districlub_type_id`
- Remapea IDs legacy a IDs reales de la DB para preservar FKs en cadena:
  - `countries -> unions -> local_fields -> districts -> churches`
- Si faltan IDs de `honors_categories` requeridos por `honors`, crea placeholders
  `Legacy Category <id>` automaticamente para permitir la carga.
- Inserta con `ON CONFLICT DO NOTHING` (idempotente).
- Intenta sincronizar secuencias en tablas con PK autoincremental.
- Reporta por archivo: filas parseadas, insertadas y fallidas.

## Modo validacion (sin escribir en DB)

```bash
pnpm import:legacy-catalogs -- --dry-run
```

Opcional: cambiar carpeta origen

```bash
pnpm import:legacy-catalogs -- --dry-run --source /ruta/a/respaldos
```

## Modo importacion real

Requiere `DATABASE_URL` en el ambiente:

```bash
pnpm import:legacy-catalogs
```

Con carpeta origen personalizada:

```bash
pnpm import:legacy-catalogs -- --source /ruta/a/respaldos
```

## Notas

- `role_permissions_rows.sql` se omite intencionalmente en este flujo.
- `relationship_type_rows.sql` se omite intencionalmente en este flujo.
- `honors_rows.sql` depende de `honors_categories` y `master_honors` (el script autocompleta categorias faltantes por id).
- El script deja evidencia de errores por fila (muestra ejemplos en consola).

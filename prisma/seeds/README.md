# Seeds

Orden obligatorio en base fresca:

1. `prisma/seed.ts` — crea filas de catálogo, **incluyendo roles**.
2. `prisma/seeds/permissions.seed.sql` — crea permisos.
3. `prisma/seeds/role-permissions.seed.sql` — asigna permisos a roles existentes.

El SQL de grants **no INSERTA roles**. Usa `INSERT … SELECT` contra `roles`. Si el rol no existe, el JOIN devuelve 0 filas y el grant es no-op.

No fusionar el SQL a TypeScript. No correr `prisma db seed` contra Neon desde este trabajo.

## Otros seeds (opcionales, se ejecutan a mano)

SQL idempotentes (`psql "$DATABASE_URL" -f <archivo>`):

| Archivo | Contenido |
| --- | --- |
| `role-slot-limits.seed.sql` | Límites de cupo por rol. |
| `system-config.seed.sql` | Valores de `system_config`. |
| `inventory-categories.sql`, `inventory-items.sql` | Categorías e ítems de inventario de ejemplo (`check-categories.sql` solo consulta). |

Scripts TypeScript (`pnpm exec tsx <archivo>`):

| Archivo | Contenido |
| --- | --- |
| `core.ts` (`pnpm prisma:seed:core`) | Base operativa de desarrollo (usuarios, asignaciones, unidades, inscripciones). Solo corre contra la rama de desarrollo de Neon salvo `SACDIA_CORE_SEED_ALLOW_ANY_DB=1`. Admite `--dry-run`. |
| `test-users.seed.ts` | Un usuario por rol administrativo para probar RBAC. |
| `achievements.seed.ts` | Categorías y logros iniciales (upsert). |
| `folder-templates.seed.ts` | Plantillas borrador de carpeta anual por tipo de club y año eclesiástico. |
| `honor-requirements.seed.ts` (`--dry-run`) | Requisitos de especialidades. |
| `honor-requirements-rescan.seed.ts` (`--apply`) | Re-escaneo de requisitos con parseo mejorado (dry-run por defecto). |
| `certifications/basic-pathfinder-staff-training.seed.ts` | Certificación de capacitación básica del personal de Conquistadores. |
| `verify-inventory.ts` | Verificación del inventario sembrado. |

Los seeds de requisitos de especialidades leen `docs/working/honors-especialidades/` del workspace `sacdia` (`index.csv` y `md/`). No muevas esa carpeta sin actualizar las rutas de los seeds.

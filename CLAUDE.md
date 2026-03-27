# SACDIA Backend - Contexto Rápido

Backend NestJS para SACDIA con Prisma + Neon + Better Auth.

## Comandos clave

```bash
pnpm install
pnpm run start:dev
pnpm run build
pnpm run start:prod
pnpm run test
pnpm run test:e2e
pnpm run test:cov
pnpm prisma migrate deploy
pnpm run verify:fcm-migration
```

## Módulos principales

```text
src/
├── auth
├── better-auth        # BetterAuthModule + BetterAuthService (Wave 3)
├── users
├── catalogs
├── clubs
├── classes
├── honors
├── activities
├── finances
├── camporees
├── notifications
├── certifications
├── folders
├── inventory
├── rbac
├── admin
├── evidence-review    # EvidenceReviewModule — validación de evidencias (7 endpoints)
├── analytics          # AnalyticsModule — SLA dashboard y métricas operacionales
├── common
└── prisma
```

## Stack

- NestJS 11 + TypeScript
- Prisma 7 + PostgreSQL (Neon)
- JWT via HS256 usando `BETTER_AUTH_SECRET` (Option C: BA handles auth, SACDIA signs JWT)
- Redis (opcional) con fallback a in-memory
- Firebase FCM
- Sentry

## Convenciones operativas

- Prefijo y versionado: `/api/v1/*`
- Swagger: `/api`
- Health: `/api/v1/health`
- Respuesta admin: `{ status, data }`

## Seguridad

- `JwtAuthGuard` en endpoints protegidos.
- `GlobalRolesGuard` para administración (`admin|super_admin`).
- `OwnerOrAdminGuard` para recursos por usuario.

## Migraciones recientes

- **`is_joint` en activities**: Campo booleano (default false). Actividades conjuntas crean multiples `activity_instances`, una por seccion. El `PermissionsGuard` verifica autorizacion contra todas las secciones participantes.
- **`evidence_validation_enum`**: Enum previamente definido pero no utilizado. Migrado: 6 servicios que usaban VARCHAR con valores en español (`pendiente`, `validada`, `rechazada`) ahora usan el enum (`PENDING`, `VALIDATED`, `REJECTED`). Afecta `folders_section_records.status` y `class_section_progress.status`.
- **Honor images → evidence_files**: Migracion SQL con `jsonb_array_elements` que extrajo URLs del JSON legacy `users_honors.images` hacia filas en `evidence_files` con FK `user_honor_id`. El servicio de honores usa dual-read (evidence_files primario, JSON fallback).
- **UpdateActivityDto**: Acepta `club_section_ids` para reasociar secciones en actividades conjuntas. Usa patron upsert (activar/desactivar) por el unique constraint `(activity_id, club_section_id)`.

## Documentación

- Referencia operativa actual: `README.md`
- Implementación admin/notificaciones: `docs/IMPLEMENTATION-SESSION-2026-02-13-admin-hardening.md`
- Índice de documentación local: `docs/README.md`
- Fuente funcional global (monorepo padre): `../../docs`

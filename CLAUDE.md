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

**Variables de entorno**: `.env.example` es la fuente de verdad para todos los nombres de env vars.
Copiar a `.env` y completar los valores. Claves marcadas `# <SECRET>` nunca deben commitearse.

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
├── resources          # ResourcesModule — categorías + recursos (14 endpoints)
├── common
└── prisma
```

## Stack

- NestJS 11 + TypeScript
- Prisma 7 + PostgreSQL (Neon)
- JWT via HS256 usando `BETTER_AUTH_SECRET` (Option C: BA handles auth, SACDIA signs JWT)
- Redis — cache-aside para 14 catálogos (TTL 1h; año eclesiástico 24h). Auto-invalidación en mutaciones admin. Endpoint manual: `POST /api/v1/admin/catalogs/cache/invalidate` (`catalogs:update`). Graceful fallback a DB si Redis no disponible. Reconexión: retry 1x en dev, backoff exponencial en prod.
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
- **FCM realtime invalidation**: Nuevo job type `realtime.invalidate` en la cola `notifications` (BullMQ). API pública: `NotificationsService.sendSilentToSection(sectionId, resource, action, entityId, actorId)` — cualquier módulo puede llamarla para extender la invalidación a otras entidades (`members`, `monthly_reports`, etc.). El processor (`NotificationsProcessor.handleRealtimeInvalidate`) consulta `user_fcm_tokens` filtrando por `users.club_role_assignments.club_section_id` + grants activos y excluye al actor. Payload FCM: `data: { type: 'cache_invalidate', sectionId, resource, action: CREATED|UPDATED|DELETED, entityId, actorId, timestamp }` — data-only, APNS `content-available:1`, Android high priority. Hooked en `ActivitiesService.create/update/remove/createJointActivity` como fire-and-forget (sin `await`) para no bloquear la respuesta.

## Documentación

- Referencia operativa actual: `README.md`
- Implementación admin/notificaciones: `docs/IMPLEMENTATION-SESSION-2026-02-13-admin-hardening.md`
- Índice de documentación local: `docs/README.md`
- Fuente funcional global (monorepo padre): `../../docs`

## CI/CD

- Runtime: Node 22.x + pnpm 10 + `actions/setup-node@v4`
- `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` habilitado en el pipeline
- Deploy: Render.com (los pasos de Vercel fueron removidos)
- ESLint: reglas `no-unsafe-*` deshabilitadas para compatibilidad con Prisma (8328 → 0 errores)
- Jest: `transformIgnorePatterns: []` para paquetes ESM; `prisma generate` corre antes de los tests
- Unit tests: `continue-on-error: true` hasta estabilizar suite
- BullMQ: handlers `error`/`failed` en workers para prevenir crashes por desconexión de Redis
- `process.on('uncaughtException'/'unhandledRejection')` como red de seguridad en producción

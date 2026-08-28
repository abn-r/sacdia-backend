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
pnpm run audit:security
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
├── annual-folders    # Carpeta Anual de Evidencias (flujo canónico)
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
- Prisma 7.8 + PostgreSQL (Neon)
- JWT via HS256 usando `BETTER_AUTH_SECRET` (Option C: BA handles auth, SACDIA signs JWT; `iss=https://api.sacdia.app`, `aud=sacdia:access`). QR member tokens usan `QR_JWT_SECRET` distinto (`aud=sacdia:qr-member`).
- Redis (`CACHE_MANAGER`, fail-fast en prod; fallback in-memory solo en dev/test):
  - catálogos geográficos/referencia (`cache:catalogs:*`, TTL 1h; año eclesiástico actual 24h);
  - catálogo público de honores agrupado + categorías (`cache:catalogs:honors:*`, TTL 1h; invalidación por epoch al mutar honores, categorías o tipos de club);
  - categorías de recursos, inventario y finanzas (`cache:catalogs:resource_categories|inventory_categories|finance_categories:*`, TTL 1h);
  - división default de scoring (`cache:catalogs:scoring_default_division`, TTL 1h);
  - contexto de autorización (`auth:context:v3:{userId}`, TTL 5 min);
  - blacklist JWT y lista de sesiones concurrentes.
  Invalidación en mutaciones admin. Endpoint manual: `POST /api/v1/admin/catalogs/cache/invalidate` (`catalogs:update`). Si Redis cae en runtime, lecturas de catálogo caen a DB.
- BullMQ: colas `emails`, `notifications`, `achievements`, `background-jobs`. HTTP encola recálculo de rankings y generate/regenerate de informe mensual (202; poll GET). Cron nightly de rankings sigue club-only. Sin Redis, esos HTTP corren inline; data export responde 503.
- Memoria del proceso (`Map` en el servicio, **no** Redis — canon SLA): dashboards SLA / operaciones / campo local, TTL 60s. Cada instancia tiene su copia. `CatalogCacheService.inFlightLoads` solo coalese misses concurrentes.
- Firebase FCM
- Sentry

## Convenciones operativas

- Prefijo y versionado: `/api/v1/*`
- Swagger: `/api`
- Health: `/api/v1/health`
- Respuesta admin: `{ status, data }`

## Seguridad

- `JwtAuthGuard` en endpoints protegidos.
- `GlobalRolesGuard` para administración (`admin|super-admin`).
- `OwnerOrAdminGuard` para recursos por usuario.

## Migraciones recientes

- **`is_joint` en activities**: Campo booleano (default false). Actividades conjuntas crean multiples `activity_instances`, una por seccion. El `PermissionsGuard` verifica autorizacion contra todas las secciones participantes.
- **`evidence_validation_enum`**: Enum previamente definido pero no utilizado. Migrado: 6 servicios que usaban VARCHAR con valores en español (`pendiente`, `validada`, `rechazada`) ahora usan el enum (`PENDING`, `VALIDATED`, `REJECTED`). Afecta `folders_section_records.status` y `class_section_progress.status`.
- **Honor images → evidence_files**: Migracion SQL con `jsonb_array_elements` que extrajo URLs del JSON legacy `users_honors.images` hacia filas en `evidence_files` con FK `user_honor_id`. El servicio de honores usa dual-read (evidence_files primario, JSON fallback).
- **UpdateActivityDto**: Acepta `club_section_ids` para reasociar secciones en actividades conjuntas. Usa patron upsert (activar/desactivar) por el unique constraint `(activity_id, club_section_id)`.
- **FCM realtime invalidation**: Nuevo job type `realtime.invalidate` en la cola `notifications` (BullMQ). API pública: `NotificationsService.sendSilentToSection(sectionId, resource, action, entityId, actorId)` — cualquier módulo puede llamarla para extender la invalidación a otras entidades (`members`, `monthly_reports`, etc.). El processor (`NotificationsProcessor.handleRealtimeInvalidate`) consulta `user_fcm_tokens` filtrando por `users.club_role_assignments.club_section_id` + grants activos y excluye al actor. Payload FCM: `data: { type: 'cache_invalidate', sectionId, resource, action: CREATED|UPDATED|DELETED, entityId, actorId, timestamp }` — data-only, APNS `content-available:1`, Android high priority. Hooked en `ActivitiesService.create/update/remove/createJointActivity` como fire-and-forget (sin `await`) para no bloquear la respuesta.
- **i18n generic catalogs (12 nuevas tablas)**: Approach X extendido a 12 catálogos genéricos. Migraciones bundled `20260511120000_geography_translations` (countries/unions/local_fields/districts/churches) y `20260511130000_reference_translations` (relationship_types UUID FK / allergies / diseases / medicines / club_types / club_ideals con `name`+`ideal` / activity_types). Total cobertura i18n actual: 24 catálogos (12 Phase E + 12 nuevos). Cada tabla `_translations`: BIGSERIAL PK + FK con `ON DELETE CASCADE` + `CHECK ("locale" <> 'es')` + `UNIQUE (<fk>, locale)`. `AdminGeographyService` ahora inyecta `TranslationService`; `AdminReferenceService` ya lo tenía. Reads admin incluyen `translations` para hidratar form de edit; reads públicos en `catalogs.service.ts` permanecen locale-agnostic (i18n admin-only en este cambio). club-ideals usa explícito `fields: ['name', 'ideal']` en `upsertTranslations` (NOT default `['name', 'description']`).

## Documentación

- Referencia operativa actual: `README.md`
- Implementación admin/notificaciones: `docs/IMPLEMENTATION-SESSION-2026-02-13-admin-hardening.md`
- Índice de documentación local: `docs/README.md`
- Fuente funcional global (monorepo padre): `../../docs`

## CI/CD

- Runtime: Node 24.x (`engines.node: >=24 <25`) + pnpm 10 + `actions/setup-node@v4`
- `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` sigue habilitado para que las acciones JavaScript corran alineadas con Node 24.
- Deploy: Render.com (los pasos de Vercel fueron removidos)
- ESLint: reglas `no-unsafe-*` deshabilitadas para compatibilidad con Prisma (8328 → 0 errores)
- Jest: `transformIgnorePatterns: []` para paquetes ESM; `prisma generate` corre antes de los tests
- Unit tests: bloqueantes; el job ya no usa `continue-on-error`
- Dependency audit: job `Dependency Audit` corre `pnpm run audit:security` (high/critical + allowlist). Bloqueante.
- Rate limiting: `@nestjs/throttler` usa storage Redis distribuido cuando `REDIS_URL` está configurado.
  En producción, Redis es requerido y la app falla al iniciar si falta, es inválido o no conecta.
  En `NODE_ENV=development` los límites son más altos (30/s, 200/10s, 1000/min) para soportar fetches paralelos del admin.
- BullMQ: handlers `error`/`failed` en workers para prevenir crashes por desconexión de Redis
- `process.on('uncaughtException'/'unhandledRejection')` como red de seguridad en producción

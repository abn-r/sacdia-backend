# SACDIA Backend

API REST de SACDIA construida con NestJS, Prisma y PostgreSQL (Supabase).

> Documentacion oficial del proyecto: `/Users/abner/Documents/development/sacdia/docs` (repositorio padre).
> Este README es una vista operativa del backend y debe mantenerse sincronizado con esa fuente.

## Estado actual (2026-02-13)

- Endpoints admin para catálogos habilitados bajo `/api/v1/admin/*`.
- Notificaciones y FCM tokens endurecidos con JWT + roles.
- Health check extendido con estado de dependencias (`db`, `cache`, `fcm`, `sentry`).
- Script de verificación de migración FCM disponible (`pnpm run verify:fcm-migration`).

## Stack

- NestJS 11
- Prisma 7 (`@prisma/adapter-pg`)
- PostgreSQL (Supabase)
- Auth JWT con Supabase
- Cache con Redis (fallback a in-memory)
- Firebase Admin (FCM)
- Sentry

## Estructura principal

```text
src/
├── auth/
├── users/
├── catalogs/
├── clubs/
├── classes/
├── honors/
├── activities/
├── finances/
├── notifications/
├── admin/
├── rbac/
├── common/
├── prisma/
└── main.ts
```

## Requisitos

- Node.js 20+
- pnpm
- Acceso a PostgreSQL (Supabase)

## Setup rápido

```bash
pnpm install
cp .env.example .env
pnpm run build
pnpm run start:dev
```

## Scripts

```bash
# App
pnpm run start:dev
pnpm run build
pnpm run start:prod

# Tests
pnpm run test
pnpm run test:e2e
pnpm run test:cov

# Prisma
pnpm prisma migrate deploy
pnpm run verify:fcm-migration

# Utilidades
pnpm run generate:spec
pnpm run load-test
```

## Variables de entorno

### Requeridas

- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`

### Recomendadas para producción

- `REDIS_URL`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_CLIENT_EMAIL`
- `SENTRY_DSN`
- `ALLOWED_ORIGINS`

Notas:
- Si `REDIS_URL` falla, el backend usa cache in-memory (no recomendado para prod).
- Si FCM no inicializa correctamente, notificaciones push quedan deshabilitadas.

## API

- Base URL: `/api/v1`
- Swagger: `/api`
- Health: `GET /api/v1/health`

## Seguridad implementada

- `JwtAuthGuard` para endpoints protegidos.
- `GlobalRolesGuard` para rutas administrativas.
- `OwnerOrAdminGuard` para recursos por usuario cuando aplica.
- Hardening de notificaciones:
  - `/api/v1/notifications/*` requiere JWT.
  - `/api/v1/fcm-tokens/*` requiere JWT.
  - `POST /api/v1/notifications/broadcast` restringido a `admin|super_admin`.
  - `POST /api/v1/notifications/club/:instanceType/:instanceId` restringido a `admin|super_admin`.

## Contrato FCM actualizado

- Registro de token:
  - `POST /api/v1/fcm-tokens`
  - El `userId` se toma del JWT autenticado (ya no se envía en body).
- Listado propio:
  - `GET /api/v1/fcm-tokens`
- Desregistro propio:
  - `DELETE /api/v1/fcm-tokens/:token`
- Compatibilidad:
  - `GET /api/v1/fcm-tokens/user/:userId` (owner/admin)

## Endpoints admin (Fase 3 mínima)

Rutas bajo `/api/v1/admin/*` con JWT + roles `admin|super_admin`.

### Geografía

- `GET|POST /countries`
- `PATCH|DELETE /countries/:countryId`
- `GET|POST /unions`
- `PATCH|DELETE /unions/:unionId`
- `GET|POST /local-fields`
- `PATCH|DELETE /local-fields/:localFieldId`
- `GET|POST /districts`
- `PATCH|DELETE /districts/:districtId`
- `GET|POST /churches`
- `PATCH|DELETE /churches/:churchId`

### Referencia

- `GET|POST /relationship-types`
- `PATCH|DELETE /relationship-types/:relationshipTypeId`
- `GET|POST /allergies`
- `PATCH|DELETE /allergies/:allergyId`
- `GET|POST /diseases`
- `PATCH|DELETE /diseases/:diseaseId`
- `GET|POST /ecclesiastical-years`
- `PATCH|DELETE /ecclesiastical-years/:yearId`

## OAuth

- `POST /api/v1/auth/oauth/google`
- `POST /api/v1/auth/oauth/apple`
- `GET /api/v1/auth/oauth/callback`
- `GET /api/v1/auth/oauth/providers`
- `DELETE /api/v1/auth/oauth/:provider`

## Verificación recomendada antes de release

```bash
pnpm run build
pnpm run test -- src/notifications/fcm-tokens.service.spec.ts
pnpm run test:e2e -- test/notifications-security.e2e-spec.ts test/admin-catalogs.e2e-spec.ts
pnpm prisma migrate deploy
pnpm run verify:fcm-migration
```

## Documentación del proyecto

- Índice local de documentos: `docs/README.md`
- Sesión de implementación de admin/notificaciones: `docs/IMPLEMENTATION-SESSION-2026-02-13-admin-hardening.md`
- Referencia histórica de implementación previa: `docs/IMPLEMENTATION-SESSION-2026-02-05.md`
- Referencia de baseline DB: `docs/migrations/2026-02-05-db-push-sync.md`

Nota: la documentación funcional oficial del producto vive en el repositorio padre (`../../docs`).

# SACDIA Backend - Contexto Rápido

Backend NestJS para SACDIA con Prisma + Supabase.

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
├── common
└── prisma
```

## Stack

- NestJS 11 + TypeScript
- Prisma 7 + PostgreSQL (Supabase)
- JWT con `SUPABASE_JWT_SECRET`
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

## Documentación

- Referencia operativa actual: `README.md`
- Implementación admin/notificaciones: `docs/IMPLEMENTATION-SESSION-2026-02-13-admin-hardening.md`
- Índice de documentación local: `docs/README.md`
- Fuente funcional global (monorepo padre): `../../docs`

# Implementación: Hardening Notificaciones + Admin CRUD

**Fecha**: 2026-02-13  
**Estado**: ✅ Implementado + validado localmente (pendiente validación en staging/prod)  
**Scope**: BE-201, BE-203, BE-205, BE-206, BE-207, BE-208, BE-209, BE-210

## Cambios Implementados

### 1. Hardening de Notificaciones (BE-201)

- `notifications` y `fcm-tokens` ahora exigen JWT (`JwtAuthGuard`).
- `broadcast` y `notifications/club/*` requieren rol global `admin|super_admin`.
- Registro de token FCM toma `userId` del JWT, no del body.
- Desregistro de token valida ownership (el usuario solo puede desactivar tokens propios).

Archivos:

- `src/notifications/notifications.controller.ts`
- `src/notifications/fcm-tokens.service.ts`
- `src/auth/strategies/jwt.strategy.ts`

### 2. Observabilidad/Dependencias productivas (BE-203)

- Sentry habilitado condicionalmente vía `SENTRY_DSN`.
- `SentryInterceptor` activado solo cuando Sentry está configurado.
- `GET /api/v1/health` ahora reporta estado de:
  - base de datos
  - cache
  - configuración/inicialización FCM
  - configuración Sentry

Archivos:

- `src/main.ts`
- `src/health/health.controller.ts`

### 3. Módulo Admin Base + CRUD Geografía/Referencia (BE-205/206/207)

Se creó `AdminModule` con rutas bajo `/api/v1/admin/*`, protegidas por:

- `JwtAuthGuard`
- `GlobalRolesGuard`
- `@GlobalRoles('super_admin', 'admin')`

Controladores:

- `AdminGeographyController`
- `AdminReferenceController`

Servicios:

- `AdminGeographyService`
- `AdminReferenceService`

DTOs:

- `src/admin/dto/geography.dto.ts`
- `src/admin/dto/reference.dto.ts`

Incluye operaciones:

- Geografía: countries, unions, local-fields, districts, churches
- Referencia: relationship-types, allergies, diseases, ecclesiastical-years

Reglas incluidas:

- Soft delete por `active=false`
- Validación de jerarquía (padres existentes)
- Conflictos por duplicados normalizados
- Validación básica de dependencias activas antes de desactivar
- Unicidad de año eclesiástico activo

### 4. Auditoría de mutaciones admin (BE-208)

Cada mutación admin (`POST/PATCH/DELETE`) registra evento estructurado en logs con:

- acción
- recurso
- id del recurso
- actor (user id)
- timestamp

Archivos:

- `src/admin/admin-geography.service.ts`
- `src/admin/admin-reference.service.ts`

### 5. Pruebas y regresión (BE-209)

Se agregaron pruebas para seguridad y contratos principales:

- `src/notifications/fcm-tokens.service.spec.ts`
- `test/notifications-security.e2e-spec.ts`
- `test/admin-catalogs.e2e-spec.ts`

### 6. Documentación y handoff (BE-210)

- README actualizado con:
  - contrato actualizado de notificaciones/FCM
  - nuevos endpoints admin
  - verificación de migración FCM
- Script nuevo para validar migración FCM:
  - `pnpm run verify:fcm-migration`
  - archivo: `scripts/verify-fcm-migration.ts`

---

## Pendientes Operativos por Entorno (staging/prod)

Pendientes para cerrar salida a producción real:

1. Aplicar/verificar migración FCM en **staging/prod**.
2. Configurar variables reales de Redis/FCM/Sentry en plataforma de despliegue.
3. Ejecutar E2E contra infraestructura real de notificaciones push.

## Ejecución Checklist (2026-02-13)

Validaciones ejecutadas localmente sobre el entorno configurado en `.env`:

1. `pnpm run build` ✅
2. `pnpm run test -- src/notifications/fcm-tokens.service.spec.ts` ✅ (6/6)
3. `pnpm run test:e2e -- test/notifications-security.e2e-spec.ts test/admin-catalogs.e2e-spec.ts` ✅ (9/9)
4. `pnpm prisma migrate deploy` ✅ (aplicada `20260204_add_user_fcm_tokens`)
5. `pnpm run verify:fcm-migration` ✅ (tabla + índices OK)
6. `GET /api/v1/health` en `start:prod` ✅ (`status: ok`, DB/cache OK)

Ajustes operativos aplicados durante la ejecución:

- `package.json`: `start:prod` corregido de `node dist/main` a `node dist/src/main.js`.
- `src/main.ts`: reemplazo de `json/urlencoded` de `express` por `app.useBodyParser(...)` para evitar dependencia directa en runtime.
- `scripts/verify-fcm-migration.ts`: actualizado para Prisma 7 (`PrismaPg` + `Pool`) y carga de entorno con `dotenv/config`.

Riesgos detectados para release real:

1. Redis con URL inválida (`REDIS_URL_VALID=NO`), la app hace fallback a cache en memoria.
2. FCM no inicializa (private key inválida PEM), aunque variables existen.
3. Falta repetir este checklist en staging/prod para cerrar evidencia por entorno.

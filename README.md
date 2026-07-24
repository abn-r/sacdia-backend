# SACDIA Backend

API REST de SACDIA construida con NestJS, Prisma y PostgreSQL (Neon).

> Documentacion oficial del proyecto: `/Users/abner/Documents/development/sacdia/docs` (repositorio padre).
> Este README es una vista operativa del backend y debe mantenerse sincronizado con esa fuente.

## Estado actual (2026-03-04)

- Endpoints admin para catálogos habilitados bajo `/api/v1/admin/*`.
- Endpoints públicos de catálogo de salud habilitados:
  - `GET /api/v1/catalogs/allergies`
  - `GET /api/v1/catalogs/diseases`
- Endpoints de usuario para persistir salud habilitados:
  - `PUT /api/v1/users/:userId/allergies`
  - `PUT /api/v1/users/:userId/diseases`
  - `DELETE /api/v1/users/:userId/allergies/:allergyId` (borrado lógico)
  - `DELETE /api/v1/users/:userId/diseases/:diseaseId` (borrado lógico)
- `PATCH /api/v1/users/:userId` ampliado para aceptar también:
  - `country_id`
  - `union_id`
  - `local_field_id`
- Migración aplicada: `emergency_contacts.relationship_type_id` ahora referencia
  `relationship_types.relationship_type_id` (UUID).
- Notificaciones y FCM tokens endurecidos con JWT + roles.
- Health check extendido con estado de dependencias (`db`, `cache`, `fcm`, `sentry`).
- Script de verificación de migración FCM disponible (`pnpm run verify:fcm-migration`).
- Sesiones Auth estabilizadas:
  - `POST /api/v1/auth/login` retorna `accessToken`, `refreshToken`, `expiresAt`, `tokenType`.
  - `POST /api/v1/auth/refresh` mantiene `refreshToken` como contrato oficial.
  - Ventana temporal legacy activa: `refresh_token` permitido del **2026-03-04** al **2026-03-18**.
  - `POST /api/v1/auth/logout` en modo fail-safe (best effort) para evitar bloqueo con access token expirado.

## Stack

- NestJS 11
- Prisma 7.8 (`@prisma/adapter-pg`)
- PostgreSQL (Neon)
- Auth JWT con Better Auth (self-hosted)
- Cache con Redis (fail-fast en producción; fallback a memoria solo en desarrollo/test)
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

- Node.js 24.x (`>=24 <25`)
- pnpm
- Acceso a PostgreSQL (Neon)

## Setup rápido

```bash
# Start local Redis for BullMQ + cache (required in dev):
docker compose up -d redis

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
pnpm run prisma:seed:core
pnpm run verify:fcm-migration

# Utilidades
pnpm run generate:spec
pnpm run load-test
pnpm run benchmark:smoke
pnpm run benchmark:baseline
pnpm run benchmark:stress
pnpm run benchmark:spike
pnpm run migrate:storage-urls:r2
```

## Benchmarking

La suite de benchmark vive en `scripts/benchmark-api.js` y usa `autocannon`.
Por defecto mide `http://localhost:3000/api/v1/health` y bloquea targets remotos salvo `BENCH_ALLOW_REMOTE=1`.
Ver `docs/BENCHMARKING.md` para perfiles, escenarios y lectura de capacidad estable.

## Variables de entorno

### Requeridas

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_URL`

### Recomendadas para producción

- `REDIS_URL`
- `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` (recomendada para FCM)
- `FIREBASE_SERVICE_ACCOUNT_JSON` (alternativa)
- `FIREBASE_PROJECT_ID` + `FIREBASE_PRIVATE_KEY` + `FIREBASE_CLIENT_EMAIL` (legacy)
- `SENTRY_DSN`
- `ALLOWED_ORIGINS`
- `AUTH_REJECT_SNAKE_CASE` (default general: `true`; ventana temporal: `false`)

### Runtime / desarrollo

- `DATABASE_APPLICATION_NAME` (default: `sacdia-backend`) — etiqueta visible en
  `pg_stat_activity` y dashboards del proveedor.
- `PRISMA_POOL_MAX` (default: `20`) — conexiones máximas **por réplica**.
- `PRISMA_POOL_IDLE_TIMEOUT_MS` (default: `30000`) — cierre de clientes inactivos.
- `PRISMA_POOL_CONNECTION_TIMEOUT_MS` (default: `15000`) — espera por conexión
  o cold start de Neon.
- `PRISMA_POOL_KEEP_ALIVE_INITIAL_DELAY_MS` (default: `10000`) — demora del
  primer probe TCP keep-alive.
- `CACHE_DEFAULT_TTL_MS` (default: `86400000`) — TTL global; los catálogos
  continúan usando su TTL explícito de 1 hora.
- `CACHE_REDIS_CONNECTION_TIMEOUT_MS` (default: `5000`) — timeout de la
  verificación Redis durante startup.

El presupuesto máximo de conexiones es `PRISMA_POOL_MAX × réplicas máximas`.
Ese total debe mantenerse por debajo del límite del plan/pooler de Neon; aumentar
el pool sin revisar ese presupuesto puede agotar la base aunque una sola réplica
funcione correctamente.

## Migración de URLs a R2

El script `migrate:storage-urls:r2` normaliza URLs legacy en BD hacia los valores actuales de `R2_PUBLIC_URL_*` y `R2_KEY_PREFIX_*`.

```bash
# 1) Simulación (sin escribir en BD)
pnpm run migrate:storage-urls:r2

# 2) Simulación de tablas específicas
pnpm run migrate:storage-urls:r2 -- --only users,users_honors --limit 200

# 3) Aplicar cambios reales
pnpm run migrate:storage-urls:r2 -- --apply
```

Notas:

- En `NODE_ENV=production`, `REDIS_URL` es obligatorio para rate limiting,
  colas y caché distribuida. La caché ejecuta una lectura real al arrancar para
  verificar DNS, TLS, autenticación y disponibilidad; cualquier fallo detiene
  el startup. En desarrollo/test se permite fallback a memoria.
- Si FCM no inicializa correctamente, notificaciones push quedan deshabilitadas.
- Desde `2026-03-01`, `POST /api/v1/auth/refresh` usa `refreshToken` (camelCase).
- Ventana de compatibilidad temporal: **2026-03-04 a 2026-03-18** con `AUTH_REJECT_SNAKE_CASE=false`.
- Fecha objetivo de retorno a estricto: **2026-03-18** (`AUTH_REJECT_SNAKE_CASE=true`).

### Configuración rápida Redis + FCM

1. Redis
   - Local: `REDIS_URL=redis://localhost:6379`
   - Upstash: `REDIS_URL=redis://default:<PASSWORD>@<HOST>:<PORT>`

2. FCM (recomendado)
   - Crea/descarga el Service Account JSON en Firebase Console.
   - Convierte a Base64:
     ```bash
     base64 -i service-account.json | tr -d '\n'
     ```
   - Asigna el resultado a `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`.

3. Verificación
   - Levanta backend y revisa:
     - `Using Redis-backed distributed throttler storage`
     - `Redis cache connection verified`
     - `✅ Firebase Admin initialized successfully`
   - Healthcheck:
     - `GET /api/v1/health`
     - Esperado: `dependencies.cache.ok=true`, métricas en
       `dependencies.database.pool` y `dependencies.cache.catalogs`, y
       `dependencies.fcm.initialized=true`.

### Monitoreo Auth post-cutover (14 días)

Eventos estructurados emitidos:

- `auth_refresh_legacy_rejected`
- `auth_refresh_legacy_allowed`
- `auth_refresh_success`
- `auth_refresh_failed`
- `auth_logout_best_effort`
- `auth_logout_revoke_failed`
- `auth_guard_unauthorized`
- `auth_jwt_revoked_token`
- `auth_jwt_user_blacklisted`
- `mfa_session_bind_failed`

Consultas sugeridas (Sentry/Logs):

- Tasa de legacy rechazado: `event:auth_refresh_legacy_rejected`
- Éxito de refresh: `event:auth_refresh_success`
- Fallos de refresh: `event:auth_refresh_failed`
- Logout best effort (ruta y resultado): `event:auth_logout_best_effort`
- Fallo al revocar en logout: `event:auth_logout_revoke_failed`
- 401 en `/api/v1/auth/me`: `event:auth_guard_unauthorized url:/api/v1/auth/me`
- Revocaciones efectivas: `event:auth_jwt_revoked_token OR event:auth_jwt_user_blacklisted`

### Contrato Auth de sesiones (estado actual)

- `POST /api/v1/auth/login`
  - Respuesta de tokens:
  ```json
  {
    "accessToken": "eyJ...",
    "refreshToken": "v1....",
    "expiresAt": 1900000000,
    "tokenType": "bearer"
  }
  ```
- `POST /api/v1/auth/refresh`
  - Contrato oficial: body con `refreshToken`.
  - Compatibilidad temporal: acepta `refresh_token` solo mientras `AUTH_REJECT_SNAKE_CASE=false`.
- `POST /api/v1/auth/logout`
  - No bloquea UX por expiración de access token.
  - Acepta `Authorization: Bearer ...` opcional y `refreshToken` opcional.
  - Respuesta incluye:
  ```json
  {
    "success": true,
    "revocationAttempted": true,
    "revocationSucceeded": true,
    "path": "access"
  }
  ```

## API

- Base URL: `/api/v1`
- Swagger: `/api`
- Health: `GET /api/v1/health`

### Referencia rápida: catálogos de salud (lectura para app/usuarios)

- `GET /api/v1/catalogs/allergies`
- `GET /api/v1/catalogs/diseases`

Estructura de respuesta:

```json
[
  {
    "allergy_id": 1,
    "name": "Polen",
    "description": "Alergia al polen"
  }
]
```

```json
[
  {
    "disease_id": 10,
    "name": "Asma",
    "description": "Asma controlada"
  }
]
```

Estos IDs (`allergy_id`, `disease_id`) se usan para guardar selección de salud del usuario con:

- `PUT /api/v1/users/:userId/allergies`
- `PUT /api/v1/users/:userId/diseases`
- `DELETE /api/v1/users/:userId/allergies/:allergyId`
- `DELETE /api/v1/users/:userId/diseases/:diseaseId`

### Referencia rápida: salud del usuario (escritura en tablas pivote)

- `PUT /api/v1/users/:userId/allergies`
  - Body:
  ```json
  {
    "allergy_ids": [1, 2, 3]
  }
  ```
- `PUT /api/v1/users/:userId/diseases`
  - Body:
  ```json
  {
    "disease_ids": [10, 12]
  }
  ```
- `DELETE /api/v1/users/:userId/allergies/:allergyId`
  - Sin body (desactiva el registro en `users_allergies`).
- `DELETE /api/v1/users/:userId/diseases/:diseaseId`
  - Sin body (desactiva el registro en `users_diseases`).

Comportamiento de ambos endpoints:

1. Permiten múltiples IDs en una sola request.
2. Reemplazan el conjunto activo completo del usuario.
3. Si un ID ya existe inactivo, se reactiva.
4. Si un ID no existe para el usuario, se crea.
5. IDs activos no enviados en la lista se desactivan (`active=false`).
6. Lista vacía (`[]`) deja al usuario sin registros activos en ese tipo.
7. Validan que usuario exista y que IDs pertenezcan a catálogos activos.
8. Para desactivar solo un registro puntual sin reemplazar lista completa, usar `DELETE` por `allergyId` o `diseaseId`.

### Referencia rápida: actualización de perfil de usuario

- `PATCH /api/v1/users/:userId`

Campos soportados:

- `gender`, `birthday`, `baptism`, `baptism_date`, `blood`
- `country_id`, `union_id`, `local_field_id`

Reglas de validación relevantes:

1. `baptism_date` no puede enviarse si `baptism=false`.
2. `country_id`, `union_id`, `local_field_id` deben existir y estar activos.
3. `union_id` debe pertenecer a `country_id`.
4. `local_field_id` debe pertenecer a `union_id`.

### Referencia rápida: representante legal por usuario

- `GET /api/v1/users/:userId/legal-representative`

Contrato de respuesta:

1. Usuario existente con representante:

```json
{
  "status": "success",
  "data": {
    "user_id": "uuid-del-usuario",
    "relationship_type_id": "uuid-relacion"
  },
  "hasLegalRepresentative": true
}
```

2. Usuario existente sin representante:

```json
{
  "status": "success",
  "data": null,
  "hasLegalRepresentative": false,
  "message": "Usuario sin representante legal registrado"
}
```

3. Usuario inexistente:

```json
{
  "statusCode": 404,
  "message": "Usuario no encontrado"
}
```

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
- Sesión de implementación de salud/geografía de usuario:
  `docs/IMPLEMENTATION-SESSION-2026-02-21-user-medical-and-geography.md`
- Sesión de estabilización de sesiones/auth:
  `docs/IMPLEMENTATION-SESSION-2026-03-04-session-stabilization.md`
- Panorama global del backend:
  `docs/BACKEND-PANORAMA-2026-03-04.md`
- Nota de migración UUID en contactos de emergencia:
  `docs/migrations/2026-02-21-emergency-contacts-relationship-type-uuid.md`
- Sesión de implementación de admin/notificaciones:
  `docs/IMPLEMENTATION-SESSION-2026-02-13-admin-hardening.md`
- Histórico de cutover auth del 2026-03-01:
  `docs/IMPLEMENTATION-SESSION-2026-03-01-auth-cutover-monitoring.md`
- Referencia histórica de implementación previa: `docs/IMPLEMENTATION-SESSION-2026-02-05.md`
- Referencia de baseline DB: `docs/migrations/2026-02-05-db-push-sync.md`

Nota: la documentación funcional oficial del producto vive en el repositorio padre (`../../docs`).

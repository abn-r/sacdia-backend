# SACDIA Backend

API REST de SACDIA construida con NestJS, Prisma y PostgreSQL (Neon).

> Documentación oficial del proyecto: `../docs` (workspace `sacdia`).
> Este README es una vista operativa del backend. El contrato de endpoints vive en
> `../docs/api/ENDPOINTS-LIVE-REFERENCE.md` y el de base de datos en `../docs/database/SCHEMA-REFERENCE.md`.

## Stack

- NestJS 11
- Prisma 7.9 (`@prisma/adapter-pg`)
- PostgreSQL (Neon)
- Auth JWT con Better Auth (self-hosted)
- Cache con Redis (fail-fast en producción; fallback a memoria solo en desarrollo/test)
- BullMQ sobre Redis (colas de email, notificaciones, logros, trabajos de fondo, especialidades de maestría y OCR de certificados)
- Firebase Admin (FCM)
- Cloudflare R2 (S3 API) para archivos
- Resend para email transaccional
- Sentry

## Estructura principal

`src/` tiene un módulo NestJS por dominio (unos 70). Agrupados:

- **Plataforma**: `prisma`, `config`, `common` (guards, decoradores, errores, servicios compartidos), `health`, `i18n`, `background-jobs`, `audit-logs`, `system-config`, `data-export`, `support`.
- **Auth y autorización**: `auth`, `better-auth`, `rbac`, `admin`, `users`, `post-registration`, `emergency-contacts`, `legal-representatives`, `qr`.
- **Estructura institucional y clubes**: `catalogs`, `clubs`, `units`, `club-enrollments`, `membership-requests`, `annual-membership`, `coordination`, `institutional-history`, `requests`.
- **Formación**: `classes`, `honors`, `certifications`, `certificate-bulk-imports`, `investiture`, `validation`, `evidence-review`, `materials`, `resources`.
- **Operación de club**: `activities`, `finances`, `payment-obligations`, `field-payment-orders`, `inventory`, `insurance`, `notifications`, `dashboard`.
- **Reportes, rankings y cierre de año**: `annual-folders`, `annual-reports`, `monthly-reports`, `quarterly-reports`, `reports`, `rankings`, `ranking-weights`, `scoring-categories`, `member-of-month`, `achievements`, `analytics`, `year-cut`, `year-end`.
- **Camporees**: `camporees`, `camporee-events`, `camporee-event-templates`, `camporee-orders`, `camporee-scoring`, `camporee-staff`, `camporee-supplies`, `camporee-venues`.

La lista exacta es `ls src/`; el registro de módulos está en `src/app.module.ts`.

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

# Lint y seguridad
pnpm run lint
pnpm run audit:security

# Prisma
pnpm prisma migrate deploy
pnpm run prisma:seed:core
pnpm run verify:fcm-migration
pnpm run verify:iana-timezones
pnpm run verify:institutional-hierarchy-migration
pnpm run verify:authorization-p0

# Utilidades
pnpm run generate:spec
pnpm run load-test
pnpm run benchmark:smoke
pnpm run benchmark:baseline
pnpm run benchmark:stress
pnpm run benchmark:spike
pnpm run migrate:storage-urls:r2
pnpm run import:legacy-catalogs
pnpm run import:master-honor-rules -- --file <ruta>
pnpm run audit:master-honor-assignments
pnpm run backfill:local-field-timezones
pnpm run reports:backfill-pdfs
```

## Benchmarking

La suite de benchmark vive en `scripts/benchmark-api.js` y usa `autocannon`.
Por defecto mide `http://localhost:3000/api/v1/health` y bloquea targets remotos salvo `BENCH_ALLOW_REMOTE=1`.
Ver `docs/BENCHMARKING.md` para perfiles, escenarios y lectura de capacidad estable.

## Variables de entorno

### Requeridas

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `QR_JWT_SECRET`
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
- `AUTH_REJECT_SNAKE_CASE` (default: `false`; ver ADR-0001)

### Runtime / desarrollo

- `DATABASE_APPLICATION_NAME` (default: `sacdia-backend`) — etiqueta visible en
  `pg_stat_activity` y dashboards del proveedor.
- `PRISMA_POOL_MAX` (default: `20`) — conexiones máximas **por réplica**.
- `PRISMA_POOL_IDLE_TIMEOUT_MS` (default: `300000`) — cierre de clientes inactivos
  (5 min; valores menores fuerzan handshake TLS ~500ms contra Neon en cada request
  tras una pausa).
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
- El cliente `redis` usado por el throttler fija explícitamente `RESP: 2`,
  `socket.keepAliveInitialDelay: 5000` y
  `commandOptions.timeout: undefined`. Estos valores preservan la semántica de
  node-redis v5 durante la futura actualización a v6; adoptar RESP3, el
  keepalive de 30 segundos o un timeout de comandos requiere una decisión
  operativa independiente. Los errores Redis continúan propagándose: el
  throttler no permite requests mediante fallback silencioso.
- El contrato real del throttler se valida contra Redis local con:
  `ALLOW_REDIS_INTEGRATION=1 REDIS_INTEGRATION_URL=redis://127.0.0.1:6379 pnpm exec jest --runInBand --runTestsByPath src/config/redis-throttler.storage.integration.spec.ts --testPathIgnorePatterns='^$'`.
  La suite rechaza URLs que no sean loopback; en CI falla de inmediato si falta
  cualquiera de las dos variables. La prueba de reconexión aísla la falla con
  un usuario ACL único, espera con polling acotado y elimina sus claves y ACL.
  CI lo ejecuta en un job aislado con Redis 7.
- Si FCM no inicializa correctamente, notificaciones push quedan deshabilitadas.
- `POST /api/v1/auth/refresh` usa `refreshToken` (camelCase). Mientras
  `AUTH_REJECT_SNAKE_CASE=false` (valor por defecto) también acepta `refresh_token`;
  el retorno a modo estricto está pendiente de decidir antes del lanzamiento
  (`docs/adr/ADR-0001-auth-session-compat-window.md`).

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

### Eventos de auth para monitoreo

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
  - Compatibilidad legacy: acepta `refresh_token` mientras `AUTH_REJECT_SNAKE_CASE=false` (default actual).
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
- Swagger: `/api` (opt-in con `SWAGGER_ENABLED=true`; prohibido en producción)
- Health: `GET /api/v1/health`

El inventario completo de endpoints, DTOs y permisos está en
`../docs/api/ENDPOINTS-LIVE-REFERENCE.md`. No se duplica aquí.

## Seguridad implementada

- `GlobalJwtAuthGuard` y `PermissionsGuard` se registran como `APP_GUARD`
  (`src/app.module.ts`): toda ruta exige JWT salvo `@Public()`, y debe declarar
  `@RequirePermissions` + `@AuthorizationResource` o `@SkipPermissions()`.
  Sin esa metadata la ruta responde `GUARD_RBAC_MISCONFIGURATION`.
- `UserAwareThrottlerGuard` global (Redis distribuido en producción).
- Guards de ruta opcionales: `GlobalRolesGuard`, `ClubRolesGuard`,
  `OwnerOrAdminGuard`, `MfaGuard`, `OptionalJwtAuthGuard`.
- Detalle: `src/common/guards/README.md`. Estado de hallazgos de seguridad:
  `docs/security/security-best-practices-report.md`.

## Verificación recomendada antes de release

```bash
AUTHORIZATION_P0_VERIFY_DATABASE_URL="$TEST_DATABASE_URL" pnpm --silent verify:authorization-p0
pnpm run build
pnpm run test -- src/notifications/fcm-tokens.service.spec.ts
pnpm run test:e2e -- test/notifications-security.e2e-spec.ts test/admin-catalogs.e2e-spec.ts
pnpm prisma migrate deploy
pnpm run verify:fcm-migration
```

### Contrato operativo del preflight P0

El comando emite exactamente un JSON por stdout; stderr queda reservado al
resumen operativo. No consume `DATABASE_URL`: exige
`AUTHORIZATION_P0_VERIFY_DATABASE_URL`.

Precondiciones:

- ejecutar con el mismo Node 24/ICU del runtime productivo;
- usar un rol PostgreSQL con `CONNECT`, `USAGE` y `SELECT` sobre el schema
  inspeccionado y catálogos requeridos; no necesita permisos de escritura;
- apuntar en CI/desarrollo solo a una copia local o efímera autorizada; para
  datos productivos, usar un endpoint read-only aprobado y conectividad
  controlada, nunca credenciales compartidas;
- conservar `prisma/scripts/authorization-p0-preflight.sql` junto al checkout;
  su resolución es relativa al módulo y no depende del CWD;
- ejecutar las unidades backend con roots temporales herméticos. La integración
  cross-repo declara `SACDIA_ADMIN_ROOT`, `SACDIA_APP_ROOT` y
  `SACDIA_CANONICAL_DOCS_ROOT`; `SACDIA_WORKSPACE_ROOT` queda disponible para
  ejecución manual compatible.
- fijar los tres checkouts públicos mediante las variables de repositorio
  `SACDIA_ROOT_CONTRACT_REF`, `SACDIA_ADMIN_CONTRACT_REF` y
  `SACDIA_APP_CONTRACT_REF`, cada una con un SHA-40 inmutable. No se requiere
  PAT ni secret para leer esos repositorios públicos.

El inventario inspecciona admin, Flutter y documentación. Un root ausente o
ilegible produce `CONSUMER_INVENTORY_UNAVAILABLE`; consumidores que divergen del
inventario revisado producen `CONSUMER_INVENTORY_DRIFT`. Ningún checkout
backend aislado omite esa validación silenciosamente. Una ref ausente, inválida
o distinta del `HEAD` inspeccionado produce
`CONSUMER_INVENTORY_REF_MISMATCH`.

El executor abre y valida una única snapshot `REPEATABLE READ READ ONLY`.
Confirma `COMMIT` al completar el reporte; ante error o señal después de
`BEGIN`, intenta `ROLLBACK` antes de cerrar. Si la conexión nunca abrió o el
transporte ya se perdió, PostgreSQL aborta la transacción al cerrar: no se
promete un `ROLLBACK` explícito imposible de observar. Cada camino emite un solo
JSON. La verificación de zonas usa el Node 24/ICU productivo, no sustituye esa
capacidad con `pg_timezone_names`.

Para señales dirigidas al PID, usar el entrypoint Node real:
`./scripts/verify-authorization-p0.ts`. El comando pnpm es el alias normal, pero
shims externos de pnpm pueden no reenviar señales PID-only.

Contrato timezone obligatorio:

- México no implica una zona única y `America/Mexico_City` nunca es default
  nacional;
- se aceptan solo IDs geográficos canónicos exactos de `zone.tab`, con casing
  exacto; subregiones territoriales como
  `America/Argentina/Buenos_Aires` son válidas;
- aliases legacy, abreviaturas, offsets, `Etc/*` y `SystemV/*` se rechazan;
- un Campo Local activo sin zona canónica soportada bloquea el enablement, sin
  normalización ni fallback.

Límites (default / máximo):

- conexión: `3 000 ms` / `30 000 ms`;
- statement: `5 000 ms` / `60 000 ms`;
- query: `6 000 ms` / `65 000 ms`;
- lock: `1 000 ms` / `10 000 ms`;
- idle-in-transaction: fijo en `10 000 ms`;
- muestra por check: `50` / `100`.

Se configuran con
`AUTHORIZATION_P0_{CONNECTION,STATEMENT,QUERY,LOCK}_TIMEOUT_MS` y
`AUTHORIZATION_P0_SAMPLE_LIMIT`. Valores ausentes, no enteros o no positivos
usan el default; valores mayores se acotan al máximo.

Exit codes:

- `0` — `clean`;
- `1` — `blocked` o `error`;
- `130` — `SIGINT`, diagnóstico `INTERRUPTED`;
- `143` — `SIGTERM`, diagnóstico `TERMINATED`.

URL dedicada ausente produce `MISSING_DATABASE_URL`; fallos de conexión,
`DATABASE_UNAVAILABLE`; timeouts,
`QUERY_TIMEOUT`; un SQL ausente o fallo posterior a conectar,
`PREFLIGHT_FAILED`; un catálogo ausente/corrupto,
`CATALOG_INTEGRITY_ERROR`; y un inventario no verificable,
`CONSUMER_INVENTORY_UNAVAILABLE` o `CONSUMER_INVENTORY_DRIFT`. Todos conservan
JSON puro por stdout y cleanup idempotente.

## Documentación del proyecto

- Índice local de documentos: `docs/README.md`
- Documentación funcional del producto: `../docs` (workspace `sacdia`)
- Bitácoras de sprint archivadas: `../docs/history/implementation/`

# Session: Session Stabilization (Auth)

Date: **2026-03-04**  
Status: **Active**

## Objective

Evitar bloqueo de sesión cuando expira el access token (~24h), mantener continuidad de sesión con refresh y habilitar salida segura (logout) aun cuando el token actual ya no sea válido.

## Root Cause Confirmed

1. Desde **2026-03-01**, `POST /api/v1/auth/refresh` rechaza `refresh_token` por defecto (`AUTH_REJECT_SNAKE_CASE=true`).
2. Si clientes legacy seguían enviando snake_case, el refresh fallaba al expirar access token.
3. `POST /api/v1/auth/logout` requería JWT válido, dejando al usuario bloqueado en UX cuando el access ya había expirado.

## Implemented Changes

### 1) Auth contract hardening (tokens)

- `POST /api/v1/auth/login` ahora retorna también:
  - `expiresAt`
  - `tokenType`
- Mantiene:
  - `accessToken`
  - `refreshToken`

Files:
- `src/auth/auth.service.ts`
- `src/auth/auth.controller.ts`

### 2) Logout fail-safe (best effort)

- `POST /api/v1/auth/logout` ya no depende de `JwtAuthGuard`.
- Acepta:
  - `Authorization: Bearer <token>` opcional
  - `refreshToken` opcional en body
- Comportamiento:
  - Si hay access token: intenta revocación directa.
  - Si no hay access y hay refresh token: intenta refresh y luego revocación.
  - Si no se puede revocar (token inválido/expirado): responde 200 para no bloquear UX.
- Respuesta incluye:
  - `revocationAttempted`
  - `revocationSucceeded`
  - `path` (`access`, `refresh`, `none`)

Files:
- `src/auth/auth.controller.ts`
- `src/auth/auth.service.ts`
- `src/auth/dto/logout.dto.ts`

### 3) Observability updates

Refresh logs enriched:
- `auth_refresh_failed` incluye `reason`, `payloadFormat`, `userAgent`.
- `auth_refresh_legacy_rejected` / `auth_refresh_legacy_allowed` incluyen `payloadFormat`, `userAgent`.

Logout logs added:
- `auth_logout_best_effort`
- `auth_logout_revoke_failed`

Files:
- `src/auth/auth.service.ts`

### 4) Temporary compatibility window

- Runtime temporal configurado:
  - `AUTH_REJECT_SNAKE_CASE=false`
- Ventana:
  - **2026-03-04** a **2026-03-18**
- Fecha objetivo de retorno a estricto:
  - **2026-03-18** (`AUTH_REJECT_SNAKE_CASE=true`)

Files:
- `vercel.json`
- `.env.example`
- `.github/workflows/ci.yml` (enforcement por fecha en deploy de producción)

### 5) Contexto activo de instancia (club/member switching)

- Nuevo endpoint:
  - `PATCH /api/v1/auth/me/context`
- Request body:
  - `{ "assignment_id": "<uuid>" }`
- Validación:
  - La asignación debe pertenecer al usuario autenticado.
  - Debe estar `active=true` y `status='active'`.
- Persistencia:
  - Se guarda `active_club_assignment_id` en `users_pr`.
- `GET /api/v1/auth/me` ahora incluye:
  - `club_context.active_assignment_id`
  - `club_context.active`
  - `club_context.available`
- Compatibilidad:
  - Se mantiene `club` como campo resumido (derivado del contexto activo).

Files:
- `src/auth/auth.controller.ts`
- `src/auth/auth.service.ts`
- `src/auth/dto/set-active-club-context.dto.ts`
- `prisma/schema.prisma`
- `prisma/migrations/20260304170000_add_active_club_context_to_users_pr/migration.sql`

### 6) Actividades multi-instancia (opción 2)

- Endpoint afectado:
  - `POST /api/v1/clubs/:clubId/activities`
- Modelo de datos:
  - Nueva tabla puente: `activity_instances` (actividad -> N instancias)
  - Mantiene FKs a:
    - `club_adventurers`
    - `club_pathfinders`
    - `club_master_guilds`
  - Backfill automático desde columnas legacy (`activities.club_adv_id|club_pathf_id|club_mg_id`)

#### Nuevo request recomendado

```json
{
  "name": "Camporee local combinado",
  "description": "Actividad compartida entre dos instancias",
  "club_type_id": 1,
  "lat": 19.4326,
  "long": -99.1332,
  "activity_place": "Parque Nacional",
  "image": "https://example.com/activity.jpg",
  "activity_type_id": 2,
  "instances": [
    { "instance_type": "adventurers", "instance_id": 10 },
    { "instance_type": "pathfinders", "instance_id": 20 }
  ]
}
```

#### Reglas de validación

1. Todas las instancias enviadas deben pertenecer al `clubId` de la ruta.
2. `club_type_id` debe corresponder al menos a una de las instancias seleccionadas (se usa como tipo primario legacy).
3. No se permite mezclar `instances[]` con campos legacy (`club_adv_id`, `club_pathf_id`, `club_mg_id`) en el mismo payload.
4. Respuesta de error: `400` con detalle explícito de la inconsistencia.

#### Respuesta

- `GET /api/v1/clubs/:clubId/activities` y `GET /api/v1/activities/:activityId` ahora exponen:
  - `instances: [{ instance_type, instance_id, club_id, club_type_name }]`

#### Compatibilidad

- Se mantienen temporalmente los campos legacy en `CreateActivityDto` para transición.
- Internamente, la fuente de verdad de asociación actividad-instancia es `activity_instances`.

Files:
- `src/activities/activities.controller.ts`
- `src/activities/activities.service.ts`
- `src/activities/dto/activities.dto.ts`
- `prisma/schema.prisma`
- `prisma/migrations/20260304183000_add_activity_instances_bridge/migration.sql`

## Verification Evidence

Commands executed:

```bash
pnpm exec jest src/auth/auth.controller.spec.ts src/auth/auth.service.spec.ts src/activities/activities.service.spec.ts
pnpm test:e2e -- test/auth.e2e-spec.ts
pnpm prisma generate
pnpm generate:spec
pnpm build
```

Results:
- Unit tests: **PASS** (auth + activities service)
- E2E auth: **PASS**
  - refresh camelCase OK
  - refresh snake_case rechazado en strict mode
  - refresh snake_case permitido en compat mode
  - logout sin Authorization responde 200
- OpenAPI spec: **PASS** (incluye contrato `instances[]` y `PATCH /auth/me/context`)
- Build: **PASS**

## Rollout Checklist (Current Window)

1. Deploy with `AUTH_REJECT_SNAKE_CASE=false`.
2. Smoke after deploy:
   - `POST /auth/refresh` with `refreshToken` -> 200
   - `POST /auth/refresh` with `refresh_token` -> 200 (durante ventana)
   - `POST /auth/logout` sin access token válido -> 200
3. Monitor daily:
   - `event:auth_refresh_success`
   - `event:auth_refresh_failed`
   - `event:auth_refresh_legacy_allowed`
   - `event:auth_logout_best_effort`
   - `event:auth_logout_revoke_failed`

## Cutback Checklist (Target: 2026-03-18)

1. Confirmar descenso sostenido de uso legacy (`auth_refresh_legacy_allowed`).
2. Cambiar `AUTH_REJECT_SNAKE_CASE=true`.
3. Deploy y smoke:
   - `refreshToken` -> 200
   - `refresh_token` -> 400 + `LEGACY_SNAKE_CASE_REMOVED`
4. Monitoreo intensivo 24h post-cutback.

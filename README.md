# SACDIA Backend

API REST de SACDIA construida con NestJS, Prisma y PostgreSQL (Supabase).

> Documentacion oficial del proyecto: `/Users/abner/Documents/development/sacdia/docs` (repositorio padre).
> Este README es una vista operativa del backend y debe mantenerse sincronizado con esa fuente.

## Estado actual (2026-02-21)

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
- `AUTH_REJECT_SNAKE_CASE` (default: `true`)

Notas:
- Si `REDIS_URL` falla, el backend usa cache in-memory (no recomendado para prod).
- Si FCM no inicializa correctamente, notificaciones push quedan deshabilitadas.
- Desde `2026-03-01`, `POST /api/v1/auth/refresh` usa `refreshToken` (camelCase).
- `refresh_token` (snake_case) está retirado por defecto. Para rollback temporal usar `AUTH_REJECT_SNAKE_CASE=false`.

### Monitoreo Auth post-cutover (14 días)

Eventos estructurados emitidos:
- `auth_refresh_legacy_rejected`
- `auth_refresh_legacy_allowed`
- `auth_refresh_success`
- `auth_refresh_failed`
- `auth_guard_unauthorized`
- `auth_jwt_revoked_token`
- `auth_jwt_user_blacklisted`
- `mfa_session_bind_failed`

Consultas sugeridas (Sentry/Logs):
- Tasa de legacy rechazado: `event:auth_refresh_legacy_rejected`
- Éxito de refresh: `event:auth_refresh_success`
- Fallos de refresh: `event:auth_refresh_failed`
- 401 en `/api/v1/auth/me`: `event:auth_guard_unauthorized url:/api/v1/auth/me`
- Revocaciones efectivas: `event:auth_jwt_revoked_token OR event:auth_jwt_user_blacklisted`

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
- Nota de migración UUID en contactos de emergencia:
  `docs/migrations/2026-02-21-emergency-contacts-relationship-type-uuid.md`
- Sesión de implementación de admin/notificaciones: `docs/IMPLEMENTATION-SESSION-2026-02-13-admin-hardening.md`
- Referencia histórica de implementación previa: `docs/IMPLEMENTATION-SESSION-2026-02-05.md`
- Referencia de baseline DB: `docs/migrations/2026-02-05-db-push-sync.md`

Nota: la documentación funcional oficial del producto vive en el repositorio padre (`../../docs`).

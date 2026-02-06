# Revisión del módulo Honors + Roles de Validación (2026-02-05)

## Contexto

Solicitud: revisar `src/honors` y alinearlo con un catálogo de honores gestionado por admins y validación de honores de usuarios por roles administrativos (campo local / unión / división + asistentes, coordinador).  
Alcance: `src/honors/*`, DTOs, guards RBAC, Prisma schema y documentación.

## Fuentes revisadas

Código:

- `src/honors/honors.controller.ts`
- `src/honors/honors.service.ts`
- `src/honors/dto/honors.dto.ts`
- `src/honors/honors.module.ts`
- `src/common/guards/*`
- `src/common/decorators/*`
- `src/auth/strategies/jwt.strategy.ts`
- `src/common/dto/pagination.dto.ts`
- `prisma/schema.prisma`

Docs:

- `docs/api/API-SPECIFICATION.md`
- `docs/api/README.md`
- `docs/api/ENDPOINTS-REFERENCE.md`
- `docs/api/walkthrough-honors.md`
- `docs/api/API-ROUTES-AUDIT.md`
- `docs/01-OVERVIEW.md`
- `docs/database/SCHEMA-REFERENCE.md`
- `.specs/_steering/product.md`
- `.specs/features/honores/design.md`

## Implementación actual (Código)

### Catálogo público (Honors)

- `GET /honors` (filters: categoryId, clubTypeId, skillLevel; paginado)
- `GET /honors/:honorId`
- `GET /honors/categories`

Servicio:

- `findAll` filtra `active = true`
- `findOne` NO filtra `active = true`
- `getCategories` filtra `active = true`

### Honores de usuario (users_honors)

- `GET /users/:userId/honors`
- `GET /users/:userId/honors/stats`
- `POST /users/:userId/honors/:honorId` (iniciar honor)
- `PATCH /users/:userId/honors/:honorId` (actualizar progreso)
- `DELETE /users/:userId/honors/:honorId` (abandonar honor)

Servicio:

- Sin control de “owner-or-admin”
- `startHonor` usa check-then-create (no atómico)
- `updateUserHonor` usa checks por truthy (no permite limpiar campos)
- `users_honors` usa `active` como soft delete

### Modelo de datos (Prisma)

- `honors` tiene `active` (default true)
- `users_honors` sin unique constraint `(user_id, honor_id)`
- `certificate` no nullable, `document` nullable, `images` JSON

## Hallazgos (Código)

### Seguridad / Autorización

1. Falta control owner-or-admin en `users/:userId/honors`.
2. No existe guard de roles globales (solo club roles).
3. `ClubRolesGuard` espera `request.user.sub` pero `JwtStrategy` retorna `{ userId, email }`.

### Catálogo vs administración

4. Catálogo es público, pero no hay endpoints admin para CRUD.
5. `findOne` debería filtrar `active = true`.

### Consistencia / Validación

6. Paginación usa `take` 50, pero `PaginationDto` default 20.
7. Filtros/paginación se parsean manualmente (sin DTO/validación).
8. DTO incompleto:
   - `images` debería usar `@IsArray()` + `@IsString({ each: true })`
   - URLs deberían usar `@IsUrl()` (si aplica)
   - `skillLevel` debería estar limitado (1..3)
9. `updateUserHonor` no permite limpiar `certificate`, `images`, `document`.

### Integridad de datos

10. `startHonor` no es atómico; posibles duplicados.
11. Falta unique constraint `(user_id, honor_id)` en `users_honors`.

## Hallazgos (Documentación)

### Roles y RBAC

- Roles globales documentados: `super_admin`, `admin`, `coordinator`, `user`  
  (API-SPECIFICATION, README, SCHEMA-REFERENCE, OVERVIEW)

### Coordinador

- Rol global “coordinator” descrito como unión/asociación.
- En `.specs` aparece “coordinador de campo” en flujos de validación.
- No hay definición explícita de asistentes o roles de división.

### Honors en docs vs implementación

- `walkthrough-honors.md` incluye flows avanzados y endpoints no implementados.
- `API-ROUTES-AUDIT.md` lista endpoints no presentes en el código.

### Gap

El flujo multi-nivel (consejero → director → coordinador → campo local) está en docs, pero no hay lógica de roles/guards en el módulo actual.

## Decisiones necesarias

1. Roles que validan `validate` / `certificate`:
   - ¿Solo roles globales? ¿Agregar asistentes/división?

2. Alcance de validación:
   - `admin` por `users.local_field_id`
   - `coordinator` por `users.union_id`
   - `super_admin` global

3. Asistentes / división:
   - ¿Crear roles nuevos o mapear a roles actuales?

## Propuesta sin cambios de esquema

- Validación permitida para:
  - `admin` (campo local)
  - `coordinator` (unión)
  - `super_admin` (global)
- Guard “owner-or-admin” en `users/:userId/honors`.
- Validar roles globales vía `users_roles` + `roles`.
- Aplicar alcance por `users.local_field_id` y `users.union_id`.

## Cambios propuestos (pendientes de decisión)

### Guards y Decorators

- `GlobalRolesGuard` + `@GlobalRoles`
- Guard owner-or-admin para rutas de usuario
- Exportar en `src/common/guards/index.ts` y `src/common/decorators/index.ts`

### Honors Controller

- Aplicar owner-or-admin en `users/:userId/honors/*`
- Restringir `validate`/`certificate` a roles globales autorizados
- Usar DTOs para filtros + `PaginationDto`

### Honors Service

- `findOne` con `active = true` para público
- `startHonor`: reactivar si existe inactivo
- `updateUserHonor`: permitir limpiar campos

### DTOs

- `images`: `@IsString({ each: true })`
- URLs: `@IsUrl()` (si aplica)
- `skillLevel`: `@Min(1) @Max(3)`

### Tests

- Owner-or-admin
- Reactivación
- Validación/limpieza de campos
- Filtros/paginación

## Preguntas abiertas (equipo)

- ¿Roles nuevos para asistentes/división o mapeo a roles existentes?
- ¿CRUD admin de catálogo ahora o después?
- ¿Roles de club validan honores o solo administrativos globales?

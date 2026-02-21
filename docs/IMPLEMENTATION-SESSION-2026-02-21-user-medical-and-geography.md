# Implementación: Salud de Usuario + Geografía en Perfil

**Fecha**: 2026-02-21  
**Estado**: ✅ Implementado y validado en backend  
**Scope**: Endpoints `users` para alergias/enfermedades + extensión de PATCH de perfil

## Resumen

Se implementaron endpoints para persistir la selección de alergias y enfermedades de un usuario en las tablas pivote `users_allergies` y `users_diseases`, y se amplió el endpoint `PATCH /api/v1/users/:userId` para aceptar `country_id`, `union_id` y `local_field_id` con validaciones de consistencia jerárquica.

## Cambios Implementados

### 1. Nuevos endpoints de salud de usuario

- `PUT /api/v1/users/:userId/allergies`
- `PUT /api/v1/users/:userId/diseases`

Contratos de entrada:

```json
{ "allergy_ids": [1, 2, 3] }
```

```json
{ "disease_ids": [10, 12] }
```

Comportamiento:

1. Permiten múltiples IDs por request.
2. Reemplazan el conjunto activo completo del usuario.
3. Reactivan registros inactivos existentes.
4. Crean registros nuevos si no existen.
5. Desactivan (`active=false`) los registros activos no incluidos.
6. Si se envía `[]`, el usuario queda sin registros activos de ese tipo.

### 2. Extensión de PATCH de usuario con geografía

Endpoint existente ampliado:

- `PATCH /api/v1/users/:userId`

Campos agregados en DTO:

- `country_id`
- `union_id`
- `local_field_id`

Validaciones agregadas:

1. Cada entidad debe existir y estar activa si se envía.
2. `union_id` debe pertenecer a `country_id`.
3. `local_field_id` debe pertenecer a `union_id`.

## Archivos Modificados

- `src/users/users.controller.ts`
- `src/users/users.service.ts`
- `src/users/dto/update-user.dto.ts`
- `src/users/dto/update-user-medical.dto.ts`
- `README.md`
- `sacdia-api-spec.json`

## Verificación Ejecutada

1. `pnpm test -- users.service.spec.ts users.controller.spec.ts` ✅
2. `pnpm run generate:spec` ✅
3. Confirmación en spec de rutas:
   - `/v1/users/{userId}/allergies`
   - `/v1/users/{userId}/diseases`
4. `pnpm exec tsc -p tsconfig.json --noEmit` ⚠️ falla por issue previo no relacionado en:
   - `src/camporees/camporees.service.spec.ts` (`PaginationDto`)

## Nota Operativa

Los catálogos de referencia para alimentar los IDs siguen siendo:

- `GET /api/v1/catalogs/allergies`
- `GET /api/v1/catalogs/diseases`


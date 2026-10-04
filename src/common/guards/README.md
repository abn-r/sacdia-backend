# Guards de autorización

Guards de la API SACDIA. El modelo es **deny-by-default**: la autenticación y los permisos se aplican de forma global y cada endpoint declara de forma explícita qué necesita.

## Guards globales (`APP_GUARD`)

Registrados en `src/app.module.ts` en este orden:

1. **`UserAwareThrottlerGuard`** (`src/config/user-aware-throttler.guard.ts`): rate limiting. Usa `user:{id}` cuando hay JWT y la IP en otro caso.
2. **`GlobalJwtAuthGuard`** (`global-jwt-auth.guard.ts`): exige JWT válido en todas las rutas salvo las marcadas con `@Public()`. Extiende `JwtAuthGuard`.
3. **`PermissionsGuard`** (`permissions.guard.ts`): fail-closed. Toda ruta no pública debe declarar `@RequirePermissions(...)` o `@SkipPermissions()`. Si falta la metadata (o falta `@AuthorizationResource`), responde `500 GUARD_RBAC_MISCONFIGURATION`.

Como los dos últimos son globales, `@UseGuards(JwtAuthGuard)` en un controlador es redundante (sigue presente en muchos controladores por historia). Solo tiene efecto propio dentro de un controlador marcado `@Public()` a nivel de clase, porque `JwtAuthGuard` de ruta no respeta `@Public()`.

## Decoradores que gobiernan los guards globales

Viven en `src/common/decorators/`:

| Decorador | Efecto |
| --- | --- |
| `@Public()` | Omite JWT y permisos (login, health ping, catálogos públicos, bootstrap RBAC). |
| `@SkipPermissions()` | Exige JWT pero omite `PermissionsGuard` (listados de post-registro, inbox propio, etc.). |
| `@RequirePermissions('a:b', ...)` | Permisos requeridos. Modo `all` por defecto; `@RequirePermissions({ permissions, mode: 'any' })` para OR. |
| `@AuthorizationResource({ type, ... })` | Obligatorio junto a `@RequirePermissions`. Indica qué recurso se evalúa y de dónde leer sus IDs (`param`, `query`, `body`). |
| `@SensitiveUserSubresource(...)` | Subrecursos sensibles de usuario (salud, contactos de emergencia, representante legal, post-registro). Política en `sensitive-user-subresource-policy.ts`. |
| `@SkipMfaCheck()` | Exime una ruta de `MfaGuard`. |

### Tipos de recurso (`@AuthorizationResource`)

`PermissionsGuard` resuelve el alcance según `type`: `global`, `user`, `active_assignment`, `club`, `club_section`, `camporee`, `union_camporee`, `camporee_event`, `camporee_venue`, `activity`, `activity_series`, `finance`, `inventory_instance`, `inventory_item`, `club_assignment`, `class_counselor_assignment`, `investiture_enrollment`, `monthly_report`, `insurance_member`, `insurance_record`. El `switch` es exhaustivo: un tipo nuevo sin manejar falla en compilación y en runtime.

Para `user` (y `active_assignment` con `ownerParam`), el propietario del recurso pasa sin evaluar permisos.

El contexto de autorización (grants globales, de club y territoriales) lo resuelve `AuthorizationContextService` (`src/common/services/authorization-context.service.ts`) y se cachea 5 minutos.

En e2e, `E2E_PASSTHROUGH_PERMISSIONS=true` desactiva `PermissionsGuard` (nunca con `NODE_ENV=production`).

## Guards de ruta (opt-in con `@UseGuards`)

| Guard | Uso |
| --- | --- |
| `JwtAuthGuard` | Verificación JWT HS256 (`BETTER_AUTH_SECRET`, `iss`/`aud` de acceso) vía `JwtStrategy`. Rechaza tokens QR y tokens revocados. |
| `OptionalJwtAuthGuard` | Rutas públicas que adjuntan `request.user` si llega un token válido y siguen como anónimas si no. |
| `GlobalRolesGuard` + `@GlobalRoles(...)` | Roles globales activos en `users_roles`. `admin` acepta también `assistant-admin`; `super-admin` pasa siempre. |
| `ClubRolesGuard` + `@ClubRoles(...)` | Rol activo en `club_role_assignments` para el club de la ruta. |
| `OwnerOrAdminGuard` | Propietario del recurso (`userId` de la ruta) o rol global administrativo. `coordinator` no es atajo. |
| `MfaGuard` | Rechaza tokens `mfa_pending` (aal1). Se aplica de forma selectiva, no global. |

## Ejemplo

```typescript
@Get(':clubId/sections/:sectionId')
@RequirePermissions('club_sections:read')
@AuthorizationResource({
  type: 'club_section',
  clubIdParam: 'clubId',
  idParam: 'sectionId',
})
getSection(@Param('sectionId', ParseIntPipe) sectionId: number) { ... }
```

## Referencias

- Contrato de autorización (workspace `sacdia`): `docs/features/auth/AUTHORIZATION-CANONICAL-CONTRACT.md`, `docs/features/auth/RBAC-ENFORCEMENT-MATRIX.md` y `docs/api/SECURITY-GUIDE.md`.
- Tests: `*.guard.spec.ts` y `permissions-metadata.spec.ts` en esta carpeta.

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

Para `user` (y `active_assignment` con `ownerParam`), el propietario del recurso pasa sin evaluar permisos. Para un no propietario, los permisos del rol global base `user` (`BASE_GLOBAL_ROLE_NAME`, lo tiene toda cuenta) NO cuentan: necesita otro rol global, un permiso directo (`users_permissions`) o una de las rutas de miembro de sección del club activo. Por eso el rol base no debe recibir permisos que solo usan rutas propietarias (lo vigila `src/rbac/base-user-role-cross-user-grants.migration.spec.ts`).

El contexto de autorización (grants globales, de club y territoriales) lo resuelve `AuthorizationContextService` (`src/common/services/authorization-context.service.ts`) y se cachea 5 minutos.

En e2e, `E2E_PASSTHROUGH_PERMISSIONS=true` desactiva `PermissionsGuard` solo con `NODE_ENV=test` (Jest y el job e2e del CI); con cualquier otro `NODE_ENV` se ignora.

## Guards de ruta (opt-in con `@UseGuards`)

| Guard | Uso |
| --- | --- |
| `JwtAuthGuard` | Verificación JWT HS256 (`BETTER_AUTH_SECRET`, `iss`/`aud` de acceso) vía `JwtStrategy`. Rechaza tokens QR y tokens revocados. Aplica `@ActingScope` a principals sustituidos (ver acting-for). |
| `OptionalJwtAuthGuard` | Rutas públicas que adjuntan `request.user` si llega un token válido y siguen como anónimas si no (un principal acting sin scope en la ruta se trata como anónimo). |
| `GlobalRolesGuard` + `@GlobalRoles(...)` | Roles globales activos en `users_roles`. `admin` acepta también `assistant-admin`; `super-admin` pasa siempre. |
| `ClubRolesGuard` + `@ClubRoles(...)` | Rol activo en `club_role_assignments` para el club de la ruta. |
| `OwnerOrAdminGuard` | Propietario del recurso (`userId` de la ruta) o rol global administrativo. `coordinator` no es atajo. |
| `MfaGuard` | Rechaza tokens `mfa_pending` (aal1). Se aplica de forma selectiva, no global. |

## Acting-for: un tutor actúa como su dependiente

Perfiles familiares (Fase 2). Un tutor adulto puede operar la cuenta de un menor **sin cuenta propia** (fila en `dependent_profiles`, sin registro en `account`) enviando `X-Acting-For: <dependentUserId>`. No hay chat ni mensajería entre usuarios en ningún caso.

### Dónde se decide (un solo punto)

- **`JwtStrategy.validate`** (`src/auth/strategies/jwt.strategy.ts`) lee la cabecera solo en rutas autenticadas (las `@Public()` la ignoran). Sin cabecera el principal es idéntico al de siempre (`kind: 'user'`, `scopes: null`, `actor_sub = sub`).
- Con cabecera válida **sustituye al principal**: `sub`/`userId`/`user_id` pasan a ser el dependiente (por eso el bypass de propietario de `PermissionsGuard` aplica al dependiente), `email: null`, `kind: 'guardian_acting'`, `actor_sub` = tutor, `acting_for: true`, `scopes` = los del grant y `guardianship_id`. Los chequeos de token (QR, claims, revocación) corren primero contra el tutor.
- **`ActingForResolver`** (`src/auth/acting-for/`) concede el acceso solo si TODO se cumple: guardianship `pending|verified` entre ese tutor y ese dependiente, tutor **activo** (no borrado ni desactivado), no custodio, no externo, `is_test_data = false`; dependiente activo, **sin `account`**, sin `frozen_at`/`purged_at`, con cumpleaños y edad `< age_of_majority` del país. (El corte de 13 años aplica solo al crear el dependiente: no hay bloqueo al cumplir 13 antes de la Fase 3.)
- Rechazos previos a resolver: token `mfa_pending` o cabecera igual al propio `sub` => `403 ACTING_FOR_FORBIDDEN`. Cabecera repetida o no UUID => `400 ACTING_FOR_HEADER_INVALID`.
- **Denegación uniforme**: unknown, revocado, tutor ajeno, congelado, con cuenta, sobre la mayoría de edad y no dependiente devuelven el mismo `403 ACTING_FOR_FORBIDDEN` (sin enumeración). La causa real se registra en el log del servidor (`acting_for_denied`).

### Scopes (deny-by-default por ruta)

Un principal que no es `kind: 'user'` solo cruza rutas que declaran `@ActingScope(scope)` (`src/auth/acting-for/acting-scope.decorator.ts`; el handler gana sobre la clase) y cuyo scope está en `principal.scopes`. Si no, `403 ACTING_FOR_SCOPE_DENIED` (con `details.required_scope`, solo visible fuera de producción).

| Scope | Qué permite |
| --- | --- |
| `self:read` | Lecturas del propio perfil, salud, contactos, clases, honores, QR, inbox de notificaciones |
| `profile:write` | `PATCH /users/:userId`, salud, foto, contactos de emergencia, `PATCH /auth/me/context` |
| `registration:write` | Pasos 1-3 de post-registro, cancelar solicitud, inscripción anual |
| `classes:write` / `honors:write` | Inscribir y progresar clases / honores |
| `evidence:upload` | Archivos y evidencias de clases y honores |
| `legal:accept` | `POST /users/me/legal-acceptance` (queda `accepted_by_user_id` = tutor) |

- Consentimiento `pending` => `self:read`, `profile:write`, `registration:write`, `legal:accept`. `verified` => los siete.
- **Nunca llevan scope** (siempre 403 mientras se actúa): contraseña, MFA, sesiones, OAuth, borrar cuenta, exportar datos, FCM, preferencias de notificación, `/guardianships/*`, `legal-representative*`, propuesta de instructor, maestrías, certificaciones, admin, clubes, secciones, escaneo QR, envío de notificaciones, catálogo legal y la salida `POST /users/:userId/post-registration/step-3/guardian-only`.
- La fuente de verdad es el snapshot `src/auth/acting-for/acting-scope-metadata.spec.ts`: lista cada ruta con su scope y la denylist. Un `@ActingScope` a nivel de clase está prohibido (el spec falla): cada ruta opta de forma individual. **Al añadir o cambiar una ruta con scope hay que actualizar ese spec**; una ruta sin `@ActingScope` falla cerrada (403) y rompe el flujo de la app, no es una fuga.

### Cómo se aplica en los guards

- `JwtAuthGuard.handleRequest` (heredado por `GlobalJwtAuthGuard`) llama a `assertActingScope` justo después del chequeo MFA, y relanza los errores de acting sin convertirlos a 401. El guard global y los `@UseGuards(JwtAuthGuard)` locales deciden igual porque el scope se evalúa donde se crea el principal.
- `OptionalJwtAuthGuard`: errores de acting se relanzan; un principal acting en una ruta sin scope se degrada a **anónimo** (rutas públicas, mínimo privilegio).
- Caché del grant en Redis: `acting:v1:{dependentId}:{epoch}:{guardianId}`, 60 s para un grant y 10 s para una denegación; el epoch vive en `acting:epoch:{dependentId}`. **Toda mutación de guardianship llama a `ActingForCache.bump(dependentId)` tras el commit** (crear, canjear código, revocar, borrado de cuenta, purga). Un epoch ausente (expirado, flush, evicción) es un fallo de caché, no epoch 0: el resolver crea un epoch nuevo antes de leer la DB y no lee ningún payload bajo él. Si Redis falla se lee la DB; si la DB falla => `503 AUTH_REVOCATION_CHECK_UNAVAILABLE` (nunca falla abierto). Un memo por request evita repetir la consulta cuando un guard local vuelve a ejecutar `validate`.
- Rate limit: `UserAwareThrottlerGuard` usa `actor_sub`, así que el tráfico acting cuenta contra el tutor.
- `kind: 'linked_device'` (dispositivo vinculado del menor) está declarado pero **no existe en Fase 2**: ningún camino lo produce.

### Auditoría

`applyActingForAttribution` (`src/audit-logs/acting-for-attribution.ts`) corre en `AuditLogsService.recordEvent` y en el writer crítico: con contexto acting y actor ausente o igual al sujeto guarda `actor_user_id` = tutor, `actor_kind = 'guardian_acting'`, `target_user_id` = dependiente y `request_context.acting_for`. Un actor explícito distinto (p. ej. un director) no se sobrescribe. Las columnas de dominio (quien subió una evidencia) siguen guardando al dependiente.

### Comportamientos conocidos (decisiones, no bugs)

- **Cabecera inválida o ajena en rutas públicas con `OptionalJwtAuthGuard`** (catálogos, clases, honores, certificaciones): devuelve `400`/`403` en vez de ignorarla (FP-15 estricto). Las rutas solo `@Public()` ignoran la cabecera (FP-08).
- **Revocar la tutoría de otro siendo un extraño** devuelve `404 GUARDIANSHIP_NOT_FOUND`, no `403`: anti-enumeración de ids.
- **Escritor de auditoría crítico**: con contexto acting conserva el `actor_role_name` del dependiente mientras `actor_user_id` es el tutor.
- **Registro**: el gate de edad usa el `country_id` que envía el cliente y no se persiste (ruling A4; se endurece en la Fase 3).

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
- Tests: `*.guard.spec.ts`, `acting-for-guards.spec.ts` y `permissions-metadata.spec.ts` en esta carpeta; `src/auth/acting-for/*.spec.ts` para resolver, scopes y snapshot de rutas.

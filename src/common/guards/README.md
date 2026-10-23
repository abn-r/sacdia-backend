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

`PermissionsGuard` resuelve el alcance según `type`: `global`, `user`, `active_assignment`, `club`, `club_section`, `camporee`, `union_camporee`, `camporee_event`, `camporee_venue`, `camporee_payment`, `activity`, `activity_series`, `finance`, `inventory_instance`, `inventory_item`, `club_assignment`, `class_counselor_assignment`, `investiture_enrollment`, `monthly_report`, `insurance_member`, `insurance_record`. El `switch` es exhaustivo: un tipo nuevo sin manejar falla en compilación y en runtime.

Para `user` (y `active_assignment` con `ownerParam`), el propietario del recurso pasa sin evaluar permisos. Para un no propietario, los permisos del rol global base `user` (`BASE_GLOBAL_ROLE_NAME`, lo tiene toda cuenta) NO cuentan: necesita otro rol global, un permiso directo (`users_permissions`) o una de las rutas de miembro de sección del club activo. Por eso el rol base no debe recibir permisos que solo usan rutas propietarias (lo vigila `src/rbac/base-user-role-cross-user-grants.migration.spec.ts`).

`union_camporee` (y `camporee_event` de un camporee de unión) admite al territorio organizador y, como fallback, a actores de campo local (`admin`, `assistant-admin`, `director-lf`, `assistant-lf`) o de club activo solo si su campo local participa en ese camporee (`union_camporee_local_fields` con `active = true`). Un `camporee_venue` con `scope: 'union'` no tiene camporee concreto, así que no aplica el fallback.

`camporee_payment` resuelve el UUID del pago (`idParam`, default `paymentId`) al camporee de su miembro: local → mismo chequeo territorial que `camporee`; de unión → mismo chequeo que `union_camporee`.

### Binding de tenant (`bind`)

`global`, `user` y `active_assignment` no resuelven un recurso propio: solo verifican el permiso. Si la ruta recibe un identificador de tenant (club, sección, campo local, unión, camporee), decláralo en `bind` y el guard lo ata al alcance del actor después del chequeo de `type` (aplica a cualquier `type`):

```typescript
@AuthorizationResource({
  type: 'club',
  clubIdParam: 'clubId',
  bind: [{ kind: 'club_section', source: 'body', field: 'club_section_id' }],
})
```

- `kind`: `club`, `club_section` (debe pertenecer al `:clubId` de la ruta si existe; 404 si no), `local_field`, `union`, `camporee`, `union_camporee` (estricto: solo el territorio organizador, sin el fallback de participación de `type: 'union_camporee'`), `club_enrollment_territory` (recibe UUID de inscripción anual y exige que el territorio del actor cubra el club, sin fallback de asignación de club).
- `source`: `param`, `query` o `body`. Valor ausente o no entero positivo (o UUID inválido en los kinds de inscripción) → 403, salvo `optional: true`.
- El bypass de propietario no omite `bind`.
- `tenant-binding-inventory.spec.ts` falla si una ruta `global`/`user`/`active_assignment` con parámetro de tenant en el path no declara `bind`. Las rutas legacy están congeladas en `tenant-binding-allowlist.ts`; no agregues rutas nuevas ahí.

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
- **RBAC mientras actúa**: `PermissionsGuard` evalúa solo al dependiente (`sub`); los grants propios del tutor nunca se consultan. Sobre rutas propietarias (`user`, `active_assignment` con `ownerParam`) de OTRO usuario (incluido el propio tutor), el rol base `user` del dependiente no cuenta, igual que para cualquier no propietario: 403 `GUARD_PERMISSION_DENIED`. Lo cubren `permissions.guard.spec.ts` y `test/acting-for.e2e-spec.ts`.
- **`ActingForResolver`** (`src/auth/acting-for/`) concede el acceso solo si TODO se cumple: guardianship `pending|verified` entre ese tutor y ese dependiente, tutor **activo** (no borrado ni desactivado), no custodio, no externo, `is_test_data = false`; dependiente activo, **sin `account`**, sin `frozen_at`/`purged_at`, con cumpleaños y edad `< age_of_majority` del país. (El corte de 13 años aplica solo al crear el dependiente: no hay bloqueo al cumplir 13 antes de la Fase 3.)
- Rechazos previos a resolver: token `mfa_pending` o cabecera igual al propio `sub` => `403 ACTING_FOR_FORBIDDEN`. Cabecera repetida o no UUID => `400 ACTING_FOR_HEADER_INVALID`.
- **Denegación uniforme**: unknown, revocado, tutor ajeno, congelado, con cuenta, sobre la mayoría de edad y no dependiente devuelven el mismo `403 ACTING_FOR_FORBIDDEN` (sin enumeración). La causa real se registra en el log del servidor (`acting_for_denied`).

### Scopes (deny-by-default por ruta)

Un principal que no es `kind: 'user'` solo cruza rutas que declaran `@ActingScope(scope)` (`src/auth/acting-for/acting-scope.decorator.ts`; el handler gana sobre la clase) y cuyo scope está en `principal.scopes`. Si no, `403 ACTING_FOR_SCOPE_DENIED` (con `details.required_scope`, solo visible fuera de producción).

| Scope | Qué permite | Quién lo tiene |
| --- | --- | --- |
| `self:read` | Lecturas del propio perfil, clases, honores, inbox de notificaciones, `/auth/me`, dashboard | tutor (pending/verified), teen (pendiente/activo), dispositivo, edad desconocida |
| `health:read` | Salud y contactos de emergencia propios | tutor, teen, edad desconocida |
| `profile:write` | `PATCH /users/:userId`, salud, foto, contactos de emergencia | tutor, teen, edad desconocida |
| `registration:write` | Pasos 1-3 de post-registro, selectores de club/sección, cancelar solicitud, inscripción anual | tutor, teen, edad desconocida |
| `legal:accept` | `POST /users/me/legal-acceptance` (acting: `accepted_by_user_id` = tutor) | tutor, teen, edad desconocida |
| `consent:evidence` | Subir la ficha de consentimiento firmada (paso 3) | solo tutor |
| `classes:write` / `honors:write` | Inscribir y progresar clases / honores; `honors:write` cubre también TODA mutación de evidencia de honores (subir, enlazar, borrar), que el dispositivo no tiene | tutor verified, teen activo |
| `evidence:upload` / `evidence:submit` | Archivos de evidencia de CLASES (subir/borrar) / enviar la sección a revisión (solo la ruta `.../submit`) | tutor verified, teen activo, dispositivo |
| `member:read` / `member:write` | Lecturas y escrituras de la app de miembro (club, sección, unidades, actividades, rankings, jueces) | solo teen activo |
| `agenda:read` | Agenda y actividades (para el dispositivo SIN `attendees`, `rsvp` ni `attendee_profiles`) | teen activo, dispositivo |
| `push:register` | Registrar/borrar el token FCM propio (`/users/me/fcm-tokens`; un dispositivo lo deja anotado en su fila) | teen, dispositivo, edad desconocida |
| `self:password` | `POST /auth/update-password` y reenvío de verificación | teen, edad desconocida |
| `self:preferences` | Preferencias de notificación propias | solo teen |
| `guardian_link:issue` | Emitir el código de vínculo y revocar un vínculo PENDIENTE propio (`/users/me/guardian-link*`) | solo teen pendiente |
| `credential:read` | Credencial QR de miembro (`/qr/me`, `/qr/me/card`, `/qr/me/card.pdf`, `/qr/member/token`) | tutor, teen ACTIVO, dispositivo; nunca teen pendiente ni edad desconocida |
| `club:context` | `PATCH /auth/me/context` (cambiar la asignación de club activa) | tutor, teen ACTIVO; nunca teen pendiente ni edad desconocida |
| `account:manage` | Sesiones, proveedores OAuth y borrar la cuenta | solo edad desconocida |

- **Nunca llevan scope** (siempre 403 mientras se actúa): contraseña, MFA, sesiones, OAuth, borrar cuenta, exportar datos, FCM, preferencias de notificación, `/guardianships/*`, `legal-representative*`, propuesta de instructor, maestrías, certificaciones, admin, clubes, secciones, escaneo QR, envío de notificaciones, catálogo legal y la salida `POST /users/:userId/post-registration/step-3/guardian-only`.
- La fuente de verdad es el snapshot `src/auth/acting-for/acting-scope-metadata.spec.ts`: lista cada ruta con su scope y la denylist. Un `@ActingScope` a nivel de clase está prohibido (el spec falla): cada ruta opta de forma individual. **Al añadir o cambiar una ruta con scope hay que actualizar ese spec**; una ruta sin `@ActingScope` falla cerrada (403) y rompe el flujo de la app, no es una fuga.

### Cómo se aplica en los guards

- `JwtAuthGuard.handleRequest` (heredado por `GlobalJwtAuthGuard`) llama a `assertActingScope` justo después del chequeo MFA, y relanza los errores de acting sin convertirlos a 401. El guard global y los `@UseGuards(JwtAuthGuard)` locales deciden igual porque el scope se evalúa donde se crea el principal.
- `OptionalJwtAuthGuard`: errores de acting se relanzan; un principal acting en una ruta sin scope se degrada a **anónimo** (rutas públicas, mínimo privilegio).
- Caché del grant en Redis: `acting:v1:{dependentId}:{epoch}:{guardianId}`, 60 s para un grant y 10 s para una denegación; el epoch vive en `acting:epoch:{dependentId}`. **Toda mutación de guardianship llama a `ActingForCache.bump(dependentId)` tras el commit** (crear, canjear código, revocar, borrado de cuenta, purga). Un epoch ausente (expirado, flush, evicción) es un fallo de caché, no epoch 0: el resolver crea un epoch nuevo antes de leer la DB y no lee ningún payload bajo él. Si Redis falla se lee la DB; si la DB falla => `503 AUTH_REVOCATION_CHECK_UNAVAILABLE` (nunca falla abierto). Un memo por request evita repetir la consulta cuando un guard local vuelve a ejecutar `validate`.
- Rate limit: `UserAwareThrottlerGuard` usa `actor_sub`, así que el tráfico acting cuenta contra el tutor.
- La denegación por scope depende del kind: `guardian_acting` => `403 ACTING_FOR_SCOPE_DENIED` (el interceptor de la app sale de "actuando"); `supervised_user`, `linked_device` y `age_unknown_user` => `403 PRINCIPAL_SCOPE_DENIED` con `details.kind` (y `supervision`), que nunca dispara esa salida.

## Kinds de principal (Fase 3)

`request.user.kind` lo decide el **servidor** en `JwtStrategy.validate`, nunca un claim del token (un `kind` falsificado se ignora). Todo kind distinto de `user` es deny-by-default (solo rutas con `@ActingScope` de un scope que tenga). Los conjuntos viven en `src/auth/acting-for/auth-principal.ts`.

| Kind | Quién | Scopes | Notas |
| --- | --- | --- | --- |
| `user` | Adulto, cuenta sin edad registrada creada por admin/legado, anónimo | `null` (sin restricción) | Igual que siempre. |
| `guardian_acting` | Tutor con `X-Acting-For` (Fase 2) | `GUARDIAN_PENDING_SCOPES` / `GUARDIAN_VERIFIED_SCOPES` | Principal sustituido (ver arriba). |
| `supervised_user` | Titular de cuenta menor de la mayoría de edad del país | `TEEN_PENDING_SCOPES` (`supervision: 'pending_guardian'`) o `TEEN_SCOPES` (`'active'`) | `active` solo con una tutoría NO custodia, `verified`, no de prueba y no revocada. `X-Acting-For` => `403 ACTING_FOR_FORBIDDEN`. |
| `age_unknown_user` | Sin cumpleaños con el post-registro abierto (alta Google/Apple antes del paso 2) | `AGE_UNKNOWN_SCOPES` | Solo onboarding + `account:manage`. Un cumpleaños adulto lo vuelve `user`; uno menor, `supervised_user`. |
| `linked_device` | Teléfono vinculado de un menor de 13 (Fase 3b, `FAMILY_LINKED_DEVICE_ENABLED`) | `DEVICE_SCOPES` = `self:read`, `evidence:upload`, `evidence:submit`, `push:register`, `agenda:read`, `credential:read` (NO `club:context`, NO `health:read`) | JWT `aud: sacdia:device`. `X-Acting-For` => `403 ACTING_FOR_FORBIDDEN`. Ver la sección siguiente. |

- **Resolución** (`SupervisedPrincipalResolver`, `src/auth/supervised/`): una consulta a `users` (cumpleaños, país, `supervised_login`, perfil congelado, tutorías verificadas). Caché `supv:v3:{userId}:{epoch}` con el MISMO epoch que acting-for (`acting:epoch:{userId}`): 1 h adulto, 60 s supervisado o edad desconocida, 10 s bloqueado, siempre recortado a la medianoche local del país (la mayoría de edad aplica sin esperar el TTL). Redis caído => DB; DB caída => `503 AUTH_REVOCATION_CHECK_UNAVAILABLE`.
- **Corte inmediato del teen**: deshabilitar, restablecer, congelar o perder al tutor => `401 AUTH_SUPERVISED_ACCESS_REVOKED` en la siguiente petición (la sesión `sid` se comprueba por petición para `supervised_user`, cacheada bajo el epoch).
- **`FAMILY_TEEN_LOGIN_ENABLED` apagado (FP3-35)**: una cuenta cuyo `supervised_logins.method` es `handle` queda `blocked: teen_login_disabled` => `401 AUTH_SUPERVISED_ACCESS_REVOKED` en cada petición y `POST /auth/refresh` rechazado con el mismo código. Los teens con método `email` no se tocan. El método va en la caché; la bandera se aplica encima en cada llamada (sin bump ni espera). Las sesiones no se borran: encender la bandera las restaura. La bandera se lee del `ConfigService` en cada petición, pero en un servidor desplegado su valor es la foto del env validada al arrancar: **cambiarla exige reiniciar**.
- **Sin datos de club para un teen pendiente** (FP3-03/FP3-07): `principalSeesClubData(principal)` es `false` para `supervised_user` sin `supervision: 'active'` y para `age_unknown_user`. `GET /dashboard/summary` sigue accesible pero devuelve `club_name`, `club_type`, `user_role` en `null` y `upcoming_activities` vacío; su propio progreso (clase, honores) sí se devuelve. La credencial QR (`credential:read`) y el cambio de contexto de club (`club:context`) no existen para ellos (403 `PRINCIPAL_SCOPE_DENIED`), también con una asignación activa anterior al despliegue; `GET /auth/me` sigue accesible pero sin asignación, contexto ni nombres de club. La superficie completa de un teen pendiente está fijada ruta por ruta en `PENDING_TEEN_SURFACE` (`acting-scope-metadata.spec.ts`). Tampoco recibe notificaciones de club (push ni bandeja): `ClubDataRecipientsService.filterClubDataRecipients()` (una consulta por envío, misma derivación que `SupervisedPrincipalResolver`) filtra el broadcast de club, el fan-out por rol de sección, la invalidación realtime silenciosa, el recordatorio de actividades por clase y el aviso de miembro del mes. Los avisos personales (`sendToUser`, `family:*`) y el fan-out a tutores de un dependiente sin cuenta no se filtran.
- **Auditoría**: `actor_kind = 'supervised_user'`, actor = el propio teen.

### Dispositivo vinculado (Fase 3b)

El teléfono de un menor SIN cuenta y menor de `minSelfLoginAge` del país, emparejado por un tutor VERIFICADO con un QR (`POST /guardianships/me/dependents/:id/devices/pairing-tokens`, canje público `POST /auth/device/pair`). No hay chat ni mensajería de ningún tipo.

- **Token**: HS256, `iss` de acceso, `aud` EXACTAMENTE el string `sacdia:device` (un array, o ambos audiences, es 401), `sub` = el menor, `sid` = sesión del dispositivo, `dev` = id del dispositivo, `jti` aleatorio, 1 h. `JwtStrategy` acepta `[sacdia:access, sacdia:device]` como opción `audience` y distingue por el conjunto de claims; `presented-access-jwt` y el throttler aceptan ambos (el dispositivo se limita como `user:{dependentId}`). Un claim `dev` en un token de acceso se ignora.
- **Cada petición** pasa por `LinkedDeviceGate` (`src/auth/device/`): bandera `FAMILY_LINKED_DEVICE_ENABLED` (apagada => `401 AUTH_DEVICE_REVOKED`, sin tocar datos), fila `linked_devices` activa (id + dependiente + `sid`) antes de su tope absoluto (180 días; después `401 AUTH_DEVICE_SESSION_EXPIRED`), sesión viva, menor activo, no congelado, SIN login supervisado habilitado, menor de la mayoría de edad y tutoría de emparejamiento `verified`, no custodia, no de prueba. Caché `device:v1:{dependentId}:{epoch}:{deviceId}` (30 s activo / 10 s inactivo, recortado al tope y a la medianoche local) sobre el MISMO epoch de acting-for: revocar borra la sesión y mueve el epoch, así que la SIGUIENTE petición es 401 aunque el JWT siga vigente. Redis caído => DB; DB caída => `503 AUTH_REVOCATION_CHECK_UNAVAILABLE`. `last_seen_at` se escribe como máximo cada 5 min y su fallo nunca falla la petición. Una causa de ciclo de vida dispara una revocación sin esperar, para que la fila registre el motivo.
- **Superficie** (fijada en `DEVICE_SURFACE`, `acting-scope-metadata.spec.ts`): lecturas propias (`/auth/me`, dashboard, clases, honores, notificaciones, legal), evidencia de CLASES (subir/borrar/enviar), agenda sin listas de miembros, token FCM propio, credencial QR. Nada de salud, perfil, contraseña, sesiones, `/guardianships/*`, evidencia de honores ni `/fcm-tokens` legado. Sin `club:context`.
- **Datos de club**: `principalSeesClubData(linked_device)` es `true` (solo autentica con una tutoría verificada, igual que un teen activo); `ClubDataRecipientsService` nunca filtra a un menor sin cuenta; un push de club llega al token del dispositivo Y los tutores siguen recibiendo la copia etiquetada (`DependentPushRouterService`).
- **Refresh/logout**: una sesión de dispositivo refresca SOLO a un JWT de dispositivo (la decide la fila `linked_devices`, nunca el token), 30 días deslizantes sin pasar del tope; una fila revocada o vencida nunca cae en la ruta de usuario. El logout con el refresh token del dispositivo lo revoca (`device_logout`).
- **Revocación** (`LinkedDeviceRevocation`): razón en `linked_devices.revoked_reason` (CHECK: `guardian`, `guardianship_revoked`, `guardian_account_closed`, `teen_login_enabled`, `majority`, `dependent_frozen`, `device_logout`, `session_revoked`, `admin`, `expired`), sesión borrada, token FCM propio desactivado, fila de auditoría `linked_device.revoked`. Los 3a la invocan por el puerto `LINKED_DEVICE_REVOKER`, que desde 3b es OBLIGATORIO y está ligado a `LinkedDevicesService` (sin no-op).
- **Auditoría**: `actor_kind = 'linked_device'`, actor = el menor, `request_context.linked_device_id`. El log de peticiones muestra `device:<id>`. El token de emparejamiento y `qr_payload` se redactan en pino, Sentry y el filtro de excepciones.

### Auditoría

`applyActingForAttribution` (`src/audit-logs/acting-for-attribution.ts`) corre en `AuditLogsService.recordEvent` y en el writer crítico: con contexto acting y actor ausente o igual al sujeto guarda `actor_user_id` = tutor, `actor_kind = 'guardian_acting'`, `target_user_id` = dependiente y `request_context.acting_for`. Un actor explícito distinto (p. ej. un director) no se sobrescribe. Las columnas de dominio (quien subió una evidencia) siguen guardando al dependiente.

### Comportamientos conocidos (decisiones, no bugs)

- **Cabecera inválida o ajena en rutas públicas con `OptionalJwtAuthGuard`** (catálogos, clases, honores, certificaciones): devuelve `400`/`403` en vez de ignorarla (FP-15 estricto). Las rutas solo `@Public()` ignoran la cabecera (FP-08).
- **Revocar la tutoría de otro siendo un extraño** devuelve `404 GUARDIANSHIP_NOT_FOUND`, no `403`: anti-enumeración de ids.
- **Escritor de auditoría crítico**: con contexto acting conserva el `actor_role_name` del dependiente mientras `actor_user_id` es el tutor.
- **Registro**: desde la Fase 3 el registro guarda el cumpleaños y el `country_id`, así que un registro de 13-17 años es `supervised_user` pendiente desde la primera petición.

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

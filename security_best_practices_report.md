# SACDIA Backend Security Review Report

Fecha: 2026-03-30  
Scope: `/Users/abner/Documents/development/sacdia/sacdia-backend`

## Executive summary

Encontré **2 hallazgos altos**, **2 medios** y **2 bajos**, más un bloque de **riesgo por dependencias**.  
Lo más serio hoy es:

1. **OAuth callback URL controlada por el cliente**, con riesgo de open redirect y potencial exfiltración de sesión/tokens.
2. **Endpoints multipart sin límites de Multer**, donde la validación de tamaño ocurre demasiado tarde y deja expuesta la API a **DoS por consumo de memoria**.

Además, `pnpm audit --audit-level=high` reporta **54 vulnerabilidades** en el árbol de dependencias, incluyendo issues **runtime** en `path-to-regexp` y `node-forge`.

## Methodology

- Lectura de documentación canónica y guías de seguridad del workspace.
- Revisión manual de bootstrap, auth, guards, uploads, logging y storage.
- Búsquedas estáticas de patrones sensibles (`FileInterceptor`, OAuth redirect, JWT, R2, filtros de error, raw queries).
- Verificación local:
  - `pnpm exec tsc --noEmit`
  - `pnpm exec jest src/auth/auth.service.spec.ts src/auth/strategies/jwt.strategy.spec.ts src/common/guards/permissions.guard.spec.ts --runInBand`
  - `pnpm audit --audit-level=high`

## Findings

### SEC-001 — High — OAuth callback URL controlada por el cliente

- **Impacto**: permite open redirect y puede facilitar exfiltración de sesión/tokens si el flujo OAuth entrega material de sesión al `callbackURL`.
- **Ubicación**:
  - `/Users/abner/Documents/development/sacdia/sacdia-backend/src/auth/dto/oauth-initiate.dto.ts:10-12`
  - `/Users/abner/Documents/development/sacdia/sacdia-backend/src/auth/oauth.service.ts:68-87`
  - `/Users/abner/Documents/development/sacdia/sacdia-backend/src/better-auth/better-auth.service.ts:721-744`
  - `/Users/abner/Documents/development/sacdia/sacdia-backend/src/auth/oauth.controller.ts:41-43, 107-108`
- **Evidencia**:
  - `redirectUrl` solo valida que sea URL, no que pertenezca a una allowlist.
  - `OAuthService` pasa `redirectUrl` directamente a `betterAuth.getOAuthUrl(...)`.
  - El propio controller documenta que Better Auth redirige a `callbackURL` y que el cliente puede leer el session token desde cookie **o del fragment de la callbackURL**.
- **Por qué importa**: si un atacante consigue que el backend genere un flujo hacia un dominio arbitrario, ese dominio puede convertirse en receptor del retorno OAuth. En el mejor caso es phishing/open redirect; en el peor, si el frontend o el proveedor usan fragment/query para transportar estado o sesión, hay riesgo de robo de credenciales.
- **Fix recomendado**:
  - Reemplazar `@IsUrl()` por validación estricta contra allowlist de origins/callback paths.
  - Aceptar solo callback URLs conocidas por entorno (`admin`, `mobile deep links`, etc.).
  - Rechazar cualquier dominio externo no registrado.

### SEC-002 — High — Uploads multipart sin límite real antes del buffering

- **Impacto**: un usuario autenticado puede enviar archivos gigantes y forzar consumo excesivo de memoria antes de que la app rechace el tamaño.
- **Ubicación**:
  - `/Users/abner/Documents/development/sacdia/sacdia-backend/src/common/pipes/file-validation.pipe.ts:37-50`
  - `/Users/abner/Documents/development/sacdia/sacdia-backend/src/users/users.controller.ts:208-236`
  - `/Users/abner/Documents/development/sacdia/sacdia-backend/src/classes/classes.controller.ts:282-326`
  - `/Users/abner/Documents/development/sacdia/sacdia-backend/src/activities/activities.controller.ts:163-190`
  - `/Users/abner/Documents/development/sacdia/sacdia-backend/src/insurance/insurance.controller.ts:127-208`
  - `/Users/abner/Documents/development/sacdia/sacdia-backend/src/folders/evidence-folder.controller.ts:85-129`
  - `/Users/abner/Documents/development/sacdia/sacdia-backend/src/honors/honors.controller.ts:220-274`
- **Evidencia**:
  - Los controllers usan `FileInterceptor(...)` / `FileFieldsInterceptor(...)` sin `limits.fileSize`.
  - La verificación de tamaño está en `FileValidationPipe`, o sea **después** de que Multer ya entregó el archivo al handler.
- **Por qué importa**: ese pipe protege la lógica de negocio, pero NO protege la memoria del proceso. Si el upload ya fue bufferizado, el rechazo llega tarde.
- **Fix recomendado**:
  - Definir `limits.fileSize` en TODOS los interceptors multipart.
  - Opcional: agregar `files`, `parts` y `fieldSize` limits.
  - Centralizar una factory de interceptors seguros para no repetir errores.

### SEC-003 — Medium — Validación débil de archivos en `resources`

- **Impacto**: un actor con permiso `resources:create` puede subir contenido disfrazado usando `mimetype` controlado por cliente; el backend lo almacena y lo redistribuye con ese `Content-Type`.
- **Ubicación**:
  - `/Users/abner/Documents/development/sacdia/sacdia-backend/src/resources/resources.controller.ts:44-48`
  - `/Users/abner/Documents/development/sacdia/sacdia-backend/src/resources/pipes/resource-file-validation.pipe.ts:37-74`
  - `/Users/abner/Documents/development/sacdia/sacdia-backend/src/resources/resources.service.ts:90-101`
- **Evidencia**:
  - El flujo de `resources` valida tamaño y `file.mimetype`, pero no magic bytes ni firma real del archivo.
  - Luego persiste `contentType: file.mimetype` al subir a R2.
- **Por qué importa**: esto no es tan grave como un RCE, pero sí habilita almacenamiento y distribución de archivos mal rotulados, especialmente problemático si después esos recursos se consumen desde navegadores o clientes móviles.
- **Fix recomendado**:
  - Reusar `FileValidationPipe` con magic bytes donde sea posible.
  - Para Office/audio, validar firma real o limitar formatos.
  - Forzar `Content-Disposition: attachment` para tipos no confiables.

### SEC-004 — Medium — Excepción HTTP en desarrollo puede loggear bodies sensibles

- **Impacto**: errores 4xx/5xx en dev pueden dejar `refreshToken`, datos médicos u otra PII en logs.
- **Ubicación**:
  - `/Users/abner/Documents/development/sacdia/sacdia-backend/src/common/filters/http-exception.filter.ts:34-42`
  - `/Users/abner/Documents/development/sacdia/sacdia-backend/src/common/filters/http-exception.filter.ts:91-95`
- **Evidencia**:
  - En desarrollo el filtro agrega `requestBody`.
  - La sanitización especial solo se aplica a URLs que contienen `/auth/login`.
  - Para el resto de rutas devuelve el body tal cual.
- **Por qué importa**: aunque sea “solo dev”, en equipos reales esos logs suelen terminar en terminal compartida, archivos locales, CI fallida o incluso colectores centralizados.
- **Fix recomendado**:
  - Aplicar redacción genérica por claves sensibles, no por ruta puntual.
  - Excluir por defecto cuerpos de auth, salud, legales, MFA y tokens.

### SEC-005 — Low — Token de verificación de email se loggea en desarrollo

- **Impacto**: cualquier actor con acceso a logs de desarrollo puede tomar el token y verificar cuentas ajenas mientras siga vigente.
- **Ubicación**:
  - `/Users/abner/Documents/development/sacdia/sacdia-backend/src/auth/auth.service.ts:715-733`
- **Evidencia**:
  - `createAndLogVerificationToken()` genera el token y lo loggea completo cuando `NODE_ENV === 'development'`.
- **Fix recomendado**:
  - No loggear nunca el token raw.
  - Si hace falta debug, loggear solo hash o prefijo truncado.

### SEC-006 — Low — El árbol de dependencias tiene vulnerabilidades activas

- **Impacto**: aumenta la superficie explotable; una parte es solo dev/test, pero también hay issues en dependencias runtime.
- **Evidencia**:
  - `pnpm audit --audit-level=high` reportó `54 vulnerabilities found` (`4 low | 21 moderate | 28 high | 1 critical`).
  - `pnpm why` mostró dependencias relevantes:
    - `@nestjs/core -> path-to-regexp 8.3.0`
    - `firebase-admin -> node-forge 1.3.3`
    - `ts-jest -> handlebars 4.7.8`
- **Notas**:
  - `handlebars` entra por `ts-jest`, así que hoy parece **dev-only**.
  - `path-to-regexp` y `node-forge` sí impactan runtime.
- **Fix recomendado**:
  - Priorizar updates/overrides para runtime primero.
  - Volver a correr `pnpm audit` después de actualizar lockfile.

## Validation notes

### Passing

- `pnpm exec jest src/auth/auth.service.spec.ts src/auth/strategies/jwt.strategy.spec.ts src/common/guards/permissions.guard.spec.ts --runInBand`
  - Resultado: **3 suites, 65 tests, todo OK**

### Failing

- `pnpm exec tsc --noEmit`
  - Error actual:
    - `/Users/abner/Documents/development/sacdia/sacdia-backend/src/club-enrollments/club-enrollments.service.ts:76`
    - `Type 'MeetingScheduleItemDto[] | undefined' is not assignable to type 'InputJsonValue | NullableJsonNullValueInput | undefined'`

## Recommended remediation order

1. **Cerrar `redirectUrl` con allowlist estricta** en OAuth.
2. **Agregar `limits.fileSize` y límites multipart** a todos los endpoints de upload.
3. **Fortalecer validación de `resources`** y evitar confiar en `mimetype`.
4. **Redactar logs sensibles por política global**, no por endpoint.
5. **Actualizar dependencias runtime vulnerables** y luego limpiar dev-only.


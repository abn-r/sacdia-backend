# Auth Test Coverage Report (2026-02-10)

## Objetivo
Ejecutar el plan de pruebas unitarias para cubrir flujos criticos de `auth`, `oauth` y `sessions` sin modificar comportamiento de produccion.

## Archivos de pruebas actualizados
- `src/auth/auth.service.spec.ts`
- `src/auth/auth.controller.spec.ts`
- `src/auth/oauth.service.spec.ts` (nuevo)
- `src/auth/sessions.controller.spec.ts` (nuevo)

## Cobertura funcional agregada

### `src/auth/auth.service.spec.ts` (19 tests)
- `register`: exito, error Supabase, rollback por error DB, rollback por rol faltante.
- `login`: credenciales invalidas, usuario no encontrado en DB, exito con roles y estado post-registro.
- `logout`: exito y error de proveedor externo.
- `requestPasswordReset`: exito con `redirectTo` y error controlado.
- `getProfile`: usuario inexistente y exito con permisos unicos.
- `getCompletionStatus`: no iniciado + rutas de `nextStep` (`profilePicture`, `personalInfo`, `clubSelection`, `null`).

### `src/auth/auth.controller.spec.ts` (7 tests)
- Delegacion de endpoints:
  - `register`
  - `login`
  - `logout` (extraccion de token `Bearer`)
  - `password/reset-request`
  - `me`
  - `profile/completion-status`

### `src/auth/oauth.service.spec.ts` (12 tests)
- `initiateGoogleSignIn`: exito y error.
- `initiateAppleSignIn`: exito con default redirect y error.
- `handleCallback`: token invalido, usuario existente, primer login con autocreacion en DB.
- `getConnectedProviders`: usuario existente / inexistente.
- `disconnectProvider`: provider invalido y provider valido.

### `src/auth/sessions.controller.spec.ts` (4 tests)
- `listSessions`: delegacion con `user_id`.
- `closeSession`: cierre puntual por `sessionId`.
- `closeAllSessions`: blacklist global + cierre total y respuesta con conteo.

## Ejecucion y resultado

Comando ejecutado:

```bash
npm test -- --runTestsByPath src/auth/auth.service.spec.ts src/auth/auth.controller.spec.ts src/auth/oauth.service.spec.ts src/auth/sessions.controller.spec.ts
```

Resultado:
- Test Suites: `4 passed, 4 total`
- Tests: `42 passed, 42 total`
- Fecha de ejecucion: `2026-02-10`

## Notas
- Durante ejecucion se observan logs `ERROR` de Nest en consola por pruebas negativas (errores esperados para validar manejo de excepciones).
- No se cambiaron endpoints, DTOs ni contratos publicos; solo pruebas.

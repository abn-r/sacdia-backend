# ADR-0001: Compatibilidad Temporal de Refresh Legacy + Logout Fail-safe

## Status

Accepted

## Date

2026-03-04

## Context

Después del cutover de Auth del **2026-03-01**, el backend pasó a rechazar `refresh_token` (snake_case) por defecto.  
Se observó riesgo de bloqueo de sesión en clientes legacy al expirar el access token, especialmente en la ventana cercana a 24h de uso continuo.  
Adicionalmente, `POST /auth/logout` dependía de JWT válido, lo que impedía salida limpia cuando el access token ya estaba expirado.

## Decision Drivers

- Evitar bloqueo de usuario final por expiración de token.
- Mantener contrato oficial (`refreshToken`) sin romper operación durante migración.
- Preservar seguridad operativa y trazabilidad de cambios.
- Definir fecha explícita de retorno a modo estricto.

## Considered Options

### Option 1: Keep strict mode immediately (`AUTH_REJECT_SNAKE_CASE=true`)

Pros:
- Contrato limpio y consistente.

Cons:
- Alto riesgo de fallo de refresh en clientes no migrados.
- Incidentes de sesión bloqueada.

### Option 2: Compatibilidad temporal + fecha de corte (Chosen)

Pros:
- Reduce fricción de usuarios.
- Permite migración controlada y medible.
- Mantiene disciplina de contrato con fecha de salida.

Cons:
- Ventana temporal de deuda de compatibilidad.
- Más complejidad operativa en monitoreo y deploy.

### Option 3: Compatibilidad permanente

Pros:
- Cero fricción para clientes legacy.

Cons:
- Deuda técnica permanente.
- Mayor ambigüedad de contrato a largo plazo.

## Decision

Adoptar **compatibilidad temporal**:

1. `AUTH_REJECT_SNAKE_CASE=false` entre **2026-03-04** y **2026-03-18**.
2. Mantener `refreshToken` (camelCase) como contrato oficial.
3. Implementar `logout` en modo **best effort** para no bloquear UX.
4. Volver a estricto (`AUTH_REJECT_SNAKE_CASE=true`) el **2026-03-18**, sujeto a métricas de adopción.

## Consequences

### Positive

- Menor riesgo de bloqueo de sesión en producción.
- Migración controlada con observabilidad explícita.
- Mejor resiliencia del flujo de salida (logout).

### Negative

- Incremento temporal en complejidad de operación.
- Requiere disciplina para ejecutar cutback en fecha acordada.

## Operational Signals

- `event:auth_refresh_legacy_allowed`
- `event:auth_refresh_success`
- `event:auth_refresh_failed`
- `event:auth_logout_best_effort`
- `event:auth_logout_revoke_failed`

## Related Documents

- `docs/IMPLEMENTATION-SESSION-2026-03-01-auth-cutover-monitoring.md`
- `docs/IMPLEMENTATION-SESSION-2026-03-04-session-stabilization.md`
- `README.md` (sección de variables/monitoreo auth)

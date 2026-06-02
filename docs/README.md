# Documentación Local de `sacdia-backend`

Última actualización: **2026-03-04**

Este directorio contiene documentación técnica local del backend (implementaciones, migraciones y revisiones).  
La documentación funcional oficial del producto está en el repositorio padre: `../../docs`.

## Documentos vigentes (fuente principal en este repo)

- `README.md`
  - Guía operativa actual del backend (setup, scripts, endpoints críticos, checklist de release).
- `BENCHMARKING.md`
  - Guía para ejecutar benchmark baseline, stress y spike de la API con autocannon.
- `docs/storage/r2-keyprefix-conventions.md`
  - Convenciones de key-prefix y URL pública para los buckets de Cloudflare R2. Incluye tabla de los 13 aliases, los dos patrones de construcción de URL (bare vs embedded), la lógica de detección `isKeyPrefixInPublicBaseUrl`, el plan de migración al estado objetivo (bare-domain), y las convenciones de scripts one-shot.
- `docs/IMPLEMENTATION-SESSION-2026-02-13-admin-hardening.md`
  - Implementación del sprint de hardening de notificaciones + habilitación admin.
- `docs/IMPLEMENTATION-SESSION-2026-02-21-user-medical-and-geography.md`
  - Endpoints para persistir y desactivar (borrado lógico) alergias/enfermedades por usuario y extensión de PATCH de perfil con geografía.
- `docs/IMPLEMENTATION-SESSION-2026-03-01-auth-cutover-monitoring.md`
  - Snapshot histórico del cutover inicial de Auth del 2026-03-01.
- `docs/IMPLEMENTATION-SESSION-2026-03-04-session-stabilization.md`
  - Estabilización de sesiones/Auth: logout fail-safe, enriquecimiento de observabilidad y ventana temporal de compatibilidad legacy.
- `docs/BACKEND-PANORAMA-2026-03-04.md`
  - Barrido consolidado del estado real del backend (módulos, riesgos operativos, documentación vigente e hitos siguientes).
- `docs/adr/ADR-0001-auth-session-compat-window.md`
  - Decisión arquitectónica operativa sobre compatibilidad temporal de `refresh_token` y fecha de cutback a contrato estricto.
- `docs/reviews/security-audit-exceptions-2026-05-08.md`
  - Excepción temporal para hallazgos `pnpm audit` de `next` transitivo vía Better Auth, con justificación runtime NestJS/no Next.
- `docs/migrations/2026-02-21-emergency-contacts-relationship-type-uuid.md`
  - Migración de `emergency_contacts.relationship_type` (int legacy) a `relationship_type_id` (UUID) con FK a `relationship_types`.

## Documentos históricos (referencia)

- `docs/IMPLEMENTATION-SESSION-2026-02-05.md`
  - Snapshot de implementación del 2026-02-05. Puede no reflejar el estado actual completo.
- `docs/migrations/2026-02-05-db-push-sync.md`
  - Baseline de sincronización DB del 2026-02-05.
- `docs/reviews/*.md`
  - Revisiones y reportes puntuales de fechas específicas.

## Convención recomendada

Para reducir desactualización:

1. Actualiza `README.md` en cada cambio de contrato público o script operativo.
2. Para entregas de sprint, crea/actualiza `docs/IMPLEMENTATION-SESSION-YYYY-MM-DD-*.md`.
3. En documentos históricos, agrega una nota de vigencia al inicio.
4. Si una decisión impacta producto/arquitectura global, sincroniza también en `../../docs`.

## Estado operativo actual (resumen rápido)

- Auth/sesiones en estabilización:
  - Contrato oficial de refresh: `refreshToken` (camelCase).
  - Ventana temporal de compatibilidad legacy activa hasta **2026-03-18**.
  - `logout` en modo best-effort para evitar bloqueo de UX por expiración de access token.
- Seguridad runtime:
  - Rate limiting usa Redis distribuido de forma obligatoria en producción (`REDIS_URL`);
    en desarrollo/test puede caer a memoria.
  - IP whitelist/CIDR para endpoints admin sigue **pendiente**: no existe
    `ip-whitelist.guard.ts` ni decorator runtime activo en este repo.
- Ver seguimiento en:
  - `docs/IMPLEMENTATION-SESSION-2026-03-04-session-stabilization.md`
  - `docs/BACKEND-PANORAMA-2026-03-04.md`

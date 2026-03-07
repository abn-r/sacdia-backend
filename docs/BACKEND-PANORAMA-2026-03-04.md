# Panorama Backend SACDIA (2026-03-04)

## Resumen ejecutivo

El backend está operativo con cobertura funcional amplia (auth, usuarios, catálogos, admin, notificaciones, clubs, classes, honors, finanzas, inventario, certificaciones y carpetas).  
El foco activo actual es **estabilización de sesiones Auth** para eliminar bloqueos de UX tras expiración de access token.

## Estado funcional consolidado

1. Auth/Sesiones:
   - Login con token envelope completo (`accessToken`, `refreshToken`, `expiresAt`, `tokenType`).
   - Refresh oficial en camelCase (`refreshToken`).
   - Ventana temporal de compatibilidad legacy activa hasta **2026-03-18**.
   - Logout fail-safe en best effort para evitar bloqueo por access token expirado.
   - Contexto activo de club/instancia configurable por usuario (`PATCH /api/v1/auth/me/context`).
   - `GET /api/v1/auth/me` expone `club_context` (activo + disponibles) para switching explícito en cliente.
2. Seguridad:
   - JWT guards y roles globales aplicados en módulos sensibles.
   - Eventos de observabilidad auth y revocación activos.
3. Administración:
   - Endpoints admin bajo `/api/v1/admin/*` para geografía y catálogos de referencia.
4. Salud de usuario y geografía:
   - Endpoints de alergias/enfermedades y patch de geografía de perfil habilitados.
5. Notificaciones/FCM:
   - Hardening aplicado.
   - Aún depende de configuración de entorno para FCM productivo.
6. Actividades:
   - Soporte multi-instancia habilitado mediante tabla puente `activity_instances`.
   - Una actividad puede mostrarse en más de una instancia del mismo club.

## Estado operativo (hoy)

1. Build local: OK.
2. Unit tests auth: OK.
3. E2E auth: OK.
4. Riesgo operativo principal actual:
   - Completar cutback de compatibilidad de refresh el **2026-03-18** sin regresión.
   - Aplicar migración `20260304170000_add_active_club_context_to_users_pr` en todos los entornos.
   - Aplicar migración `20260304183000_add_activity_instances_bridge` en todos los entornos.

## Riesgos abiertos y seguimiento

1. Riesgo de extender compatibilidad legacy más allá de la fecha objetivo.
   - Mitigación: monitorear `auth_refresh_legacy_allowed` diariamente y ejecutar cutback planificado.
2. Dependencias de entorno (según documentación histórica):
   - Redis puede caer a in-memory fallback.
   - FCM puede quedar deshabilitado si credenciales no son válidas.
3. Riesgo documental:
   - Evitar duplicidad entre snapshot histórico y estado vigente.
   - Mitigación: mantener `docs/README.md` como índice fuente.

## Inventario de documentación (barrido completo)

### Vigente (fuente principal actual)

1. `README.md`
   - Guía operativa principal del backend.
2. `docs/README.md`
   - Índice y clasificación de documentación local.
3. `docs/IMPLEMENTATION-SESSION-2026-03-04-session-stabilization.md`
   - Estado actual de sesiones/Auth + evidencia de verificación.
4. `docs/adr/ADR-0001-auth-session-compat-window.md`
   - Decisión sobre compatibilidad temporal y fecha de corte.
5. `docs/IMPLEMENTATION-SESSION-2026-02-21-user-medical-and-geography.md`
   - Estado de endpoints de salud/geografía de usuario.
6. `docs/IMPLEMENTATION-SESSION-2026-02-13-admin-hardening.md`
   - Hardening de notificaciones + admin base.
7. `docs/migrations/2026-02-21-emergency-contacts-relationship-type-uuid.md`
   - Migración UUID vigente de contactos de emergencia.
8. `docs/migrations/2026-02-18-legacy-catalog-import.md`
   - Proceso de importación legacy (operativo como referencia de tooling).

### Histórica (referencia, no estado actual por sí sola)

1. `docs/IMPLEMENTATION-SESSION-2026-03-01-auth-cutover-monitoring.md`
   - Snapshot del cutover inicial auth.
2. `docs/IMPLEMENTATION-SESSION-2026-02-05.md`
   - Snapshot histórico de implementación.
3. `docs/migrations/2026-02-05-db-push-sync.md`
   - Baseline histórico de sincronización DB.
4. `docs/reviews/*.md`
   - Revisiones puntuales por fecha.

## Próximos hitos recomendados

1. Ejecutar cutback de `AUTH_REJECT_SNAKE_CASE=true` el **2026-03-18** con smoke post-deploy.
2. Consolidar evidencia post-cutback en una sesión de implementación nueva (2026-03-18 o posterior).
3. Mantener una actualización semanal del panorama hasta cerrar ventana Auth.

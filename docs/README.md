# Documentación Local de `sacdia-backend`

Última actualización: **2026-03-01**

Este directorio contiene documentación técnica local del backend (implementaciones, migraciones y revisiones).  
La documentación funcional oficial del producto está en el repositorio padre: `../../docs`.

## Documentos vigentes (fuente principal en este repo)

- `README.md`
  - Guía operativa actual del backend (setup, scripts, endpoints críticos, checklist de release).
- `docs/IMPLEMENTATION-SESSION-2026-02-13-admin-hardening.md`
  - Implementación del sprint de hardening de notificaciones + habilitación admin.
- `docs/IMPLEMENTATION-SESSION-2026-02-21-user-medical-and-geography.md`
  - Endpoints para persistir y desactivar (borrado lógico) alergias/enfermedades por usuario y extensión de PATCH de perfil con geografía.
- `docs/IMPLEMENTATION-SESSION-2026-03-01-auth-cutover-monitoring.md`
  - Ejecución operativa del cutover inmediato de Auth (`snake_case` retirado), despliegue y monitoreo de 14 días.
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

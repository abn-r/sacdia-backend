# AI Context - SACDIA Backend

Este backend forma parte del monorepo SACDIA.

## Fuente de verdad

- La documentación funcional/arquitectónica global vive en: `../../docs`.
- La documentación operativa local de este repo vive en:
  - `README.md`
  - `docs/README.md`
  - `docs/IMPLEMENTATION-SESSION-*.md`

## Qué revisar antes de implementar

1. Documentos relevantes en `../../docs` (features, API, DB, roadmap).
2. Contrato actual del backend en `README.md`.
3. Estado de implementación local en `docs/README.md`.

## Workflow recomendado

1. Confirmar contrato y rutas (`/api/v1/*`).
2. Implementar cambios en `sacdia-backend`.
3. Actualizar documentación local impactada.
4. Si hay impacto funcional global, sincronizar también en `../../docs`.

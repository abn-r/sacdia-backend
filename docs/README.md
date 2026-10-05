# Documentación local de `sacdia-backend`

Este directorio contiene documentación técnica local del backend: guías operativas, runbooks, decisiones de arquitectura y migraciones con contrato propio.

La documentación funcional oficial del producto vive en el workspace `sacdia`, en `../docs` respecto de este repo (API en `docs/api/ENDPOINTS-LIVE-REFERENCE.md`, base de datos en `docs/database/SCHEMA-REFERENCE.md`, features en `docs/features/`). Las bitácoras de sprint y los diseños ya implementados están archivados en `docs/history/` del workspace.

## Documentos vigentes

| Documento | Contenido |
| --- | --- |
| `../README.md` | Guía operativa: setup, scripts, variables de entorno, preflight de autorización P0 y checklist de release. |
| `BENCHMARKING.md` | Benchmark baseline, stress y spike con autocannon (`pnpm run benchmark:*`). |
| `architecture/FCM-STRATEGY.md` | Estrategia de notificaciones push con tokens directos y preferencias por categoría. |
| `architecture/db-i18n-translation-pattern.md` | Patrón Approach X para tablas `*_translations`. |
| `adr/ADR-0001-auth-session-compat-window.md` | Compatibilidad temporal de `refresh_token` (cutback pendiente). |
| `storage/r2-keyprefix-conventions.md` | Convenciones de key-prefix y URL pública de los buckets de Cloudflare R2. |
| `migrations/2026-07-30-durable-audit-logs.md` | Contrato de la expansión durable de `audit_logs`. |
| `migrations/2026-02-18-legacy-catalog-import.md` | Uso del script `pnpm import:legacy-catalogs`. |
| `runbooks/iana-timezone-trust-bootstrap.md` | Cadena de confianza de los artefactos IANA tzdb (`pnpm verify:iana-timezones`). |
| `runbooks/permission-scope-cleanup-phase-3.md` | Runbook de release para retirar permisos legacy (aplica al primer despliegue). |
| `runbooks/resend-setup.md` | Configuración de Resend para email transaccional. |
| `testing/e2e-debt.md` | Registro de deuda de pruebas e2e. |
| `security/security-best-practices-report.md` | Informe de seguridad del 2026-08-23 con tabla de estado de remediación. |
| `security/sacdia-backend-threat-model.md` | Modelo de amenazas del 2026-08-23 con estado de cada amenaza. |

Otros documentos locales:

- `../prisma/seeds/README.md`: orden y alcance de los seeds.
- `../src/common/guards/README.md`: modelo de guards globales y decoradores de autorización.

## Convención

1. Actualiza `../README.md` cuando cambie un script operativo, una variable de entorno o un requisito de setup.
2. Los contratos de endpoints se documentan en `docs/api/ENDPOINTS-LIVE-REFERENCE.md` del workspace, no aquí.
3. Si una decisión impacta producto o arquitectura global, sincronízala también en `../docs`.
4. Las bitácoras de sprint no se guardan en este repo; si tienen valor histórico van a `docs/history/` del workspace.

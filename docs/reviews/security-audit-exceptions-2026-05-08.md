# Security audit exceptions — 2026-05-08

**Estado**: ACTIVE

## `pnpm audit --audit-level=high`

Resultado observado: `pnpm audit --audit-level=high` falla por vulnerabilidades `high`/`critical`
en `next` a través de la cadena transitiva:

```text
sacdia-backend > better-auth > next
```

## Decisión temporal

Se documenta como excepción temporal de riesgo **no explotable en runtime backend actual**.

Justificación verificable:

- `sacdia-backend` es un runtime NestJS (`@nestjs/*`) y no levanta servidor Next.js.
- No hay imports runtime de `next`, `next/server`, `NextRequest` ni `NextResponse` en `src/`,
  `scripts/` o `test/`.
- Better Auth se usa como provider self-hosted de auth/sesiones; el subárbol `next` es transitivo
  de la librería y no forma parte del request path que sirve SACDIA Backend.

## Seguimiento requerido

- Mantener `pnpm audit --audit-level=high` como señal de CI/triage, aunque esta excepción sea
  aceptada temporalmente.
- Remover la excepción cuando Better Auth publique versión sin la dependencia vulnerable o con
  `next` actualizado.
- No usar adapters/rutas Next.js desde `sacdia-backend` sin reabrir este análisis.

# SACDIA Backend — AGENTS.md

Adaptador GGA para `sacdia-backend`.
La fuente de verdad operativa es `../AGENTS.md` cuando este repo se trabaja dentro del workspace `sacdia`.

## Orden obligatorio de lectura

1. `../AGENTS.md` si existe.
2. `./CLAUDE.md`.
3. `../docs/README.md`.
4. `../docs/steering/tech.md`.
5. `../docs/steering/coding-standards.md`.
6. `../docs/steering/data-guidelines.md`.
7. `../docs/api/ENDPOINTS-LIVE-REFERENCE.md`.
8. `../docs/api/SECURITY-GUIDE.md`.
9. `../docs/api/TESTING-GUIDE.md`.

Si el repo esta abierto aislado y `../AGENTS.md` no existe, usar este archivo como minimo operativo y pedir/recuperar el contexto del workspace antes de cambios transversales.

## Reglas backend

- API NestJS bajo `/api/v1/*`; no inventar endpoints ni DTOs sin validar contratos.
- Prisma efectivo: `prisma/schema.prisma`; la documentacion DB puede ser espejo subordinado.
- Seguridad primero: guards, roles, ownership y validacion de DTOs antes de logica feliz.
- No ejecutar build salvo pedido explicito del usuario.
- Si cambia endpoint, DTO, error, auth, permisos o schema, actualizar docs canonicas/API/DB en el mismo trabajo.


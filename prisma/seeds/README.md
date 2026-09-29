# Seeds

Orden obligatorio en base fresca:

1. `prisma/seed.ts` — crea filas de catálogo, **incluyendo roles**.
2. `prisma/seeds/permissions.seed.sql` — crea permisos.
3. `prisma/seeds/role-permissions.seed.sql` — asigna permisos a roles existentes.

El SQL de grants **no INSERTA roles**. Usa `INSERT … SELECT` contra `roles`. Si el rol no existe, el JOIN devuelve 0 filas y el grant es no-op.

No fusionar el SQL a TypeScript. No correr `prisma db seed` contra Neon desde este trabajo.

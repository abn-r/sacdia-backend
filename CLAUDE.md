# SACDIA Backend - API REST

NestJS API con Prisma, Supabase y PostgreSQL.

## Comandos

```bash
pnpm install           # Instalar dependencias
pnpm run start:dev     # Dev con hot-reload
pnpm run build         # Build producción
pnpm run start:prod    # Ejecutar build
pnpm test              # Tests unitarios
pnpm run test:e2e      # Tests E2E
pnpm run test:cov      # Coverage
pnpm run load-test     # Load test con autocannon
pnpm run generate:spec # Generar OpenAPI spec
```

## Estructura

```
src/
├── auth/              - Autenticación y RBAC
├── users/             - Gestión de usuarios
├── clubs/             - Clubes e instancias
├── classes/           - Clases progresivas
├── honors/            - Honores y especialidades
├── camporees/         - Campamentos
├── activities/        - Actividades de club
├── finances/          - Finanzas
├── inventory/         - Inventario
├── folders/           - Carpetas de evidencias
├── certifications/    - Certificaciones (Guías Mayores)
├── catalogs/          - Catálogos del sistema
├── notifications/     - Push notifications (FCM)
├── websockets/        - Gateway real-time
├── common/            - DTOs, guards, interceptors
└── prisma/            - Prisma config y schema
```

## Stack

- **Framework**: NestJS 11
- **Database**: PostgreSQL vía Supabase
- **ORM**: Prisma
- **Auth**: Supabase Auth + Passport JWT
- **Validation**: class-validator + class-transformer
- **NestJS 11** con TypeScript
- **Prisma** como ORM (67 tablas PostgreSQL)
- **Supabase** para Auth + Storage + DB
- **JWT** validation via Supabase
- **Helmet, Throttler** para seguridad
- **Upstash Redis** para cache distribuido
- **Firebase FCM** para push notifications
- **Sentry** para error monitoring

## Particularidades

- **RBAC**: Roles globales + roles de club
- **Versioning**: API v1 (URI) `/api/v1/`
- **Audit log**: `AuditInterceptor` registra todas las requests
- **Performance**: Load testing con `autocannon`
- **External Services**: Redis, FCM, Sentry integrados

## Variables de Entorno

```env
DATABASE_URL          # PostgreSQL via Supabase
SUPABASE_URL          # Auth + Storage
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_JWT_SECRET

# External Services
REDIS_URL             # Upstash Redis (opcional, fallback a in-memory)
FIREBASE_PROJECT_ID   # Para push notifications
FIREBASE_PRIVATE_KEY
FIREBASE_CLIENT_EMAIL
SENTRY_DSN            # Error monitoring (opcional)
```

## Testing

```bash
# E2E tests requieren DB de test
pnpm run test:e2e

# Ver coverage
pnpm run test:cov
```

## Performance

- **AuditInterceptor**: Logs automáticos con response time
- **Load Testing**: `pnpm run load-test` para benchmarks
- **Metrics**: Ver logs para duración de requests

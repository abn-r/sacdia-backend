<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ pnpm install
```

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Comandos Principales

```bash
# Desarrollo
pnpm run start:dev

# Build
pnpm run build

# Tests
pnpm run test
pnpm run test:e2e

# Database
npx prisma generate      # Regenerar cliente
npx prisma migrate dev   # Aplicar migraciones
npx prisma studio        # UI de base de datos
npx prisma db seed       # Seed inicial

# Load Testing
pnpm run load-test       # Probar rendimiento
```

---

## External Services

### Upstash Redis

Cache distribuido para:

- Token blacklist (logout, revocación)
- Session management (límites concurrentes)
- MFA temporal codes

**Setup**:

1. Crear database en [upstash.com](https://upstash.com)
2. Agregar `REDIS_URL` a `.env`
3. El sistema usará Redis automáticamente (fallback a in-memory si no está configurado)

### Firebase FCM (Push Notifications)

**Setup**:

1. Crear proyecto en [Firebase Console](https://console.firebase.google.com)
2. Descargar service account JSON (Project Settings > Service Accounts)
3. Agregar credenciales a `.env`:
   ```env
   FIREBASE_PROJECT_ID="..."
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   FIREBASE_CLIENT_EMAIL="..."
   ```

**Endpoints**:

- `POST /fcm-tokens` - Registrar token de dispositivo
- `POST /notifications/send` - Enviar a usuario
- `POST /notifications/broadcast` - Enviar a todos
- `POST /notifications/club/:type/:id` - Enviar a club

### Sentry (Error Monitoring)

**Setup**:

1. Crear proyecto en [sentry.io](https://sentry.io)
2. Copiar DSN
3. Agregar a `.env`:
   ```env
   SENTRY_DSN="https://...@....ingest.sentry.io/..."
   ```

Sentry capturará automáticamente todos los errores no manejados.

---

### OAuth Authentication (Google & Apple)

**Setup**:

OAuth ya está implementado en el backend. Solo necesitas configurar los providers en Supabase:

#### Google OAuth

1. Ir a [Google Cloud Console](https://console.cloud.google.com/)
2. Crear OAuth 2.0 Client ID
3. Agregar redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
4. Copiar Client ID y Secret a Supabase Dashboard → Authentication → Providers → Google

#### Apple Sign In

1. Ir a [Apple Developer](https://developer.apple.com/account/)
2. Crear Service ID y configurar Sign in with Apple
3. Generar private key (.p8 file)
4. Agregar a Supabase: Service ID, Team ID, Key ID, Private Key

**Endpoints**:

- `POST /auth/oauth/google` - Iniciar flujo Google
- `POST /auth/oauth/apple` - Iniciar flujo Apple
- `GET /auth/oauth/callback` - Manejar callback (auto-crea usuarios)
- `GET /auth/oauth/providers` - Ver providers conectados (auth required)
- `DELETE /auth/oauth/:provider` - Desconectar provider (auth required)

**Features**:

- ✅ Auto-creación de usuarios en primera auth
- ✅ Tracking de providers en BD (`google_connected`, `apple_connected`)
- ✅ Flag `needsPostRegistration` para nuevos usuarios
- ✅ Integración con Supabase Auth

---

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Performance Testing

Use `autocannon` to load test your API endpoints and measure performance metrics:

```bash
# Test default health endpoint
$ pnpm run load-test

# Test specific endpoint
$ pnpm run load-test /api/camporees

# Test with custom URL
$ URL=https://your-staging.com pnpm run load-test /api/users
```

### Key Metrics

The load test reports the following metrics:

- **Throughput**: Data transferred per second
- **Req/sec**: Number of requests per second (average and max)
- **Latency**: Response time at p50 (median), p99, and max
- **Errors/Timeouts**: Failed requests

### Performance Benchmarks

- **Excellent**: >1000 req/s, <100ms p99 latency
- **Good**: 500-1000 req/s, 100-500ms p99 latency
- **Needs Optimization**: <100 req/s or >1000ms p99 latency

### Monitoring Response Times

All requests are automatically logged with duration metrics via `AuditInterceptor`. Check your logs for real-time performance insights.

````

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ pnpm install -g @nestjs/mau
$ mau deploy
````

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

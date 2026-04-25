// Must be the first import: populates process.env from .env BEFORE any
// @Module decorator body or top-level module code runs. Without this, all
// isRedisConfigured() / buildBullRootConfig() checks execute at file-load
// time with an empty process.env, causing BullMQ queue registration to be
// skipped even when REDIS_URL is present in .env.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import compression from 'compression';
import * as Sentry from '@sentry/node';
import { AppModule } from './app.module';
import { timeoutMiddleware } from './common/middleware/timeout.middleware';
import { SanitizePipe } from './common/pipes/sanitize.pipe';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { SentryInterceptor } from './common/interceptors/sentry.interceptor';
// NOTE: HttpExceptionFilter and AllExceptionsFilter are registered via APP_FILTER
// in CommonModule so they receive I18nService via DI. Do NOT use useGlobalFilters()
// here — that would instantiate them without injection and break i18n.

// ==========================================
// PROCESS-LEVEL SAFETY NET
// Prevents unhandled Redis / BullMQ 'error' events from killing the process.
// Individual modules should handle errors themselves (see NotificationsProcessor),
// but this guard catches anything that slips through.
// ==========================================
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled promise rejection at:', promise, 'reason:', reason);
  // Do NOT call process.exit() — let the app keep running unless it's truly fatal.
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message, err.stack);
  // Only exit on truly unrecoverable errors (not Redis blips).
  if (err.message?.includes('ENOMEM') || err.message?.includes('ENOSPC')) {
    process.exit(1);
  }
});

async function bootstrap() {
  // ==========================================
  // SENTRY - Error Monitoring
  // ==========================================
  let sentryEnabled = false;
  if (process.env.SENTRY_DSN) {
    const SENSITIVE_HEADERS = new Set([
      'authorization',
      'x-session-token',
      'x-refresh-token',
      'x-bootstrap-secret',
    ]);
    const SENSITIVE_BODY_FIELDS = new Set([
      'password',
      'refresh_token',
      'refreshToken',
      'access_token',
      'accessToken',
      'blood',
      'birthday',
      'allergies',
      'diseases',
      'medicines',
    ]);

    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      release:
        process.env.SENTRY_RELEASE ||
        process.env.RENDER_GIT_COMMIT ||
        undefined,
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      beforeSend(event) {
        // Strip sensitive request headers
        if (event.request?.headers) {
          const cleaned: Record<string, string> = {};
          for (const [key, value] of Object.entries(event.request.headers)) {
            cleaned[key] = SENSITIVE_HEADERS.has(key.toLowerCase())
              ? '[REDACTED]'
              : value;
          }
          event.request.headers = cleaned;
        }

        // Strip sensitive request body fields
        if (event.request?.data && typeof event.request.data === 'object') {
          const body = event.request.data as Record<string, unknown>;
          for (const field of SENSITIVE_BODY_FIELDS) {
            if (field in body) {
              body[field] = '[REDACTED]';
            }
          }
        }

        // Strip sensitive query string parameters
        if (event.request?.url) {
          try {
            const url = new URL(event.request.url, 'http://localhost');
            const sensitiveParams = [
              'password',
              'token',
              'secret',
              'authorization',
              'refreshtoken',
              'refresh_token',
            ];
            for (const param of sensitiveParams) {
              if (url.searchParams.has(param)) {
                url.searchParams.set(param, '[REDACTED]');
              }
            }
            event.request.url = url.pathname + url.search;
          } catch {
            // URL parsing failed — use original path
          }
        }

        return event;
      },
    });
    sentryEnabled = true;
    console.log('✅ Sentry monitoring initialized');
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  // ==========================================
  // TRUST PROXY — Client IP detection behind reverse proxies
  // ==========================================
  // Must be set BEFORE any middleware that reads the client IP (helmet, throttler, etc.)
  // Without this, ThrottlerGuard sees the proxy IP for all requests, making per-IP rate
  // limiting completely ineffective when running behind Vercel / nginx / load balancers.
  // Value 1 means: trust exactly one hop (the immediate upstream proxy).
  app.set('trust proxy', 1);

  // ==========================================
  // SEGURIDAD - Helmet (Security Headers)
  // ==========================================
  const isDevelopment = process.env.NODE_ENV !== 'production';

  app.use(
    helmet({
      // Development: disable CSP entirely so Swagger UI works
      // Production: strict CSP — no 'unsafe-inline', no CDN sources (Swagger is disabled)
      contentSecurityPolicy: isDevelopment
        ? false
        : {
            directives: {
              defaultSrc: ["'self'"],
              styleSrc: ["'self'"],
              scriptSrc: ["'self'"],
              imgSrc: ["'self'", 'data:', 'https:'],
              fontSrc: ["'self'"],
            },
          },
      // crossOriginEmbedderPolicy disabled intentionally: the mobile app and admin panel
      // load assets (profile pictures, evidence files, PDF resources) from Cloudflare R2
      // and other cross-origin CDN sources. COEP requires all cross-origin resources to
      // opt in via CORP/COEP headers, which third-party storage buckets do not set by
      // default. Enabling this would break image rendering across the entire application.
      // Re-evaluate if all CDN/storage resources are brought under the same origin.
      crossOriginEmbedderPolicy: false,
      hsts: isDevelopment
        ? false
        : {
            maxAge: 31536000,
            includeSubDomains: true,
          },
    }),
  );

  // ==========================================
  // PERFORMANCE - Compression
  // ==========================================
  app.use(compression());

  // ==========================================
  // SEGURIDAD - Request Timeout
  // ==========================================
  app.use(timeoutMiddleware);

  // ==========================================
  // SEGURIDAD - Request Size Limits
  // ==========================================
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '10mb' });
  // Multipart/form-data size limits live in AppModule via MulterModule.register().
  // Do NOT add a raw body parser for multipart here — it consumes the stream
  // before Multer can parse boundaries, causing "Unexpected end of form" 400s.

  // ==========================================
  // CORS
  // ==========================================
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:5173',
    'http://localhost:3000',
  ];

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests without an Origin header (health checks, server-to-server,
      // curl, mobile clients). CORS is a browser-only mechanism — non-browser
      // requests never send Origin, so blocking them here only breaks health
      // checks and legitimate API consumers. Auth is enforced by JWT guards.
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 3600,
  });

  // ==========================================
  // VALIDACIÓN - Global Pipes
  // ==========================================
  app.useGlobalPipes(
    new SanitizePipe(), // XSS Sanitization
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // ==========================================
  // SEGURIDAD - Global Filters (Exception Handling)
  // ==========================================
  // Filters are registered via APP_FILTER providers in CommonModule so that
  // I18nService can be injected via NestJS DI. The specificity guarantee
  // (@Catch(HttpException) > @Catch()) ensures HttpExceptionFilter handles
  // all HttpException subclasses (including AppException) before AllExceptionsFilter.
  // DO NOT call app.useGlobalFilters() here — it bypasses DI and breaks i18n injection.

  // ==========================================
  // AUDITORÍA - Global Interceptors
  // ==========================================
  app.useGlobalInterceptors(
    new AuditInterceptor(),
    ...(sentryEnabled ? [new SentryInterceptor()] : []),
  );

  // ==========================================
  // API Prefix + Versioning (URI-based)
  // ==========================================
  // Prefijo global: /api
  app.setGlobalPrefix('api');

  // Versionado URI: /api/v1, /api/v2, etc.
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
  // Resultado final: /api/v1/*

  // ==========================================
  // SWAGGER — opt-in via SWAGGER_ENABLED=true
  // ==========================================
  if (process.env.SWAGGER_ENABLED === 'true') {
    const config = new DocumentBuilder()
      .setTitle('SACDIA API')
      .setDescription(
        `## Sistema de Administración de Clubes de Conquistadores y Aventureros

### Módulos Disponibles
- **Auth**: Autenticación con Supabase + JWT
- **Users**: Gestión de perfiles de usuario
- **Catalogs**: Catálogos de referencia (países, iglesias, roles, etc.)
- **Clubs**: Gestión de clubes e instancias (Aventureros, Conquistadores, GM)
- **Classes**: Clases progresivas y seguimiento de progreso
- **Honors**: Especialidades y honores
- **Activities**: Actividades de club y asistencia
- **Finances**: Control financiero

### Autenticación
Todos los endpoints protegidos requieren Bearer Token (JWT de Supabase).

### Paginación
Los endpoints de listado soportan: \`?page=1&limit=20\`
`,
      )
      .setVersion('2.2.0')
      .setContact('SACDIA Team', 'https://sacdia.app', 'dev@sacdia.app')
      .setLicense('Proprietary', '')
      .addBearerAuth()
      .addTag('auth', 'Autenticación y registro')
      .addTag('users', 'Gestión de usuarios')
      .addTag('emergency-contacts', 'Contactos de emergencia')
      .addTag('legal-representatives', 'Representantes legales')
      .addTag('post-registration', 'Post-registro y onboarding')
      .addTag('catalogs', 'Catálogos de referencia')
      .addTag('clubs', 'Gestión de clubes')
      .addTag('classes', 'Clases progresivas')
      .addTag('honors', 'Catálogo de honores/especialidades')
      .addTag('user-honors', 'Progreso de honores por usuario')
      .addTag('activities', 'Actividades de club')
      .addTag('finances', 'Control financiero')
      .addTag('notifications', 'Push notifications vía Firebase FCM')
      .addTag('fcm-tokens', 'Gestión de tokens FCM de dispositivos')
      .addTag('admin-geography', 'CRUD admin de jerarquía geográfica')
      .addTag('admin-reference', 'CRUD admin de catálogos de referencia')
      .addTag(
        'admin-users',
        'Gestión admin de usuarios con alcance territorial',
      )
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document, {
      swaggerOptions: {
        docExpansion: 'none',
        filter: true,
        showRequestDuration: true,
      },
    });
  }

  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port, '0.0.0.0');

  console.log(`\n🚀 Server running on: http://localhost:${port}`);
  if (process.env.SWAGGER_ENABLED === 'true') {
    console.log(`📖 Swagger docs on: http://localhost:${port}/api`);
  }
  console.log(`✅ API Version: v1 (default)`);
  console.log(`📍 Base URL: http://localhost:${port}/api/v1`);
  console.log(`🔒 Security: Helmet, Rate Limiting, Compression enabled`);
}
bootstrap().catch(console.error);

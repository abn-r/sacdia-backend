import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import compression from 'compression';
import * as Sentry from '@sentry/node';
import { AppModule } from './app.module';
import { SanitizePipe } from './common/pipes/sanitize.pipe';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { SentryInterceptor } from './common/interceptors/sentry.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

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
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      beforeSend(event) {
        // Strip sensitive request headers
        if (event.request?.headers) {
          const cleaned: Record<string, string> = {};
          for (const [key, value] of Object.entries(event.request.headers)) {
            cleaned[key] = SENSITIVE_HEADERS.has(key.toLowerCase())
              ? '[REDACTED]'
              : (value as string);
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
  // SEGURIDAD - Helmet (Security Headers)
  // ==========================================
  const isDevelopment = process.env.NODE_ENV !== 'production';

  app.use(
    helmet({
      // Deshabilitar CSP en desarrollo para que Swagger UI funcione
      contentSecurityPolicy: isDevelopment
        ? false
        : {
            directives: {
              defaultSrc: ["'self'"],
              styleSrc: [
                "'self'",
                "'unsafe-inline'",
                'https://cdn.jsdelivr.net',
              ],
              scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                'https://cdn.jsdelivr.net',
              ],
              imgSrc: ["'self'", 'data:', 'https:'],
              fontSrc: ["'self'", 'https://cdn.jsdelivr.net'],
            },
          },
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
  // SEGURIDAD - Request Size Limits
  // ==========================================
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '10mb' });

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
  app.useGlobalFilters(
    new AllExceptionsFilter(), // Catch-all para errores no manejados
    new HttpExceptionFilter(), // HTTP exceptions con logs seguros
  );

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
  // SWAGGER — solo disponible fuera de producción
  // ==========================================
  if (process.env.NODE_ENV !== 'production') {
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
      .addTag('admin-users', 'Gestión admin de usuarios con alcance territorial')
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
  if (process.env.NODE_ENV !== 'production') {
    console.log(`📖 Swagger docs on: http://localhost:${port}/api`);
  }
  console.log(`✅ API Version: v1 (default)`);
  console.log(`📍 Base URL: http://localhost:${port}/api/v1`);
  console.log(`🔒 Security: Helmet, Rate Limiting, Compression enabled`);
}
bootstrap();

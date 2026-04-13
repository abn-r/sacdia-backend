import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { MulterModule } from '@nestjs/platform-express';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { EmergencyContactsModule } from './emergency-contacts/emergency-contacts.module';
import { LegalRepresentativesModule } from './legal-representatives/legal-representatives.module';
import { PostRegistrationModule } from './post-registration/post-registration.module';
import { CatalogsModule } from './catalogs/catalogs.module';
import { ClubsModule } from './clubs/clubs.module';
import { ClassesModule } from './classes/classes.module';
import { HonorsModule } from './honors/honors.module';
import { ActivitiesModule } from './activities/activities.module';
import { FinancesModule } from './finances/finances.module';
import { CamporeesModule } from './camporees/camporees.module';
import { NotificationsModule } from './notifications/notifications.module';
import { CertificationsModule } from './certifications/certifications.module';
import { FoldersModule } from './folders/folders.module';
import { InventoryModule } from './inventory/inventory.module';
import { RbacModule } from './rbac/rbac.module';
import { HealthController } from './health/health.controller';
import { AdminModule } from './admin/admin.module';
import { InsuranceModule } from './insurance/insurance.module';
import { InvestitureModule } from './investiture/investiture.module';
import { UnitsModule } from './units/units.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ClubEnrollmentsModule } from './club-enrollments/club-enrollments.module';
import { ValidationModule } from './validation/validation.module';
import { AnnualFoldersModule } from './annual-folders/annual-folders.module';
import { MonthlyReportsModule } from './monthly-reports/monthly-reports.module';
import { RequestsModule } from './requests/requests.module';
import { SystemConfigModule } from './system-config/system-config.module';
import { YearEndModule } from './year-end/year-end.module';
import { MembershipRequestsModule } from './membership-requests/membership-requests.module';
import { ResourcesModule } from './resources/resources.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { EvidenceReviewModule } from './evidence-review/evidence-review.module';
import { ScoringCategoriesModule } from './scoring-categories/scoring-categories.module';
import { MemberOfMonthModule } from './member-of-month/member-of-month.module';
import { envValidationSchema } from './config/env.validation';
import { buildBullRootConfig } from './config/bullmq.config';

@Module({
  imports: [
    // ==========================================
    // CONFIGURACIÓN
    // ==========================================
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),

    // ==========================================
    // QUEUE - BullMQ (async notifications)
    // Registered only when REDIS_URL is valid.
    // ==========================================
    ...buildBullRootConfig(),

    // ==========================================
    // SCHEDULING - Cron jobs
    // ==========================================
    ScheduleModule.forRoot(),

    // ==========================================
    // LOGGING - Pino (pretty en desarrollo, JSON en producción)
    // ==========================================
    LoggerModule.forRoot({
      forRoutes: [{ path: '/{*path}', method: RequestMethod.ALL }],
      pinoHttp: {
        level:
          process.env.LOG_LEVEL ||
          (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        autoLogging: false,
        quietReqLogger: true,
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.refreshToken',
            'requestBody.password',
            'requestBody.refreshToken',
            'req.body.birthday',
            'req.body.blood',
            'req.body.allergies',
            'req.body.diseases',
            'req.body.medicines',
          ],
          remove: true,
        },
        ...(process.env.NODE_ENV !== 'production' ||
        process.env.LOG_PRETTY === 'true'
          ? {
              transport: {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  translateTime: 'SYS:standard',
                  ignore:
                    process.env.LOG_PRETTY_IGNORE ||
                    'pid,hostname,req,res,responseTime,reqId,timestamp,ip',
                  singleLine: true,
                },
              },
            }
          : {}),
      },
    }),

    // ==========================================
    // SEGURIDAD - Rate Limiting
    // ==========================================
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000, // 1 segundo
        limit: 3, // 3 requests por segundo
      },
      {
        name: 'medium',
        ttl: 10000, // 10 segundos
        limit: 20, // 20 requests por 10 segundos
      },
      {
        name: 'long',
        ttl: 60000, // 1 minuto
        limit: 100, // 100 requests por minuto
      },
    ]),

    // ==========================================
    // MULTIPART UPLOADS - Global Multer limits
    // ==========================================
    // Safety net for every FileInterceptor in the app: caps uploads at 10 MB.
    // Individual endpoints can still tighten this via their own FileInterceptor
    // options. Configured here (not via app.useBodyParser in main.ts) so Multer
    // parses the multipart stream itself — a raw body parser would consume the
    // stream first and break boundary detection.
    MulterModule.register({
      limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB
      },
    }),

    // ==========================================
    // MÓDULOS DE APLICACIÓN
    // ==========================================
    PrismaModule,
    CommonModule,
    AuthModule,
    UsersModule,
    EmergencyContactsModule,
    LegalRepresentativesModule,
    PostRegistrationModule,
    CatalogsModule,
    ClubsModule,
    ClassesModule,
    HonorsModule,
    ActivitiesModule,
    FinancesModule,
    CamporeesModule,
    NotificationsModule,
    CertificationsModule,
    FoldersModule,
    InventoryModule,
    RbacModule,
    AdminModule,
    InsuranceModule,
    InvestitureModule,
    UnitsModule,
    DashboardModule,
    ClubEnrollmentsModule,
    ValidationModule,
    AnnualFoldersModule,
    MonthlyReportsModule,
    RequestsModule,
    SystemConfigModule,
    YearEndModule,
    MembershipRequestsModule,
    ResourcesModule,
    AnalyticsModule,
    EvidenceReviewModule,
    ScoringCategoriesModule,
    MemberOfMonthModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    // ==========================================
    // GUARD GLOBAL - Rate Limiting
    // ==========================================
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

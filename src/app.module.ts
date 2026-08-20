import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { I18nModule, AcceptLanguageResolver, QueryResolver } from 'nestjs-i18n';
import { resolveI18nDir } from './i18n/resolve-i18n-dir';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { MulterModule } from '@nestjs/platform-express';
import { LoggerModule } from 'nestjs-pino';
import { JwtModule } from '@nestjs/jwt';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
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
import { InventoryModule } from './inventory/inventory.module';
import { RbacModule } from './rbac/rbac.module';
import { HealthController } from './health/health.controller';
import { AdminModule } from './admin/admin.module';
import { InsuranceModule } from './insurance/insurance.module';
import { FieldPaymentOrdersModule } from './field-payment-orders/field-payment-orders.module';
import { InvestitureModule } from './investiture/investiture.module';
import { UnitsModule } from './units/units.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ClubEnrollmentsModule } from './club-enrollments/club-enrollments.module';
import { ValidationModule } from './validation/validation.module';
import { AnnualFoldersModule } from './annual-folders/annual-folders.module';
import { MonthlyReportsModule } from './monthly-reports/monthly-reports.module';
import { QuarterlyReportsModule } from './quarterly-reports/quarterly-reports.module';
import { AnnualReportsModule } from './annual-reports/annual-reports.module';
import { RequestsModule } from './requests/requests.module';
import { SystemConfigModule } from './system-config/system-config.module';
import { YearEndModule } from './year-end/year-end.module';
import { MembershipRequestsModule } from './membership-requests/membership-requests.module';
import { ResourcesModule } from './resources/resources.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { EvidenceReviewModule } from './evidence-review/evidence-review.module';
import { ScoringCategoriesModule } from './scoring-categories/scoring-categories.module';
import { MemberOfMonthModule } from './member-of-month/member-of-month.module';
import { AchievementsModule } from './achievements/achievements.module';
import { DataExportModule } from './data-export/data-export.module';
import { EmailModule } from './common/email/email.module';
import { QrModule } from './qr/qr.module';
import { SupportModule } from './support/support.module';
import { BackgroundJobsModule } from './background-jobs/background-jobs.module';
import { RankingWeightsModule } from './ranking-weights/ranking-weights.module';
import { AnnualRankingProgressModule } from './rankings/annual-ranking-progress/annual-ranking-progress.module';
import { MaterialsModule } from './materials/materials.module';
import { CertificateBulkImportsModule } from './certificate-bulk-imports/certificate-bulk-imports.module';
import { CamporeeEventTemplatesModule } from './camporee-event-templates/camporee-event-templates.module';
import { CamporeeEventsModule } from './camporee-events/camporee-events.module';
import { CamporeeVenuesModule } from './camporee-venues/camporee-venues.module';
import { CamporeeScoringModule } from './camporee-scoring/camporee-scoring.module';
import { CamporeeStaffModule } from './camporee-staff/camporee-staff.module';
import { CoordinationModule } from './coordination/coordination.module';
import { envValidationSchema } from './config/env.validation';
import { buildBullRootConfig } from './config/bullmq.config';
import { buildThrottlerOptions } from './config/throttler.config';
import { UserAwareThrottlerGuard } from './config/user-aware-throttler.guard';
import { GlobalJwtAuthGuard } from './common/guards/global-jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';

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
    // INTERNACIONALIZACIÓN - nestjs-i18n
    // Resolver order: ?lang= query param → Accept-Language header → fallback 'es'
    // Supported locales: es, pt-BR, en, fr
    // ==========================================
    I18nModule.forRoot({
      fallbackLanguage: 'es',
      loaderOptions: {
        // Prefer src/i18n when present: nest --watch can truncate dist/i18n JSON
        // mid-copy (empty errors.json → I18nError). Production uses dist/.
        path: resolveI18nDir(),
        // nestjs-i18n file watch re-parses on FS events and throws I18nError if
        // a copy is mid-truncate. Translations are not hot-reloaded in this app.
        watch: false,
      },
      resolvers: [
        { use: QueryResolver, options: ['lang'] },
        AcceptLanguageResolver,
      ],
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
        ...(process.env.NODE_ENV !== 'test' &&
        (process.env.NODE_ENV !== 'production' ||
          process.env.LOG_PRETTY === 'true')
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
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('BETTER_AUTH_SECRET'),
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: buildThrottlerOptions,
    }),

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
    // Registers HttpAuditInterceptor globally via APP_INTERCEPTOR.
    AuditLogsModule,
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
    InventoryModule,
    RbacModule,
    AdminModule,
    InsuranceModule,
    FieldPaymentOrdersModule,
    InvestitureModule,
    UnitsModule,
    DashboardModule,
    ClubEnrollmentsModule,
    ValidationModule,
    AnnualFoldersModule,
    MonthlyReportsModule,
    QuarterlyReportsModule,
    AnnualReportsModule,
    RequestsModule,
    SystemConfigModule,
    YearEndModule,
    MembershipRequestsModule,
    ResourcesModule,
    AnalyticsModule,
    EvidenceReviewModule,
    ScoringCategoriesModule,
    MemberOfMonthModule,
    AchievementsModule,
    DataExportModule,
    EmailModule,
    QrModule,
    SupportModule,
    BackgroundJobsModule,
    RankingWeightsModule,
    AnnualRankingProgressModule,
    MaterialsModule,
    CertificateBulkImportsModule,
    CamporeeEventTemplatesModule,
    CamporeeEventsModule,
    CamporeeVenuesModule,
    CamporeeScoringModule,
    CamporeeStaffModule,
    CoordinationModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    // ==========================================
    // GUARD GLOBAL - Rate Limiting
    // ==========================================
    {
      provide: APP_GUARD,
      useClass: UserAwareThrottlerGuard,
    },
    // ==========================================
    // GUARD GLOBAL - Autenticación JWT
    // ==========================================
    // Deny-by-default: todo endpoint requiere JWT salvo que esté marcado
    // con @Public() (login, health ping, catálogos con OptionalJwtAuthGuard,
    // bootstrap RBAC). Un @UseGuards olvidado ya no expone el endpoint.
    {
      provide: APP_GUARD,
      useClass: GlobalJwtAuthGuard,
    },
    // Deny-by-default permissions: JWT-only is not enough unless the route
    // declares @RequirePermissions, @SkipPermissions or @Public().
    // useExisting so e2e `.overrideGuard(PermissionsGuard)` replaces this
    // APP_GUARD instead of leaving a second useClass instance.
    {
      provide: APP_GUARD,
      useExisting: PermissionsGuard,
    },
  ],
})
export class AppModule {}

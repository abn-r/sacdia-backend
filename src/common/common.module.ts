import { Module, Global } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthorizationContextService } from './services/authorization-context.service';
import { TokenBlacklistService } from './services/token-blacklist.service';
import { SessionManagementService } from './services/session-management.service';
import { MfaService } from './services/mfa.service';
import { CleanupService } from './services/cleanup.service';
import { PermissionsGuard } from './guards/permissions.guard';
import { R2FileStorageService } from './services/r2-file-storage.service';
import { FILE_STORAGE_SERVICE } from './services/file-storage.service';
import { BetterAuthModule } from '../better-auth/better-auth.module';
import { DistributedLockService } from './services/distributed-lock.service';
import { CronRunLogger } from './services/cron-run-logger.service';
import { TranslationService } from './services/translation.service';
import { InstitutionalHierarchyService } from './services/institutional-hierarchy.service';
import { CronAlertService } from './services/cron-alert.service';
import { ClassAssignmentResolverService } from './services/class-assignment-resolver.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { buildCacheOptions } from '../config/cache.config';
import { CLOCK } from './clock/clock';
import { SystemClockService } from './clock/system-clock.service';
import { ZonedBusinessTimeService } from './clock/zoned-business-time.service';
import { TemporalContextFactory } from './clock/temporal-context.factory';
import { LocalFieldTimezoneResolver } from './authorization/local-field-timezone.resolver';
import { ClubAssignmentEffectivityPolicy } from './authorization/club-assignment-effectivity.policy';

@Global()
@Module({
  imports: [
    // ==========================================
    // CACHE - Para Token Blacklist y Sessions
    // ==========================================
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: buildCacheOptions,
    }),
    // BetterAuthModule provides BetterAuthService (used by MfaService for TOTP operations).
    BetterAuthModule,
    // NotificationsModule provides NotificationsService (used by CronAlertService for in-app alerts).
    NotificationsModule,
  ],
  providers: [
    // ==========================================
    // SERVICIOS DE SEGURIDAD
    // ==========================================
    TokenBlacklistService,
    SessionManagementService,
    MfaService,
    AuthorizationContextService,
    InstitutionalHierarchyService,
    PermissionsGuard,
    R2FileStorageService,
    {
      provide: FILE_STORAGE_SERVICE,
      useExisting: R2FileStorageService,
    },
    // ==========================================
    // INFRAESTRUCTURA DISTRIBUIDA
    // ==========================================
    DistributedLockService,
    // ==========================================
    // MANTENIMIENTO - Limpieza de registros expirados
    // ==========================================
    CleanupService,
    // ==========================================
    // OBSERVABILIDAD - Logging de ejecución de crons
    // ==========================================
    CronRunLogger,
    // ==========================================
    // MONITORING - Automated cron job alerting
    // ==========================================
    CronAlertService,
    // ==========================================
    // I18N — Pilot translation helper (Approach X)
    // ==========================================
    TranslationService,
    ClassAssignmentResolverService,
    SystemClockService,
    { provide: CLOCK, useExisting: SystemClockService },
    ZonedBusinessTimeService,
    TemporalContextFactory,
    LocalFieldTimezoneResolver,
    ClubAssignmentEffectivityPolicy,
    // ==========================================
    // EXCEPTION FILTERS — registered via DI so I18nService can be injected.
    // Order: AllExceptionsFilter registered FIRST (lower priority),
    // HttpExceptionFilter registered SECOND (higher priority for @Catch(HttpException)).
    // NestJS routes by specificity: @Catch(HttpException) wins over @Catch() for
    // HttpException subclasses, preserving the original filter contract.
    // ==========================================
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
  exports: [
    CacheModule,
    TokenBlacklistService,
    SessionManagementService,
    MfaService,
    AuthorizationContextService,
    InstitutionalHierarchyService,
    PermissionsGuard,
    FILE_STORAGE_SERVICE,
    DistributedLockService,
    CronRunLogger,
    TranslationService,
    ClassAssignmentResolverService,
    CLOCK,
    ZonedBusinessTimeService,
    TemporalContextFactory,
    LocalFieldTimezoneResolver,
    ClubAssignmentEffectivityPolicy,
  ],
})
export class CommonModule {}

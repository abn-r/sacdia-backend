import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogsModule } from '../catalogs/catalogs.module';
import { BetterAuthModule } from '../better-auth/better-auth.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminCamporeeEventTypesController } from './admin-camporee-event-types.controller';
import { AdminGeographyController } from './admin-geography.controller';
import { AdminNotificationsController } from './admin-notifications.controller';
import { AdminReferenceController } from './admin-reference.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminPhaseECatalogsController } from './admin-phase-e-catalogs.controller';
import { AdminCronAlertsController } from './admin-cron-alerts.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminCamporeeEventTypesService } from './admin-camporee-event-types.service';
import { AdminGeographyService } from './admin-geography.service';
import { AdminNotificationsService } from './admin-notifications.service';
import { AdminReferenceService } from './admin-reference.service';
import { AdminUsersService } from './admin-users.service';
import { AdminPhaseECatalogsService } from './admin-phase-e-catalogs.service';
import { AdminCronAlertsService } from './admin-cron-alerts.service';
import { MasterHonorsQueueModule } from '../honors/master-honors-queue.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CoordinationModule } from '../coordination/coordination.module';

@Module({
  imports: [
    PrismaModule,
    // CatalogsModule exports CatalogCacheService — needed for cache
    // invalidation in AdminGeographyService and AdminReferenceService.
    CatalogsModule,
    // BetterAuthModule exports BetterAuthService — needed by AdminAuthService
    // for password updates (updatePasswordById) and MFA status checks (hasTotpEnabled).
    BetterAuthModule,
    // Note: TranslationService is provided by the global CommonModule (app.module.ts)
    // — no explicit import needed here.
    MasterHonorsQueueModule,
    NotificationsModule,
    CoordinationModule,
  ],
  controllers: [
    AdminAuthController,
    AdminCamporeeEventTypesController,
    AdminGeographyController,
    AdminNotificationsController,
    AdminReferenceController,
    AdminUsersController,
    AdminPhaseECatalogsController,
    AdminCronAlertsController,
  ],
  providers: [
    AdminAuthService,
    AdminCamporeeEventTypesService,
    AdminGeographyService,
    AdminNotificationsService,
    AdminReferenceService,
    AdminUsersService,
    AdminPhaseECatalogsService,
    AdminCronAlertsService,
  ],
})
export class AdminModule {}

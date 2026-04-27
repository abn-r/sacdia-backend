import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogsModule } from '../catalogs/catalogs.module';
import { BetterAuthModule } from '../better-auth/better-auth.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminGeographyController } from './admin-geography.controller';
import { AdminNotificationsController } from './admin-notifications.controller';
import { AdminReferenceController } from './admin-reference.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminPhaseECatalogsController } from './admin-phase-e-catalogs.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminGeographyService } from './admin-geography.service';
import { AdminNotificationsService } from './admin-notifications.service';
import { AdminReferenceService } from './admin-reference.service';
import { AdminUsersService } from './admin-users.service';
import { AdminPhaseECatalogsService } from './admin-phase-e-catalogs.service';

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
  ],
  controllers: [
    AdminAuthController,
    AdminGeographyController,
    AdminNotificationsController,
    AdminReferenceController,
    AdminUsersController,
    AdminPhaseECatalogsController,
  ],
  providers: [
    AdminAuthService,
    AdminGeographyService,
    AdminNotificationsService,
    AdminReferenceService,
    AdminUsersService,
    AdminPhaseECatalogsService,
  ],
})
export class AdminModule {}

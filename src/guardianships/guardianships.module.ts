import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ActingForModule } from '../auth/acting-for/acting-for.module';
import { LegalModule } from '../legal/legal.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DependentClaimCodesController } from './dependent-claim-codes.controller';
import { DependentProfilesPurgeCronService } from './dependent-profiles-purge-cron.service';
import { FamilyFeatureFlagsService } from './family-feature-flags.service';
import { GuardianEvidenceService } from './guardian-evidence.service';
import { GuardianNotificationsService } from './guardian-notifications.service';
import { GuardianshipLifecycleService } from './guardianship-lifecycle.service';
import { GuardianshipsController } from './guardianships.controller';
import { GuardianshipsService } from './guardianships.service';
import { LinkCodeFailureCounter } from './link-code-failure-counter';
import { LinkCodesService } from './link-codes.service';
import { SupervisionStateService } from './supervision-state.service';

/**
 * Dependents (minors without an account), their guardianships, second-guardian
 * invitations and the detach logic shared with account deletion.
 * CountryAgePolicyService (CommonModule) and CACHE_MANAGER are global.
 */
@Module({
  imports: [
    PrismaModule,
    ActingForModule,
    AuditLogsModule,
    LegalModule,
    NotificationsModule,
  ],
  controllers: [GuardianshipsController, DependentClaimCodesController],
  providers: [
    GuardianshipsService,
    LinkCodesService,
    LinkCodeFailureCounter,
    GuardianshipLifecycleService,
    GuardianNotificationsService,
    GuardianEvidenceService,
    DependentProfilesPurgeCronService,
    FamilyFeatureFlagsService,
    SupervisionStateService,
  ],
  exports: [
    GuardianshipsService,
    GuardianshipLifecycleService,
    LinkCodesService,
    GuardianNotificationsService,
    GuardianEvidenceService,
    FamilyFeatureFlagsService,
    SupervisionStateService,
  ],
})
export class GuardianshipsModule {}

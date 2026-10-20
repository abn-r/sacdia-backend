import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ActingForModule } from '../auth/acting-for/acting-for.module';
import { LegalModule } from '../legal/legal.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BetterAuthModule } from '../better-auth/better-auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DependentClaimCodesController } from './dependent-claim-codes.controller';
import { DependentProfilesPurgeCronService } from './dependent-profiles-purge-cron.service';
import { PendingTeenCronService } from './pending-teen-cron.service';
import { FamilyFeatureFlagsModule } from './family-feature-flags.module';
import { GuardianEvidenceService } from './guardian-evidence.service';
import { SUPERVISED_LOGIN_EVENTS } from '../auth/supervised/supervised-login-events.port';
import { DependentActionLimiter } from './dependent-action-limiter';
import { GuardianSecurityNotificationsService } from './guardian-security-notifications.service';
import { GuardianPowersPolicy } from './guardian-powers.policy';
import { SupervisedLoginsService } from './supervised-logins.service';
import { GuardianNotificationsService } from './guardian-notifications.service';
import { GuardianshipLifecycleService } from './guardianship-lifecycle.service';
import { TeenLinkCodesController } from './teen-link-codes.controller';
import { GuardianshipsController } from './guardianships.controller';
import { GuardianshipsService } from './guardianships.service';
import { LinkCodeFailureCounter } from './link-code-failure-counter';
import { LinkCodesService } from './link-codes.service';
import {
  LINKED_DEVICE_REVOKER,
  NOOP_LINKED_DEVICE_REVOKER,
} from './linked-device-revoker.port';
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
    FamilyFeatureFlagsModule,
    // SupervisedLoginsService sends the standard reset email to email teens.
    BetterAuthModule,
  ],
  controllers: [
    GuardianshipsController,
    DependentClaimCodesController,
    TeenLinkCodesController,
  ],
  providers: [
    GuardianshipsService,
    LinkCodesService,
    LinkCodeFailureCounter,
    GuardianshipLifecycleService,
    GuardianNotificationsService,
    GuardianEvidenceService,
    DependentProfilesPurgeCronService,
    PendingTeenCronService,
    SupervisionStateService,
    GuardianPowersPolicy,
    DependentActionLimiter,
    SupervisedLoginsService,
    GuardianSecurityNotificationsService,
    // The login, enable/disable and link code flows report to the security notices.
    {
      provide: SUPERVISED_LOGIN_EVENTS,
      useExisting: GuardianSecurityNotificationsService,
    },
    // 3a default: there are no linked devices yet. 3b rebinds this token.
    { provide: LINKED_DEVICE_REVOKER, useValue: NOOP_LINKED_DEVICE_REVOKER },
  ],
  exports: [
    GuardianshipsService,
    GuardianshipLifecycleService,
    LinkCodesService,
    GuardianNotificationsService,
    GuardianEvidenceService,
    FamilyFeatureFlagsModule,
    SupervisionStateService,
    GuardianPowersPolicy,
    GuardianSecurityNotificationsService,
    SUPERVISED_LOGIN_EVENTS,
    LINKED_DEVICE_REVOKER,
  ],
})
export class GuardianshipsModule {}

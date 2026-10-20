import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ActingForModule } from '../auth/acting-for/acting-for.module';
import { LegalModule } from '../legal/legal.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BetterAuthModule } from '../better-auth/better-auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DependentClaimCodesController } from './dependent-claim-codes.controller';
import { DependentProfilesPurgeCronService } from './dependent-profiles-purge-cron.service';
import { DirectorDependentsController } from './director-dependents.controller';
import { DirectorDependentsService } from './director-dependents.service';
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
import { LINKED_DEVICE_REVOKER } from './linked-device-revoker.port';
import { LinkedDeviceModule } from '../auth/device/linked-device.module';
import { DevicePairingFailureCounter } from './device-pairing-failure-counter';
import { DevicePairingService } from './device-pairing.service';
import { LinkedDevicesService } from './linked-devices.service';
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
    // The device gate / revocation core, shared with the auth layer.
    LinkedDeviceModule,
  ],
  controllers: [
    GuardianshipsController,
    DependentClaimCodesController,
    DirectorDependentsController,
    TeenLinkCodesController,
  ],
  providers: [
    GuardianshipsService,
    LinkCodesService,
    LinkCodeFailureCounter,
    GuardianshipLifecycleService,
    GuardianNotificationsService,
    GuardianEvidenceService,
    DirectorDependentsService,
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
    LinkedDevicesService,
    DevicePairingService,
    DevicePairingFailureCounter,
    // The 3a flows (enable a teen login, a guardian leaves, account closure, a
    // teen links a guardian, the cron freeze) revoke devices through this port.
    // REQUIRED and real since 3b: there is no no-op default any more.
    { provide: LINKED_DEVICE_REVOKER, useExisting: LinkedDevicesService },
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
    LinkedDevicesService,
    DevicePairingService,
  ],
})
export class GuardianshipsModule {}

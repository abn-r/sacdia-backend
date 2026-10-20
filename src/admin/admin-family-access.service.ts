import { Injectable } from '@nestjs/common';
import {
  LinkedDevicesService,
  type RevokeDeviceResponse,
} from '../guardianships/linked-devices.service';
import { SupervisedLoginsService } from '../guardianships/supervised-logins.service';
import { AdminUsersService } from './admin-users.service';

/** What the admin gets back after cutting a minor's own login. */
export interface AdminDisabledSupervisedLogin {
  supervised_login: {
    status: 'disabled';
    method: 'email' | 'handle';
    origin: 'self_registered' | 'guardian_enabled';
    enabled_at: string | null;
    disabled_at: string | null;
    disabled_reason: string | null;
    password_set_by: 'guardian' | 'self';
  };
}

/**
 * The admin's two powers over a minor's access (family profiles 3c, FP3-66):
 * disable the own login and revoke a paired device. Both need a REASON (stored
 * in the audit row only) and the target inside the actor's territory, checked
 * BEFORE anything is cut.
 *
 * Deliberately absent: enabling or reactivating a login and setting, resetting
 * or reading a password. The guardian decides who may log in.
 */
@Injectable()
export class AdminFamilyAccessService {
  constructor(
    private readonly adminUsers: AdminUsersService,
    private readonly supervisedLogins: SupervisedLoginsService,
    private readonly linkedDevices: LinkedDevicesService,
  ) {}

  async disableSupervisedLogin(
    adminId: string,
    userId: string,
    reason: string,
  ): Promise<AdminDisabledSupervisedLogin> {
    await this.adminUsers.assertUserInActorScope(adminId, userId);
    const { supervised_login: login } =
      await this.supervisedLogins.disableAsAdmin(adminId, userId, reason);
    // The handle and the email stay out of the answer: this route needs the
    // update permission, not the sensitive READ one that shows them.
    return {
      supervised_login: {
        status: 'disabled',
        method: login.method,
        origin: login.origin,
        enabled_at: login.enabled_at,
        disabled_at: login.disabled_at,
        disabled_reason: login.disabled_reason,
        password_set_by: login.password_set_by,
      },
    };
  }

  async revokeLinkedDevice(
    adminId: string,
    userId: string,
    deviceId: string,
    reason: string,
  ): Promise<RevokeDeviceResponse> {
    await this.adminUsers.assertUserInActorScope(adminId, userId);
    return this.linkedDevices.revokeAsAdmin(adminId, userId, deviceId, reason);
  }
}

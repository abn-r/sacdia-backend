import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { markExplicitAuditRecorded } from '../audit-logs/audit-request-context';
import {
  LinkedDeviceRevocation,
  type RevokedDevice,
} from '../auth/device/linked-device-revocation';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { GuardianPowersPolicy } from './guardian-powers.policy';
import { GuardianSecurityNotificationsService } from './guardian-security-notifications.service';
import { displayName, lockDependent } from './guardianship-queries';
import {
  MAX_LINKED_DEVICES_PER_DEPENDENT,
  REVOKED_DEVICE_HISTORY_MS,
} from './guardianships.constants';
import type {
  LinkedDeviceRevoker,
  LinkedDeviceRevokeReason,
} from './linked-device-revoker.port';

export interface LinkedDeviceView {
  linked_device_id: string;
  label: string;
  platform: string;
  app_version: string | null;
  paired_at: string;
  paired_by_display_name: string;
  last_seen_at: string | null;
  absolute_expires_at: string;
  status: 'active' | 'revoked';
  revoked_at: string | null;
  revoked_reason: string | null;
}

export interface LinkedDeviceListResponse {
  devices: LinkedDeviceView[];
  limits: { max_devices: number };
}

export interface RevokeDeviceResponse {
  linked_device_id: string;
  revoked_at: string;
  revoked_reason: string;
}

/**
 * Reasons whose guardians must be told ("a device was unlinked"): the ones a
 * guardian did not necessarily cause (a logout, a session revoke, an admin) and
 * the two lifecycle ends the guardians would otherwise never learn about
 * (`majority`: the child is old enough for an own account; `expired`: the
 * 180-day cap passed). The others stay silent: `teen_login_enabled` has a notice
 * of its own and `dependent_frozen` is caused by an adult (guardian or director)
 * action, so a second notice would be redundant.
 */
const NOTIFIED_REASONS: ReadonlySet<LinkedDeviceRevokeReason> = new Set([
  'guardian',
  'guardianship_revoked',
  'guardian_account_closed',
  'device_logout',
  'session_revoked',
  'admin',
  'majority',
  'expired',
]);

/**
 * The 3a callers revoke inside their own transaction and only know "it
 * committed" later. The notice is therefore sent once the revoke is VISIBLE to a
 * separate connection: a rolled-back revoke is never announced. Waits are
 * public so tests can shrink them.
 */
export const COMMIT_POLL_DELAYS_MS: number[] = [50, 250, 1_000, 3_000, 8_000];

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

const DEVICE_VIEW_SELECT = {
  linked_device_id: true,
  label: true,
  platform: true,
  app_version: true,
  paired_at: true,
  last_seen_at: true,
  absolute_expires_at: true,
  revoked_at: true,
  revoked_reason: true,
  paired_by: { select: { name: true, paternal_last_name: true } },
} satisfies Prisma.linked_devicesSelect;

type DeviceViewRow = Prisma.linked_devicesGetPayload<{
  select: typeof DEVICE_VIEW_SELECT;
}>;

/**
 * Linked devices of a dependent: list, revoke, and the revoke side of the
 * LINKED_DEVICE_REVOKER port that the 3a lifecycle code calls inside its own
 * transactions (a guardian leaves or is removed, the account is closed, a teen
 * login is enabled, the child is frozen, ...).
 *
 * Powers: ANY verified guardian of the child lists and revokes (not only the
 * one who paired the phone), as self. A pending guardian is 403, a stranger
 * 404. Revoking is idempotent and the device of another family is a 404.
 *
 * The device-level work (set the reason, delete the session, FCM cleanup, audit)
 * is {@link LinkedDeviceRevocation}; this class adds the guardian-facing rules,
 * the epoch bump and the "device unlinked" notice to the remaining guardians.
 */
@Injectable()
export class LinkedDevicesService implements LinkedDeviceRevoker {
  private readonly logger = new Logger(LinkedDevicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly revocation: LinkedDeviceRevocation,
    private readonly powers: GuardianPowersPolicy,
    private readonly security: GuardianSecurityNotificationsService,
  ) {
    // The request check revokes on its own (majority, expiry, ...) from the auth
    // layer, which cannot see this module: it announces through this hook and
    // `notify` stays the single place that decides who is told.
    this.revocation.onAutoRevoked((revoked, reason) =>
      this.notify(revoked, reason),
    );
  }

  // ---------------------------------------------------------------------------
  // Guardian-facing
  // ---------------------------------------------------------------------------

  async list(
    guardianId: string,
    dependentId: string,
  ): Promise<LinkedDeviceListResponse> {
    await this.powers.assertVerifiedGuardian(guardianId, dependentId);

    const since = new Date(Date.now() - REVOKED_DEVICE_HISTORY_MS);
    const rows = await this.prisma.linked_devices.findMany({
      where: {
        dependent_user_id: dependentId,
        OR: [{ revoked_at: null }, { revoked_at: { gte: since } }],
      },
      orderBy: { paired_at: 'desc' },
      select: DEVICE_VIEW_SELECT,
    });
    return {
      devices: rows.map(toView),
      limits: { max_devices: MAX_LINKED_DEVICES_PER_DEPENDENT },
    };
  }

  /**
   * POST .../devices/:deviceId/revoke. Idempotent: a device that is already
   * revoked answers the same 200 and writes nothing again. The next request of
   * the phone is a 401 (the session is deleted and the epoch moves), even with
   * an unexpired JWT.
   */
  async revoke(
    guardianId: string,
    dependentId: string,
    deviceId: string,
  ): Promise<RevokeDeviceResponse> {
    await this.powers.assertVerifiedGuardian(guardianId, dependentId);
    return this.revokeOne(dependentId, deviceId, {
      by: guardianId,
      reason: 'guardian',
    });
  }

  /** The admin entry used by sub-phase 3c (permission checked by the caller). */
  async revokeAsAdmin(
    adminId: string,
    dependentId: string,
    deviceId: string,
  ): Promise<RevokeDeviceResponse> {
    return this.revokeOne(dependentId, deviceId, {
      by: adminId,
      reason: 'admin',
    });
  }

  /** The device logged itself out ("Desvincular"): the session is already gone. */
  async revokeByLogout(deviceId: string): Promise<void> {
    const revoked = await this.prisma.$transaction((tx) =>
      this.revocation.revokeInTx(
        tx,
        { linked_device_id: deviceId },
        { by: null, reason: 'device_logout' },
      ),
    );
    await this.afterCommit(revoked, 'device_logout');
  }

  private async revokeOne(
    dependentId: string,
    deviceId: string,
    input: { by: string; reason: LinkedDeviceRevokeReason },
  ): Promise<RevokeDeviceResponse> {
    const result = await this.prisma.$transaction(async (tx) => {
      await lockDependent(tx, dependentId);

      const device = await tx.linked_devices.findFirst({
        where: { linked_device_id: deviceId, dependent_user_id: dependentId },
        select: {
          linked_device_id: true,
          revoked_at: true,
          revoked_reason: true,
        },
      });
      if (!device) {
        throw new AppException(
          ErrorCode.DEVICE_NOT_FOUND,
          HttpStatus.NOT_FOUND,
        );
      }
      if (device.revoked_at && device.revoked_reason) {
        return {
          revoked: [] as RevokedDevice[],
          view: {
            linked_device_id: device.linked_device_id,
            revoked_at: device.revoked_at.toISOString(),
            revoked_reason: device.revoked_reason,
          },
        };
      }

      markExplicitAuditRecorded();
      const revoked = await this.revocation.revokeInTx(
        tx,
        { linked_device_id: deviceId },
        input,
      );
      const after = await tx.linked_devices.findUniqueOrThrow({
        where: { linked_device_id: deviceId },
        select: { revoked_at: true, revoked_reason: true },
      });
      return {
        revoked,
        view: {
          linked_device_id: deviceId,
          revoked_at: (after.revoked_at as Date).toISOString(),
          revoked_reason: after.revoked_reason as string,
        },
      };
    });

    if (result.revoked.length > 0) {
      // The transaction committed: cut the cache now and tell the others.
      await this.revocation.bumpAfterCommit(result.revoked);
      this.notify(result.revoked, input.reason, input.by);
    }
    return result.view;
  }

  // ---------------------------------------------------------------------------
  // LinkedDeviceRevoker port (called inside the 3a transactions)
  // ---------------------------------------------------------------------------

  async revokeAllForDependent(
    tx: Prisma.TransactionClient,
    dependentUserId: string,
    reason: LinkedDeviceRevokeReason,
  ): Promise<number> {
    const revoked = await this.revocation.revokeInTx(
      tx,
      { dependent_user_id: dependentUserId },
      { by: null, reason },
    );
    this.settleAfterCommit(revoked, reason);
    return revoked.length;
  }

  async revokeByGuardianship(
    tx: Prisma.TransactionClient,
    guardianshipId: string,
    reason: LinkedDeviceRevokeReason,
  ): Promise<number> {
    const revoked = await this.revocation.revokeInTx(
      tx,
      { guardianship_id: guardianshipId },
      { by: null, reason },
    );
    this.settleAfterCommit(revoked, reason);
    return revoked.length;
  }

  // ---------------------------------------------------------------------------
  // After commit
  // ---------------------------------------------------------------------------

  /** For callers whose transaction is already committed: bump and notify. */
  private async afterCommit(
    revoked: RevokedDevice[],
    reason: LinkedDeviceRevokeReason,
  ): Promise<void> {
    if (revoked.length === 0) return;
    await this.revocation.bumpAfterCommit(revoked);
    this.notify(revoked, reason);
  }

  /**
   * For revokes made inside somebody else's transaction: wait until the rows
   * show up as revoked on another connection (committed), then bump the epoch
   * (idempotent with the caller's own bump) and notify. If they never do, the
   * transaction rolled back and nothing is announced.
   */
  private settleAfterCommit(
    revoked: RevokedDevice[],
    reason: LinkedDeviceRevokeReason,
  ): void {
    if (revoked.length === 0) return;
    void this.waitForCommit(revoked, reason).catch((error: unknown) => {
      this.logger.warn(
        `Could not settle ${revoked.length} device revoke(s): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  private async waitForCommit(
    revoked: RevokedDevice[],
    reason: LinkedDeviceRevokeReason,
  ): Promise<void> {
    const ids = revoked.map((device) => device.linkedDeviceId);
    for (const delay of COMMIT_POLL_DELAYS_MS) {
      await sleep(delay);
      const committed = await this.prisma.linked_devices.findMany({
        where: { linked_device_id: { in: ids }, revoked_at: { not: null } },
        select: { linked_device_id: true },
      });
      if (committed.length > 0) {
        const visible = new Set(committed.map((row) => row.linked_device_id));
        const settled = revoked.filter((device) =>
          visible.has(device.linkedDeviceId),
        );
        await this.revocation.bumpAfterCommit(settled);
        this.notify(settled, reason);
        return;
      }
    }
  }

  /** "A device was unlinked" to the remaining verified guardians. Never throws. */
  private notify(
    revoked: RevokedDevice[],
    reason: LinkedDeviceRevokeReason,
    excludeUserId?: string,
  ): void {
    if (!NOTIFIED_REASONS.has(reason)) return;
    for (const device of revoked) {
      void this.security
        .onDeviceRevoked({
          dependentUserId: device.dependentUserId,
          label: device.label,
          excludeUserId,
          reason,
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `Device revoked notice failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
    }
  }
}

function toView(row: DeviceViewRow): LinkedDeviceView {
  return {
    linked_device_id: row.linked_device_id,
    label: row.label,
    platform: row.platform,
    app_version: row.app_version,
    paired_at: row.paired_at.toISOString(),
    paired_by_display_name: displayName(row.paired_by),
    last_seen_at: row.last_seen_at ? row.last_seen_at.toISOString() : null,
    absolute_expires_at: row.absolute_expires_at.toISOString(),
    status: row.revoked_at ? 'revoked' : 'active',
    revoked_at: row.revoked_at ? row.revoked_at.toISOString() : null,
    revoked_reason: row.revoked_reason,
  };
}

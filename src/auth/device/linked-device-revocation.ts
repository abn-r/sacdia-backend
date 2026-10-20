import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { getAuditCorrelationId } from '../../audit-logs/audit-request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { ActingForCache } from '../acting-for/acting-for.cache';
import type { LinkedDeviceRevokeReason } from '../../guardianships/linked-device-revoker.port';

/** A device row that THIS call moved from active to revoked. */
export interface RevokedDevice {
  linkedDeviceId: string;
  dependentUserId: string;
  guardianshipId: string;
  pairedByUserId: string;
  label: string;
  platform: string;
  sessionId: string;
}

export interface RevokeInput {
  /** Who revoked it; null for the system (lifecycle events, the request check). */
  by: string | null;
  reason: LinkedDeviceRevokeReason;
}

const DEVICE_SELECT = {
  linked_device_id: true,
  dependent_user_id: true,
  guardianship_id: true,
  paired_by_user_id: true,
  session_id: true,
  label: true,
  platform: true,
  fcm_token_id: true,
} satisfies Prisma.linked_devicesSelect;

/**
 * The one place that turns a linked device off (Phase 3b, FP3-49/50). It only
 * depends on Prisma and the epoch cache, so the auth layer (the per-request
 * check, logout, session revocation) and the guardianships module (explicit
 * revoke, the lifecycle triggers) share it without a module cycle.
 *
 * Revoking a device, inside the caller's transaction:
 *  - sets `revoked_at` / `revoked_by_user_id` / `revoked_reason` (compare and
 *    set on `revoked_at IS NULL`: revoking twice changes nothing and writes ONE
 *    audit row);
 *  - hard-deletes the device session (the refresh token dies with it);
 *  - deactivates the FCM token the device registered, but only while it still
 *    belongs to the dependent (a token that moved to another user stays), and,
 *    when no other device of the child is left, any other token the child still
 *    holds (a child has no account: they were all registered by devices);
 *  - writes the `linked_device.revoked` audit row in the same transaction.
 *
 * Cache invalidation (the dependent's epoch bump) is NOT done here: the caller
 * does it after its transaction commits ({@link bumpAfterCommit}).
 */
@Injectable()
export class LinkedDeviceRevocation {
  private readonly logger = new Logger(LinkedDeviceRevocation.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly actingForCache: ActingForCache,
  ) {}

  /** Revokes every ACTIVE device matching `where`. Returns the ones it revoked. */
  async revokeInTx(
    tx: Prisma.TransactionClient,
    where: Prisma.linked_devicesWhereInput,
    input: RevokeInput,
  ): Promise<RevokedDevice[]> {
    const rows = await tx.linked_devices.findMany({
      where: { ...where, revoked_at: null },
      orderBy: { paired_at: 'asc' },
      select: DEVICE_SELECT,
    });
    if (rows.length === 0) {
      return [];
    }

    const now = new Date();
    const revoked: RevokedDevice[] = [];
    for (const row of rows) {
      const changed = await tx.linked_devices.updateMany({
        where: { linked_device_id: row.linked_device_id, revoked_at: null },
        data: {
          revoked_at: now,
          revoked_by_user_id: input.by,
          revoked_reason: input.reason,
        },
      });
      if (changed.count === 0) {
        continue; // a concurrent revoke won: its audit row is the one
      }

      await tx.session.deleteMany({ where: { id: row.session_id } });
      if (row.fcm_token_id) {
        await tx.user_fcm_tokens.updateMany({
          where: {
            fcm_token_id: row.fcm_token_id,
            user_id: row.dependent_user_id,
          },
          data: { active: false },
        });
      }
      await this.recordAudit(tx, row, input, now);
      revoked.push({
        linkedDeviceId: row.linked_device_id,
        dependentUserId: row.dependent_user_id,
        guardianshipId: row.guardianship_id,
        pairedByUserId: row.paired_by_user_id,
        label: row.label,
        platform: row.platform,
        sessionId: row.session_id,
      });
    }

    // A child has no account: when its last device goes, nothing is left to
    // push to. Deactivates tokens a rotation left behind.
    for (const dependentId of new Set(
      revoked.map((device) => device.dependentUserId),
    )) {
      const remaining = await tx.linked_devices.count({
        where: { dependent_user_id: dependentId, revoked_at: null },
      });
      if (remaining === 0) {
        await tx.user_fcm_tokens.updateMany({
          where: { user_id: dependentId, active: true },
          data: { active: false },
        });
      }
    }
    return revoked;
  }

  /**
   * Self-heal: revokes (`session_revoked`) the ACTIVE devices of the child whose
   * session row no longer exists, inside the caller's transaction. A device
   * without a session can never act again, so it must not hold one of the
   * child's slots. This is the safety net for a path that deleted the session
   * but failed to record the revoke (a logout whose second step failed, a
   * session purge). Returns the devices it revoked; the caller bumps the epoch
   * after its commit.
   */
  async healOrphansInTx(
    tx: Prisma.TransactionClient,
    dependentUserId: string,
  ): Promise<RevokedDevice[]> {
    const active = await tx.linked_devices.findMany({
      where: { dependent_user_id: dependentUserId, revoked_at: null },
      select: { linked_device_id: true, session_id: true },
    });
    if (active.length === 0) return [];

    const alive = await tx.session.findMany({
      where: { id: { in: active.map((device) => device.session_id) } },
      select: { id: true },
    });
    const aliveIds = new Set(alive.map((session) => session.id));
    const orphanIds = active
      .filter((device) => !aliveIds.has(device.session_id))
      .map((device) => device.linked_device_id);
    if (orphanIds.length === 0) return [];

    return this.revokeInTx(
      tx,
      { linked_device_id: { in: orphanIds } },
      { by: null, reason: 'session_revoked' },
    );
  }

  /** Own transaction + epoch bump: for callers that have no transaction of their own. */
  async revokeStandalone(
    where: Prisma.linked_devicesWhereInput,
    input: RevokeInput,
  ): Promise<RevokedDevice[]> {
    const revoked = await this.prisma.$transaction((tx) =>
      this.revokeInTx(tx, where, input),
    );
    await this.bumpAfterCommit(revoked);
    return revoked;
  }

  /**
   * Moves the dependent's epoch so every cached device decision is orphaned and
   * the very next request of the device reads the database. A cache outage is
   * logged by the cache itself and never thrown.
   */
  async bumpAfterCommit(
    devices: ReadonlyArray<{ dependentUserId: string }>,
  ): Promise<void> {
    for (const dependentId of new Set(
      devices.map((device) => device.dependentUserId),
    )) {
      await this.actingForCache.bump(dependentId);
    }
  }

  /**
   * Marks the devices of these sessions as revoked (`session_revoked`) after the
   * sessions were deleted by another path (a user or admin session revoke).
   * The sessions are already gone, so this only records why and bumps.
   */
  async markSessionsRevoked(
    sessionIds: readonly string[],
    by: string | null,
  ): Promise<RevokedDevice[]> {
    if (sessionIds.length === 0) return [];
    try {
      return await this.revokeStandalone(
        { session_id: { in: [...sessionIds] } },
        { by, reason: 'session_revoked' },
      );
    } catch (error) {
      this.logger.warn(
        `Could not record the device revoke for ${sessionIds.length} session(s): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  /**
   * After sessions of `dependentUserId` were deleted by some other path (a user
   * or admin "revoke session"), records the devices whose session vanished as
   * revoked (`session_revoked`). One cheap read when the user has no devices.
   */
  async markMissingSessionsRevoked(
    dependentUserId: string,
    by: string | null,
  ): Promise<RevokedDevice[]> {
    try {
      const active = await this.prisma.linked_devices.findMany({
        where: { dependent_user_id: dependentUserId, revoked_at: null },
        select: { session_id: true },
      });
      if (active.length === 0) return [];
      const alive = await this.prisma.session.findMany({
        where: { id: { in: active.map((device) => device.session_id) } },
        select: { id: true },
      });
      const aliveIds = new Set(alive.map((session) => session.id));
      return await this.markSessionsRevoked(
        active
          .map((device) => device.session_id)
          .filter((sessionId) => !aliveIds.has(sessionId)),
        by,
      );
    } catch (error) {
      this.logger.warn(
        `Could not reconcile the devices of ${dependentUserId} after a session revoke: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private async recordAudit(
    tx: Prisma.TransactionClient,
    row: {
      linked_device_id: string;
      dependent_user_id: string;
      label: string;
      platform: string;
    },
    input: RevokeInput,
    at: Date,
  ): Promise<void> {
    await tx.audit_logs.create({
      data: {
        entity_type: 'linked_device',
        entity_id: row.linked_device_id,
        action: 'linked_device.revoked',
        actor_user_id: input.by,
        actor_kind: input.by ? 'user' : 'system',
        target_user_id: row.dependent_user_id,
        summary: 'Dispositivo vinculado desvinculado',
        changes: {
          reason: input.reason,
          label: row.label,
          platform: row.platform,
        },
        request_context: { linked_device_id: row.linked_device_id },
        result: 'succeeded',
        source: 'service',
        correlation_id: getAuditCorrelationId() ?? null,
        effective_at: at,
      },
    });
  }
}

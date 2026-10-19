import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ActingForCache } from '../auth/acting-for/acting-for.cache';
import {
  AppException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { VoluntaryRevokeReason } from './dto';
import {
  ACTIVE_USER_GUARDIAN,
  NOT_REVOKED,
  displayName,
  findLiveAssignment,
  lockDependent,
  lockDependentsAscending,
  type Db,
} from './guardianship-queries';
import {
  FROZEN_PURGE_AFTER_DAYS,
  type DependentOutcome,
  type GuardianshipRevokedReason,
} from './guardianships.constants';
import type { DeletionImpactEntry } from './guardianships.types';

/** Club roles told that a minor is now under the club's custody. */
const CUSTODY_NOTIFY_ROLES = ['director', 'deputy-director'];

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DetachResult {
  guardianshipId: string;
  dependentUserId: string;
  outcome: DependentOutcome;
  /** Set for `club_custody`: the section whose directors must be told. */
  custodyClubSectionId?: number;
  dependentName?: string;
}

interface DetachableRow {
  guardianship_id: string;
  dependent_user_id: string;
  guardian_user_id: string | null;
  is_primary: boolean;
  consent_status: string;
  verification_method: string | null;
  verified_at: Date | null;
  verified_by_user_id: string | null;
}

const DETACHABLE_SELECT = {
  guardianship_id: true,
  dependent_user_id: true,
  guardian_user_id: true,
  is_primary: true,
  consent_status: true,
  verification_method: true,
  verified_at: true,
  verified_by_user_id: true,
} satisfies Prisma.guardianshipsSelect;

/**
 * What happens to a dependent when one of its guardians leaves, is removed or
 * deletes the account. The same logic backs the voluntary revoke endpoint and
 * the account deletion transaction, so the two can never drift apart.
 *
 * Outcome per leaving guardian row:
 *   1. another active guardian exists  -> `other_guardian` (oldest is promoted
 *      to primary when the primary left);
 *   2. else the dependent has an active/pending club assignment -> a custodian
 *      row is created for the club -> `club_custody`;
 *   3. else the profile is frozen and scheduled for purge -> `frozen`.
 */
@Injectable()
export class GuardianshipLifecycleService {
  private readonly logger = new Logger(GuardianshipLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly actingForCache: ActingForCache,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Detach (shared by revoke and account deletion)
  // ---------------------------------------------------------------------------

  /**
   * Revokes EVERY active guardianship of `userId` and applies the dependent
   * outcome. Runs inside the caller's transaction; call `afterCommit` with the
   * returned results once it commits.
   */
  async detachGuardian(
    tx: Prisma.TransactionClient,
    userId: string,
    reason: GuardianshipRevokedReason,
  ): Promise<DetachResult[]> {
    const where = {
      guardian_user_id: userId,
      is_custodian: false,
      ...NOT_REVOKED,
    } satisfies Prisma.guardianshipsWhereInput;

    // Which dependents are touched is only a hint until their locks are held.
    const candidates = await tx.guardianships.findMany({
      where,
      select: { dependent_user_id: true },
    });
    if (candidates.length === 0) {
      return [];
    }

    // Ascending id order: two guardians deleting at once never deadlock.
    await lockDependentsAscending(
      tx,
      candidates.map((candidate) => candidate.dependent_user_id),
    );

    // Re-read under the locks: a concurrent leave may have revoked rows since.
    const rows = await tx.guardianships.findMany({
      where,
      orderBy: { created_at: 'asc' },
      select: DETACHABLE_SELECT,
    });

    const results: DetachResult[] = [];
    for (const row of rows) {
      results.push(await this.detachRow(tx, row, reason));
    }
    return results;
  }

  async detachRow(
    tx: Prisma.TransactionClient,
    row: DetachableRow,
    reason: GuardianshipRevokedReason,
  ): Promise<DetachResult> {
    const now = new Date();
    const dependentId = row.dependent_user_id;

    // Callers lock before they read `row`; this keeps the guarantee for any
    // other caller (re-entrant within the transaction).
    await lockDependent(tx, dependentId);

    await tx.guardianships.update({
      where: { guardianship_id: row.guardianship_id },
      data: {
        consent_status: 'revoked',
        revoked_at: now,
        revoked_reason: reason,
        modified_at: now,
      },
    });

    // Codes the leaver issued must not outlive them.
    if (row.guardian_user_id) {
      await tx.guardianship_link_codes.updateMany({
        where: {
          dependent_user_id: dependentId,
          issued_by_user_id: row.guardian_user_id,
          consumed_at: null,
          revoked_at: null,
        },
        data: { revoked_at: now },
      });
    }

    const others = await tx.guardianships.findMany({
      where: {
        dependent_user_id: dependentId,
        ...ACTIVE_USER_GUARDIAN,
      },
      orderBy: { created_at: 'asc' },
      select: { guardianship_id: true, is_primary: true },
    });

    if (others.length > 0) {
      if (!others.some((other) => other.is_primary)) {
        await tx.guardianships.update({
          where: { guardianship_id: others[0].guardianship_id },
          data: { is_primary: true, modified_at: now },
        });
      }
      return {
        guardianshipId: row.guardianship_id,
        dependentUserId: dependentId,
        outcome: 'other_guardian',
      };
    }

    const assignment = await findLiveAssignment(tx, dependentId);
    if (assignment && assignment.clubId !== null) {
      const primaryLeft = await tx.guardianships.count({
        where: {
          dependent_user_id: dependentId,
          is_primary: true,
          ...NOT_REVOKED,
        },
      });
      await tx.guardianships.create({
        data: {
          dependent_user_id: dependentId,
          guardian_user_id: null,
          is_custodian: true,
          custodian_club_id: assignment.clubId,
          is_primary: primaryLeft === 0,
          // Custody keeps whatever the guardian had earned.
          consent_status: row.consent_status,
          verification_method: row.verification_method,
          verified_at: row.verified_at,
          verified_by_user_id: row.verified_by_user_id,
        },
      });
      const dependent = await tx.users.findUnique({
        where: { user_id: dependentId },
        select: { name: true, paternal_last_name: true },
      });
      return {
        guardianshipId: row.guardianship_id,
        dependentUserId: dependentId,
        outcome: 'club_custody',
        custodyClubSectionId: assignment.clubSectionId,
        dependentName: displayName(dependent),
      };
    }

    await tx.dependent_profiles.updateMany({
      where: { user_id: dependentId, purged_at: null },
      data: {
        frozen_at: now,
        purge_after: new Date(now.getTime() + FROZEN_PURGE_AFTER_DAYS * DAY_MS),
      },
    });
    return {
      guardianshipId: row.guardianship_id,
      dependentUserId: dependentId,
      outcome: 'frozen',
    };
  }

  /**
   * After the transaction committed: invalidate the acting-for decisions of
   * every touched dependent and tell the club directors about custody.
   * Notification failures are logged, never thrown.
   */
  async afterCommit(results: DetachResult[]): Promise<void> {
    for (const result of results) {
      await this.actingForCache.bump(result.dependentUserId);
      if (
        result.outcome === 'club_custody' &&
        result.custodyClubSectionId !== undefined
      ) {
        void this.notificationsService
          .sendToSectionRole(
            result.custodyClubSectionId,
            CUSTODY_NOTIFY_ROLES,
            'Un menor quedó bajo custodia del club',
            result.dependentName
              ? `${result.dependentName} ya no tiene tutor registrado. El club asume su custodia.`
              : 'Un menor de tu club ya no tiene tutor registrado. El club asume su custodia.',
            {
              type: 'dependent_custody_transferred',
              dependent_user_id: result.dependentUserId,
              clubSectionId: String(result.custodyClubSectionId),
            },
            'family:custody_transferred',
          )
          .catch((error: unknown) => {
            this.logger.warn(
              `Custody notification failed for ${result.dependentUserId}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Voluntary revoke
  // ---------------------------------------------------------------------------

  /**
   * POST /guardianships/:id/revoke. Allowed only for the row's own guardian
   * (`guardian_left`) or for the dependent's primary removing a secondary
   * (`removed_by_primary`). A stranger gets 404 so ids cannot be probed.
   */
  async revoke(
    actorId: string,
    guardianshipId: string,
    reason: VoluntaryRevokeReason,
  ): Promise<{
    guardianship_id: string;
    consent_status: 'revoked';
    dependent_outcome: DependentOutcome;
  }> {
    const result = await this.prisma.$transaction(async (tx) => {
      // Lock the dependent BEFORE reading anything the decision depends on.
      const probe = await tx.guardianships.findUnique({
        where: { guardianship_id: guardianshipId },
        select: { dependent_user_id: true },
      });
      if (!probe) {
        throw new AppNotFoundException(ErrorCode.GUARDIANSHIP_NOT_FOUND);
      }
      await lockDependent(tx, probe.dependent_user_id);

      const target = await tx.guardianships.findFirst({
        where: {
          guardianship_id: guardianshipId,
          is_custodian: false,
          guardian_user_id: { not: null },
          ...NOT_REVOKED,
        },
        select: DETACHABLE_SELECT,
      });
      if (!target) {
        throw new AppNotFoundException(ErrorCode.GUARDIANSHIP_NOT_FOUND);
      }

      const actorRow =
        target.guardian_user_id === actorId
          ? target
          : await tx.guardianships.findFirst({
              where: {
                dependent_user_id: target.dependent_user_id,
                guardian_user_id: actorId,
                is_custodian: false,
                ...NOT_REVOKED,
              },
              select: { is_primary: true },
            });
      if (!actorRow) {
        throw new AppNotFoundException(ErrorCode.GUARDIANSHIP_NOT_FOUND);
      }

      const leavingSelf =
        reason === 'guardian_left' && target.guardian_user_id === actorId;
      const primaryRemovingSecondary =
        reason === 'removed_by_primary' &&
        target.guardian_user_id !== actorId &&
        actorRow.is_primary === true &&
        target.is_primary === false;
      if (!leavingSelf && !primaryRemovingSecondary) {
        throw new AppException(
          ErrorCode.GUARDIANSHIP_REVOKE_FORBIDDEN,
          HttpStatus.FORBIDDEN,
        );
      }

      return this.detachRow(tx, target, reason);
    });

    await this.afterCommit([result]);
    return {
      guardianship_id: guardianshipId,
      consent_status: 'revoked',
      dependent_outcome: result.outcome,
    };
  }

  // ---------------------------------------------------------------------------
  // Deletion impact (read-only preview of what detachGuardian would do)
  // ---------------------------------------------------------------------------

  async deletionImpact(
    userId: string,
    db: Db = this.prisma,
  ): Promise<{ dependents: DeletionImpactEntry[] }> {
    const rows = await db.guardianships.findMany({
      where: {
        guardian_user_id: userId,
        is_custodian: false,
        ...NOT_REVOKED,
        dependent: {
          dependent_profile: { is: { frozen_at: null, purged_at: null } },
        },
      },
      orderBy: { created_at: 'asc' },
      select: {
        dependent_user_id: true,
        dependent: { select: { name: true, paternal_last_name: true } },
      },
    });

    const dependents: DeletionImpactEntry[] = [];
    for (const row of rows) {
      dependents.push({
        user_id: row.dependent_user_id,
        display_name: displayName(row.dependent),
        outcome: await this.previewOutcome(db, userId, row.dependent_user_id),
      });
    }
    return { dependents };
  }

  private async previewOutcome(
    db: Db,
    leavingGuardianId: string,
    dependentId: string,
  ): Promise<DependentOutcome> {
    const otherGuardians = await db.guardianships.count({
      where: {
        dependent_user_id: dependentId,
        ...ACTIVE_USER_GUARDIAN,
        guardian_user_id: { not: leavingGuardianId },
      },
    });
    if (otherGuardians > 0) return 'other_guardian';
    const assignment = await findLiveAssignment(db, dependentId);
    return assignment && assignment.clubId !== null ? 'club_custody' : 'frozen';
  }
}

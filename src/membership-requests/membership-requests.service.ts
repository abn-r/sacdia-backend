import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { AuthorizationContextVersionService } from '../common/authorization/authorization-context-version.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AppNotFoundException,
  AppConflictException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ClubRoleEligibilityService } from '../club-role-eligibility/club-role-eligibility.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ConsentGateService } from './consent-gate.service';
import {
  addDays,
  effectiveMembershipExpiry,
  isMembershipRequestExpired,
  parsePendingTimeoutDays,
} from './membership-request-expiry';

const MEMBERSHIP_REQUEST_REVIEWER_ROLES = [
  'director',
  'deputy-director',
  'secretary',
  'secretary-treasurer',
] as const;

export type PendingMembershipRequestNotificationInput = {
  userId: string;
  clubSectionId: number;
  assignmentId: string;
};

@Injectable()
export class MembershipRequestsService {
  private readonly logger = new Logger(MembershipRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly authorizationContextVersion: AuthorizationContextVersionService,
    private readonly notificationsService: NotificationsService,
    private readonly roleEligibility: ClubRoleEligibilityService,
    private readonly consentGate: ConsentGateService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * List pending membership requests for a club section.
   *
   * Each item carries a `consent` block: `null` for adults, and for dependents
   * (minors without an account) the consent status, whether the signed form is
   * uploaded and who the guardians are. The blocks come from ONE batched read
   * for the whole page. `users.email` is null for dependents.
   */
  async listPending(clubSectionId: number) {
    const requests = await this.prisma.club_role_assignments.findMany({
      where: {
        club_section_id: clubSectionId,
        status: 'pending',
        active: true,
      },
      include: {
        users: {
          select: {
            user_id: true,
            name: true,
            email: true,
            paternal_last_name: true,
            maternal_last_name: true,
            user_image: true,
          },
        },
        roles: {
          select: {
            role_id: true,
            role_name: true,
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    const userIds = [...new Set(requests.map((request) => request.user_id))];
    const [consent, consentStates, timeoutDays] = await Promise.all([
      this.consentGate.loadConsentBlocks(this.prisma, userIds),
      this.consentGate.loadDependentConsent(this.prisma, userIds),
      this.getPendingTimeoutDays(),
    ]);
    return requests.map((request) => ({
      ...request,
      consent: consent.get(request.user_id) ?? null,
      // `expires_at` is the stored base timeout; this one applies the real
      // rule the cron uses (same helper).
      effective_expires_at: effectiveMembershipExpiry({
        createdAt: request.created_at,
        timeoutDays,
        consent: consentStates.get(request.user_id),
      }).toISOString(),
    }));
  }

  /**
   * Approve a pending membership request.
   * Sets status to 'active' and clears expires_at.
   *
   * Uses an atomic updateMany with the status guard in the WHERE clause to
   * prevent TOCTOU races where concurrent approvals both pass a prior findFirst
   * check and both succeed.
   *
   * Dependents (users with a dependent_profiles row) can only be approved once
   * a guardian's consent is verified (409 MR_CONSENT_NOT_VERIFIED); the check
   * runs inside the transaction.
   *
   * Audit trail: the schema has no approved_by_id / approved_at columns on
   * club_role_assignments, so the reviewer is recorded in audit_logs as
   * `membership_request.approved` (actor = reviewer).
   */
  async approve(
    clubSectionId: number,
    assignmentId: string,
    approvedById: string,
  ) {
    const { result, assignment } = await this.prisma.$transaction(
      async (tx) => {
        const pending = await tx.club_role_assignments.findFirst({
          where: {
            assignment_id: assignmentId,
            club_section_id: clubSectionId,
            status: 'pending',
            active: true,
          },
          select: { user_id: true, roles: { select: { role_name: true } } },
        });
        if (!pending) {
          // Nothing to activate here. NEVER fall through to the update: a row
          // re-pended after the read above (post-registration re-pends
          // rejected/expired rows) would match its WHERE and be activated
          // without the consent gate (verify 2c-r2 S-N1).
          const current = await tx.club_role_assignments.findUnique({
            where: { assignment_id: assignmentId },
          });
          return { result: { count: 0 }, assignment: current };
        }
        await this.consentGate.assertApprovable(tx, pending.user_id);
        await this.roleEligibility.assertAssignment({
          userId: pending.user_id,
          roleName: pending.roles.role_name,
          clubSectionId,
          db: tx,
        });
        // activation-gate: pending.user_id
        const result = await tx.club_role_assignments.updateMany({
          where: {
            assignment_id: assignmentId,
            club_section_id: clubSectionId,
            status: 'pending',
            active: true,
          },
          data: { status: 'active', expires_at: null, modified_at: new Date() },
        });
        const assignment = await tx.club_role_assignments.findUnique({
          where: { assignment_id: assignmentId },
        });
        if (result.count > 0) {
          if (!assignment) {
            throw new AppNotFoundException(ErrorCode.MR_NOT_FOUND);
          }
          await this.authorizationContextVersion.bump(tx, assignment.user_id);
        }
        return { result, assignment };
      },
    );

    if (result.count === 0) {
      if (!assignment) {
        throw new AppNotFoundException(ErrorCode.MR_NOT_FOUND);
      }
      if (assignment.club_section_id !== clubSectionId) {
        throw new AppNotFoundException(ErrorCode.MR_NOT_FOUND);
      }
      throw new AppConflictException(ErrorCode.MR_ALREADY_PENDING);
    }
    // Unreachable (the transaction throws when it wrote without a row), but an
    // explicit check narrows the type on every compiler instead of `!`.
    if (!assignment) {
      throw new AppNotFoundException(ErrorCode.MR_NOT_FOUND);
    }

    await this.authorizationContext.invalidateUserAuthorizationCache(
      assignment.user_id,
    );

    this.recordReviewAudit('approved', assignment, approvedById);

    this.emitRealtimeInvalidation(
      assignment.club_section_id,
      assignment.assignment_id,
      'UPDATED',
      approvedById,
    );

    return assignment;
  }

  /**
   * Reject a pending membership request.
   * Sets status to 'rejected', clears expires_at, and stores optional reason.
   *
   * Uses an atomic updateMany with the status guard in the WHERE clause to
   * prevent TOCTOU races where concurrent rejections both pass a prior findFirst
   * check and both succeed.
   *
   * Audit trail: the reviewer is recorded in audit_logs as
   * `membership_request.rejected` (actor = reviewer); club_role_assignments has
   * no rejected_by_id / rejected_at columns.
   */
  async reject(
    clubSectionId: number,
    assignmentId: string,
    rejectedById: string,
    reason?: string,
  ) {
    const { result, assignment } = await this.prisma.$transaction(
      async (tx) => {
        const result = await tx.club_role_assignments.updateMany({
          where: {
            assignment_id: assignmentId,
            club_section_id: clubSectionId,
            status: 'pending',
            active: true,
          },
          data: {
            status: 'rejected',
            expires_at: null,
            rejection_reason: reason ?? null,
            modified_at: new Date(),
          },
        });
        const assignment = await tx.club_role_assignments.findUnique({
          where: { assignment_id: assignmentId },
        });
        if (result.count > 0) {
          if (!assignment) {
            throw new AppNotFoundException(ErrorCode.MR_NOT_FOUND);
          }
          await this.authorizationContextVersion.bump(tx, assignment.user_id);
        }
        return { result, assignment };
      },
    );

    if (result.count === 0) {
      if (!assignment) {
        throw new AppNotFoundException(ErrorCode.MR_NOT_FOUND);
      }
      if (assignment.club_section_id !== clubSectionId) {
        throw new AppNotFoundException(ErrorCode.MR_NOT_FOUND);
      }
      throw new AppConflictException(ErrorCode.MR_ALREADY_PENDING);
    }
    // Unreachable (the transaction throws when it wrote without a row), but an
    // explicit check narrows the type on every compiler instead of `!`.
    if (!assignment) {
      throw new AppNotFoundException(ErrorCode.MR_NOT_FOUND);
    }

    await this.authorizationContext.invalidateUserAuthorizationCache(
      assignment.user_id,
    );

    this.recordReviewAudit('rejected', assignment, rejectedById);

    this.emitRealtimeInvalidation(
      assignment.club_section_id,
      assignment.assignment_id,
      'DELETED',
      rejectedById,
    );

    return assignment;
  }

  /**
   * Cancel the current user's pending request and reopen post-registration at
   * the club/section selection step. This is user-owned self-service, not an
   * administrative rejection.
   */
  async cancelPendingForUser(userId: string, actorId: string) {
    const now = new Date();

    const cancelledAssignment = await this.prisma.$transaction(async (tx) => {
      const pendingAssignment = await tx.club_role_assignments.findFirst({
        where: {
          user_id: userId,
          status: 'pending',
          active: true,
        },
        orderBy: { created_at: 'desc' },
      });

      if (!pendingAssignment) {
        throw new AppNotFoundException(ErrorCode.MR_NOT_FOUND);
      }

      const result = await tx.club_role_assignments.updateMany({
        where: {
          assignment_id: pendingAssignment.assignment_id,
          user_id: userId,
          status: 'pending',
          active: true,
        },
        data: {
          status: 'cancelled',
          active: false,
          expires_at: null,
          end_date: now,
          modified_at: now,
        },
      });

      if (result.count === 0) {
        throw new AppConflictException(ErrorCode.MR_ALREADY_PENDING);
      }

      await tx.users_pr.update({
        where: { user_id: userId },
        data: {
          club_selection_complete: false,
          complete: false,
          date_completed: null,
          active_club_assignment_id: null,
        },
      });

      await this.authorizationContextVersion.bump(tx, userId);

      return {
        ...pendingAssignment,
        status: 'cancelled',
        active: false,
        expires_at: null,
        end_date: now,
        modified_at: now,
      };
    });

    await this.authorizationContext.invalidateUserAuthorizationCache(userId);

    this.emitRealtimeInvalidation(
      cancelledAssignment.club_section_id,
      cancelledAssignment.assignment_id,
      'DELETED',
      actorId,
    );

    return cancelledAssignment;
  }

  async notifyNewRequestCreated(
    input: PendingMembershipRequestNotificationInput,
  ): Promise<void> {
    const consentPending = await this.hasConsentPending(input.userId);
    void this.notificationsService
      .sendToSectionRole(
        input.clubSectionId,
        [...MEMBERSHIP_REQUEST_REVIEWER_ROLES],
        consentPending
          ? 'Menor · consentimiento pendiente'
          : 'Nueva persona esperando aprobación',
        consentPending
          ? 'Hay una solicitud de un menor lista para revisar. Verifica la ficha de consentimiento firmada antes de aprobarla.'
          : 'Hay una solicitud de membresía lista para revisar en tu sección.',
        {
          type: 'membership_request_created',
          userId: input.userId,
          assignmentId: input.assignmentId,
          clubSectionId: String(input.clubSectionId),
        },
        'membership_requests:new_request',
      )
      .catch((error: unknown) => {
        this.logger.warn(
          `Membership request notification failed for assignment ${input.assignmentId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  /**
   * Is the requester a minor whose guardian consent is not verified yet? A
   * failed lookup only costs the specific copy, never the notification.
   */
  private async hasConsentPending(userId: string): Promise<boolean> {
    try {
      const consent = await this.consentGate.loadDependentConsent(this.prisma, [
        userId,
      ]);
      const state = consent.get(userId);
      return state !== undefined && state.verifiedAt === null;
    } catch (error) {
      this.logger.warn(
        `Consent lookup for the new-request notification failed (${userId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  /**
   * Auto-expire stale pending requests.
   *
   * The base timeout comes from system_config (key
   * 'membership.pending_timeout_days', default 8 days). Dependents are the
   * exception (FP-40, rulings A1/A11):
   *  - guardian consent NOT verified: the request lives 30 days from creation;
   *  - consent verified: the clock restarts, i.e. the base timeout is measured
   *    from max(created_at, verified_at), so a request that waited weeks for the
   *    paper form is not expired the moment the director verifies it;
   *  - everybody else: the base timeout from creation, unchanged.
   */
  async expireStaleRequests(): Promise<number> {
    const timeoutDays = await this.getPendingTimeoutDays();

    const now = new Date();
    const baseCutoff = addDays(now, -timeoutDays);

    const { count, userIds } = await this.prisma.$transaction(async (tx) => {
      // Nothing can expire before the base cutoff: dependents only get MORE time.
      const candidates = await tx.club_role_assignments.findMany({
        where: {
          status: 'pending',
          active: true,
          created_at: { lt: baseCutoff },
        },
        select: { assignment_id: true, user_id: true, created_at: true },
      });
      if (candidates.length === 0) return { count: 0, userIds: [] as string[] };

      const consent = await this.consentGate.loadDependentConsent(tx, [
        ...new Set(candidates.map(({ user_id }) => user_id)),
      ]);

      const expirableIds = candidates
        .filter(({ user_id, created_at }) =>
          isMembershipRequestExpired(
            {
              createdAt: created_at,
              timeoutDays,
              consent: consent.get(user_id),
            },
            now,
          ),
        )
        .map(({ assignment_id }) => assignment_id);
      if (expirableIds.length === 0)
        return { count: 0, userIds: [] as string[] };

      const affected = await tx.club_role_assignments.updateManyAndReturn({
        where: {
          assignment_id: { in: expirableIds },
          status: 'pending',
          active: true,
        },
        data: {
          status: 'expired',
          modified_at: new Date(),
        },
        select: { user_id: true },
      });
      const userIds = [...new Set(affected.map(({ user_id }) => user_id))];
      if (userIds.length) {
        await this.authorizationContextVersion.bumpMany(tx, userIds);
      }
      return { count: affected.length, userIds };
    });

    await Promise.all(
      userIds.map((userId) =>
        this.authorizationContext.invalidateUserAuthorizationCache(userId),
      ),
    );
    return count;
  }

  private async getPendingTimeoutDays(): Promise<number> {
    const config = await this.prisma.system_config.findUnique({
      where: { config_key: 'membership.pending_timeout_days' },
    });
    return parsePendingTimeoutDays(config?.config_value);
  }

  /**
   * Reviewer audit (FP-20): who approved/rejected, on whom, in which section.
   * a failing audit insert is logged and can never undo a review.
   */
  private recordReviewAudit(
    outcome: 'approved' | 'rejected',
    assignment: {
      assignment_id: string;
      user_id: string;
      club_section_id: number | null;
    },
    reviewerId: string,
  ): void {
    void this.auditLogs
      .recordEvent({
        entity_type: 'membership_request',
        entity_id: assignment.assignment_id,
        action: outcome,
        actor_user_id: reviewerId,
        actor_kind: 'user',
        target_user_id: assignment.user_id,
        summary: `Solicitud de membresía ${outcome === 'approved' ? 'aprobada' : 'rechazada'}`,
        changes: {
          club_section_id: assignment.club_section_id,
          from_status: 'pending',
          to_status: outcome === 'approved' ? 'active' : 'rejected',
        },
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Review audit failed for assignment ${assignment.assignment_id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  private emitRealtimeInvalidation(
    sectionId: number | null | undefined,
    entityId: number | string,
    action: 'CREATED' | 'UPDATED' | 'DELETED',
    actorId?: string,
  ): void {
    if (!sectionId) return;
    this.notificationsService
      .sendSilentToSection({
        sectionId,
        resource: 'members',
        action,
        entityId,
        actorId: actorId ?? 'system',
        timestamp: new Date().toISOString(),
      })
      .catch((err: Error) =>
        this.logger.error(
          `emitRealtimeInvalidation failed (section=${sectionId}, entity=${entityId}, action=${action}): ${err.message}`,
        ),
      );
  }
}

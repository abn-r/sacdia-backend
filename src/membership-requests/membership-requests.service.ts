import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class MembershipRequestsService {
  private readonly logger = new Logger(MembershipRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * List pending membership requests for a club section.
   */
  async listPending(clubSectionId: number) {
    return this.prisma.club_role_assignments.findMany({
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
  }

  /**
   * Approve a pending membership request.
   * Sets status to 'active' and clears expires_at.
   *
   * Uses an atomic updateMany with the status guard in the WHERE clause to
   * prevent TOCTOU races where concurrent approvals both pass a prior findFirst
   * check and both succeed.
   *
   * NOTE (audit trail): approvedById is accepted but not persisted — the schema
   * does not have approved_by_id / approved_at columns on club_role_assignments.
   * A separate migration is required to close this audit gap.
   */
  async approve(assignmentId: string, approvedById: string) {
    const [result, assignment] = await this.prisma.$transaction([
      this.prisma.club_role_assignments.updateMany({
        where: { assignment_id: assignmentId, status: 'pending', active: true },
        data: { status: 'active', expires_at: null, modified_at: new Date() },
      }),
      this.prisma.club_role_assignments.findUnique({
        where: { assignment_id: assignmentId },
      }),
    ]);

    if (result.count === 0) {
      if (!assignment) {
        throw new NotFoundException(
          `Membership request ${assignmentId} not found`,
        );
      }
      throw new ConflictException(
        `Request already ${assignment.status}`,
      );
    }

    await this.authorizationContext.invalidateUserAuthorizationCache(
      assignment!.user_id,
    );

    this.emitRealtimeInvalidation(assignment!.club_section_id, assignment!.assignment_id, 'UPDATED', approvedById);

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
   * NOTE (audit trail): rejectedById is accepted but not persisted — the schema
   * does not have rejected_by_id / rejected_at columns on club_role_assignments.
   * A separate migration is required to close this audit gap.
   */
  async reject(assignmentId: string, rejectedById: string, reason?: string) {
    const [result, assignment] = await this.prisma.$transaction([
      this.prisma.club_role_assignments.updateMany({
        where: { assignment_id: assignmentId, status: 'pending', active: true },
        data: {
          status: 'rejected',
          expires_at: null,
          rejection_reason: reason ?? null,
          modified_at: new Date(),
        },
      }),
      this.prisma.club_role_assignments.findUnique({
        where: { assignment_id: assignmentId },
      }),
    ]);

    if (result.count === 0) {
      if (!assignment) {
        throw new NotFoundException(
          `Membership request ${assignmentId} not found`,
        );
      }
      throw new ConflictException(
        `Request already ${assignment.status}`,
      );
    }

    await this.authorizationContext.invalidateUserAuthorizationCache(
      assignment!.user_id,
    );

    this.emitRealtimeInvalidation(assignment!.club_section_id, assignment!.assignment_id, 'DELETED', rejectedById);

    return assignment;
  }

  /**
   * Auto-expire pending requests older than configured days.
   * Reads timeout from system_config (key: 'membership.pending_timeout_days').
   * Defaults to 8 days if not configured.
   */
  async expireStaleRequests(): Promise<number> {
    const config = await this.prisma.system_config.findUnique({
      where: { config_key: 'membership.pending_timeout_days' },
    });

    const timeoutDays = config ? parseInt(config.config_value, 10) : 8;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - timeoutDays);

    const result = await this.prisma.club_role_assignments.updateMany({
      where: {
        status: 'pending',
        active: true,
        created_at: { lt: cutoff },
      },
      data: {
        status: 'expired',
        modified_at: new Date(),
      },
    });

    return result.count;
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

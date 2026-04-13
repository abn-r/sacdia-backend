import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';

@Injectable()
export class MembershipRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
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
   */
  async approve(assignmentId: string, approvedById: string) {
    const assignment = await this.prisma.club_role_assignments.findFirst({
      where: {
        assignment_id: assignmentId,
        status: 'pending',
        active: true,
      },
    });

    if (!assignment) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    const updated = await this.prisma.club_role_assignments.update({
      where: { assignment_id: assignmentId },
      data: {
        status: 'active',
        expires_at: null,
        modified_at: new Date(),
      },
    });

    await this.authorizationContext.invalidateUserAuthorizationCache(
      assignment.user_id,
    );

    return updated;
  }

  /**
   * Reject a pending membership request.
   * Sets status to 'rejected', clears expires_at, and stores optional reason.
   */
  async reject(assignmentId: string, rejectedById: string, reason?: string) {
    const assignment = await this.prisma.club_role_assignments.findFirst({
      where: {
        assignment_id: assignmentId,
        status: 'pending',
        active: true,
      },
    });

    if (!assignment) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    const updated = await this.prisma.club_role_assignments.update({
      where: { assignment_id: assignmentId },
      data: {
        status: 'rejected',
        expires_at: null,
        rejection_reason: reason ?? null,
        modified_at: new Date(),
      },
    });

    await this.authorizationContext.invalidateUserAuthorizationCache(
      assignment.user_id,
    );

    return updated;
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
}

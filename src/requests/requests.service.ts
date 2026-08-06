import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { AuthorizationContextVersionService } from '../common/authorization/authorization-context-version.service';

@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);
  private static readonly CANONICAL_ROLE_SLOT_LIMITS_BY_NAME: Record<
    string,
    number
  > = {
    director: 1,
    'deputy-director': 2,
    secretary: 1,
    treasurer: 1,
    'secretary-treasurer': 1,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly authorizationContextVersion: AuthorizationContextVersionService,
  ) {}

  // ========================================
  // CLUB TRANSFERS
  // ========================================

  async createTransferRequest(
    userId: string,
    fromSectionId: number | null,
    toSectionId: number,
    reason?: string,
  ) {
    const userAssignment = await this.resolveTransferSourceAssignment(
      userId,
      fromSectionId,
    );
    const resolvedFromSectionId = userAssignment.club_section_id;
    if (resolvedFromSectionId === null) {
      throw new AppBadRequestException(
        ErrorCode.REQUEST_TRANSFER_USER_NOT_IN_SECTION,
      );
    }

    if (resolvedFromSectionId === toSectionId) {
      throw new AppBadRequestException(ErrorCode.REQUEST_TRANSFER_SAME_SECTION);
    }

    const toSection = await this.prisma.club_sections.findUnique({
      where: { club_section_id: toSectionId },
      select: {
        club_section_id: true,
        club_type_id: true,
      },
    });

    if (!toSection) {
      throw new AppNotFoundException(
        ErrorCode.REQUEST_TRANSFER_SECTION_NOT_FOUND,
      );
    }

    if (
      userAssignment.club_sections?.club_type_id !== null &&
      userAssignment.club_sections?.club_type_id !== undefined &&
      userAssignment.club_sections.club_type_id !== toSection.club_type_id
    ) {
      throw new AppBadRequestException(
        ErrorCode.REQUEST_TRANSFER_TYPE_MISMATCH,
      );
    }

    // Check no pending request already exists for this user
    const pendingRequest = await this.prisma.club_transfer_requests.findFirst({
      where: {
        user_id: userId,
        status: 'pending',
      },
    });

    if (pendingRequest) {
      throw new AppConflictException(ErrorCode.REQUEST_TRANSFER_PENDING_EXISTS);
    }

    const requester = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: {
        name: true,
        paternal_last_name: true,
      },
    });

    const result = await this.prisma.club_transfer_requests.create({
      data: {
        user_id: userId,
        from_section_id: resolvedFromSectionId,
        to_section_id: toSectionId,
        reason,
      },
    });

    // Notify destination directors: they decide whether the member can join.
    try {
      const requesterName = [requester?.name, requester?.paternal_last_name]
        .filter(Boolean)
        .join(' ')
        .trim();

      void this.notifications.sendToSectionRole(
        toSectionId,
        ['director'],
        'Alguien quiere unirse a tu club',
        `${requesterName || 'Un miembro'} está esperando revisión para integrarse a tu club`,
        {
          type: 'transfer',
          entity_id: result.transfer_request_id,
          status: 'pending',
          route: `/transfer/${result.transfer_request_id}`,
        },
        'requests:transfer_created',
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Notification failed for transfer request ${result.transfer_request_id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return result;
  }

  private async resolveTransferSourceAssignment(
    userId: string,
    fromSectionId: number | null,
  ) {
    const activeContext = await this.prisma.users_pr.findUnique({
      where: { user_id: userId },
      select: { active_club_assignment_id: true },
    });

    const baseWhere = {
      user_id: userId,
      active: true,
      status: 'active',
      club_section_id: { not: null },
    } satisfies Prisma.club_role_assignmentsWhereInput;

    const select = {
      assignment_id: true,
      club_section_id: true,
      club_sections: {
        select: {
          club_type_id: true,
        },
      },
    } satisfies Prisma.club_role_assignmentsSelect;

    const byExplicitSection =
      fromSectionId !== null
        ? await this.prisma.club_role_assignments.findFirst({
            where: {
              ...baseWhere,
              club_section_id: fromSectionId,
            },
            select,
          })
        : null;

    if (fromSectionId !== null) {
      if (!byExplicitSection?.club_section_id) {
        throw new AppBadRequestException(
          ErrorCode.REQUEST_TRANSFER_USER_NOT_IN_SECTION,
        );
      }
      return byExplicitSection;
    }

    const byActiveContext = activeContext?.active_club_assignment_id
      ? await this.prisma.club_role_assignments.findFirst({
          where: {
            ...baseWhere,
            assignment_id: activeContext.active_club_assignment_id,
          },
          select,
        })
      : null;

    const fallback =
      byActiveContext ??
      (await this.prisma.club_role_assignments.findFirst({
        where: baseWhere,
        orderBy: { start_date: 'desc' },
        select,
      }));

    if (!fallback?.club_section_id) {
      throw new AppBadRequestException(
        ErrorCode.REQUEST_TRANSFER_USER_NOT_IN_SECTION,
      );
    }

    return fallback;
  }

  async reviewTransfer(
    requestId: string,
    reviewerId: string,
    action: 'approved' | 'rejected',
    comment?: string,
  ) {
    const request = await this.prisma.club_transfer_requests.findUnique({
      where: { transfer_request_id: requestId },
      include: {
        user: { select: { user_id: true, name: true } },
      },
    });

    if (!request) {
      throw new AppNotFoundException(ErrorCode.REQUEST_TRANSFER_NOT_FOUND);
    }

    if (request.status !== 'pending') {
      throw new AppConflictException(
        ErrorCode.REQUEST_TRANSFER_ALREADY_REVIEWED,
      );
    }

    await this.assertCanReadTransferSection(reviewerId, request.to_section_id);

    let result;
    let affectedAuthorizationUserIds: string[] = [];

    if (action === 'approved') {
      // Move the section context only. The user's current class/enrollment is
      // intentionally preserved; a club transfer must not recalculate the
      // progressive class by age.
      const approved = await this.prisma.$transaction(async (tx) => {
        // Update all active role assignments from old section to new section
        const affectedAssignments =
          await tx.club_role_assignments.updateManyAndReturn({
            where: {
              user_id: request.user_id,
              club_section_id: request.from_section_id,
              active: true,
              status: 'active',
            },
            data: {
              club_section_id: request.to_section_id,
              modified_at: new Date(),
            },
            select: { user_id: true },
          });
        const userIds = [
          ...new Set(affectedAssignments.map(({ user_id }) => user_id)),
        ];
        for (const userId of userIds) {
          await this.authorizationContextVersion.bump(tx, userId);
        }

        // Update the transfer request status
        const updated = await tx.club_transfer_requests.update({
          where: { transfer_request_id: requestId },
          data: {
            status: 'approved',
            reviewed_by: reviewerId,
            review_comment: comment,
            reviewed_at: new Date(),
          },
          include: {
            user: {
              select: {
                user_id: true,
                name: true,
                paternal_last_name: true,
              },
            },
            from_section: {
              include: { club_types: { select: { name: true } } },
            },
            to_section: {
              include: { club_types: { select: { name: true } } },
            },
            reviewer: {
              select: {
                user_id: true,
                name: true,
                paternal_last_name: true,
              },
            },
          },
        });

        this.logger.log(
          `Transfer approved: user ${request.user_id} moved from section ${request.from_section_id} to ${request.to_section_id}`,
        );

        return { updated, userIds };
      });
      result = approved.updated;
      affectedAuthorizationUserIds = approved.userIds;
    } else {
      // Rejected
      result = await this.prisma.club_transfer_requests.update({
        where: { transfer_request_id: requestId },
        data: {
          status: 'rejected',
          reviewed_by: reviewerId,
          review_comment: comment,
          reviewed_at: new Date(),
        },
        include: {
          user: {
            select: {
              user_id: true,
              name: true,
              paternal_last_name: true,
            },
          },
          from_section: {
            include: { club_types: { select: { name: true } } },
          },
          to_section: {
            include: { club_types: { select: { name: true } } },
          },
          reviewer: {
            select: {
              user_id: true,
              name: true,
              paternal_last_name: true,
            },
          },
        },
      });
    }

    await Promise.all(
      affectedAuthorizationUserIds.map((userId) =>
        this.authorizationContext.invalidateUserAuthorizationCache(userId),
      ),
    );

    // Notify the member about the transfer decision
    try {
      const title =
        action === 'approved'
          ? 'Tu traslado fue aprobado'
          : 'Tu traslado necesita revisión';
      const body =
        action === 'approved'
          ? 'Ya puedes continuar tu camino en el nuevo club.'
          : `Tu solicitud de traslado necesita revisión${comment ? ': ' + comment : '.'}`;

      void this.notifications.notifySafe(
        request.user_id,
        title,
        body,
        {
          type: 'transfer',
          entity_id: requestId,
          action,
          route: `/transfer/${requestId}`,
        },
        `requests:transfer_${action}`,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Notification failed for transfer review ${requestId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return result;
  }

  async getTransferRequests(filters: {
    userId: string;
    status?: string;
    sectionId?: number;
  }) {
    const where: Record<string, unknown> = {};

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.sectionId) {
      await this.assertCanReadTransferSection(
        filters.userId,
        filters.sectionId,
      );
      where.OR = [
        { from_section_id: filters.sectionId },
        { to_section_id: filters.sectionId },
      ];
    } else {
      where.user_id = filters.userId;
    }

    return this.prisma.club_transfer_requests.findMany({
      where,
      include: {
        user: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
          },
        },
        from_section: {
          include: {
            club_types: { select: { name: true } },
            clubs: { select: { name: true } },
          },
        },
        to_section: {
          include: {
            club_types: { select: { name: true } },
            clubs: { select: { name: true } },
          },
        },
        reviewer: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async getTransferRequest(requestId: string, viewerId: string) {
    const request = await this.prisma.club_transfer_requests.findUnique({
      where: { transfer_request_id: requestId },
      include: {
        user: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            email: true,
          },
        },
        from_section: {
          include: {
            club_types: { select: { name: true } },
            clubs: { select: { name: true } },
          },
        },
        to_section: {
          include: {
            club_types: { select: { name: true } },
            clubs: { select: { name: true } },
          },
        },
        reviewer: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
          },
        },
      },
    });

    if (!request) {
      throw new AppNotFoundException(ErrorCode.REQUEST_TRANSFER_NOT_FOUND);
    }

    if (request.user_id !== viewerId) {
      await this.assertCanReadTransferSection(viewerId, request.to_section_id);
    }

    return request;
  }

  private async assertCanReadTransferSection(
    viewerId: string,
    sectionId: number,
  ) {
    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: { main_club_id: true },
    });

    if (!section || typeof section.main_club_id !== 'number') {
      throw new AppNotFoundException(
        ErrorCode.REQUEST_TRANSFER_SECTION_NOT_FOUND,
      );
    }

    if (
      await this.authorizationContext.canManageClub(
        viewerId,
        section.main_club_id,
      )
    ) {
      return;
    }

    const authorization =
      await this.authorizationContext.resolveUserAuthorization(viewerId);
    const canReadSection =
      authorization.authorization.grants.club_assignments.some(
        (assignment) =>
          assignment.status === 'active' &&
          assignment.section.club_section_id === sectionId,
      );

    if (!canReadSection) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
  }

  // ========================================
  // ROLE ASSIGNMENTS
  // ========================================

  async createAssignmentRequest(
    sectionId: number,
    userId: string,
    roleId: string,
    requestedBy: string,
  ) {
    // Validate section exists
    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
    });

    if (!section) {
      throw new AppNotFoundException(ErrorCode.REQUEST_SECTION_NOT_FOUND);
    }

    // Validate user exists
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: { user_id: true },
    });

    if (!user) {
      throw new AppNotFoundException(ErrorCode.REQUEST_USER_NOT_FOUND);
    }

    // Validate role exists
    const role = await this.prisma.roles.findUnique({
      where: { role_id: roleId },
      select: { role_id: true, role_name: true },
    });

    if (!role) {
      throw new AppNotFoundException(ErrorCode.REQUEST_ROLE_NOT_FOUND);
    }

    // Check role_slot_limits before creating request
    await this.validateRoleSlotForRequest(sectionId, roleId, {
      includePendingRequests: true,
    });

    // Check no pending request for same user + role + section
    const pendingRequest = await this.prisma.role_assignment_requests.findFirst(
      {
        where: {
          club_section_id: sectionId,
          user_id: userId,
          role_id: roleId,
          status: 'pending',
        },
      },
    );

    if (pendingRequest) {
      throw new AppConflictException(
        ErrorCode.REQUEST_ASSIGNMENT_PENDING_EXISTS,
      );
    }

    const result = await this.prisma.role_assignment_requests.create({
      data: {
        club_section_id: sectionId,
        user_id: userId,
        role_id: roleId,
        requested_by: requestedBy,
      },
      include: {
        user: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
          },
        },
        role: { select: { role_id: true, role_name: true } },
        requester: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
          },
        },
        club_section: {
          include: { club_types: { select: { name: true } } },
        },
      },
    });

    // Notify directors (approvers) of the section about the new assignment request
    try {
      const userName = `${result.user.name} ${result.user.paternal_last_name}`;
      void this.notifications.sendToSectionRole(
        sectionId,
        ['director'],
        'Hay un rol pendiente por revisar',
        `Revisa la solicitud para asignar ${result.role.role_name} a ${userName}`,
        { type: 'assignment', entity_id: result.request_id, status: 'pending' },
        'requests:assignment_created',
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Notification failed for assignment request ${result.request_id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return result;
  }

  async reviewAssignment(
    requestId: string,
    approverId: string,
    action: 'approved' | 'rejected',
    comment?: string,
  ) {
    const request = await this.prisma.role_assignment_requests.findUnique({
      where: { request_id: requestId },
      include: {
        role: { select: { role_id: true, role_name: true } },
      },
    });

    if (!request) {
      throw new AppNotFoundException(ErrorCode.REQUEST_ASSIGNMENT_NOT_FOUND);
    }

    if (request.status !== 'pending') {
      throw new AppConflictException(
        ErrorCode.REQUEST_ASSIGNMENT_ALREADY_REVIEWED,
      );
    }

    let result;
    let affectedAuthorizationUserIds: string[] = [];

    if (action === 'approved') {
      const approved = await this.prisma.$transaction(async (tx) => {
        // Re-validate role limits/exclusivity at approval time in case section
        // leadership changed after the request was created.
        await this.validateRoleSlotForRequest(
          request.club_section_id,
          request.role_id,
          { client: tx, includePendingRequests: false },
        );

        const ecclesiasticalYearId =
          await this.getActiveEcclesiasticalYearId(tx);

        // Create the club_role_assignment
        const assignment = await tx.club_role_assignments.create({
          data: {
            user_id: request.user_id,
            role_id: request.role_id,
            club_section_id: request.club_section_id,
            ecclesiastical_year_id: ecclesiasticalYearId,
            start_date: new Date(),
            active: true,
            status: 'active',
          },
          select: { user_id: true },
        });
        await this.authorizationContextVersion.bump(tx, assignment.user_id);

        // Update the request status
        const updated = await tx.role_assignment_requests.update({
          where: { request_id: requestId },
          data: {
            status: 'approved',
            approved_by: approverId,
            comment,
            reviewed_at: new Date(),
          },
          include: {
            user: {
              select: {
                user_id: true,
                name: true,
                paternal_last_name: true,
              },
            },
            role: { select: { role_id: true, role_name: true } },
            requester: {
              select: {
                user_id: true,
                name: true,
                paternal_last_name: true,
              },
            },
            approver: {
              select: {
                user_id: true,
                name: true,
                paternal_last_name: true,
              },
            },
            club_section: {
              include: { club_types: { select: { name: true } } },
            },
          },
        });

        this.logger.log(
          `Role assignment approved: user ${request.user_id} assigned role ${request.role_id} in section ${request.club_section_id}`,
        );

        return { updated, userId: assignment.user_id };
      });
      result = approved.updated;
      affectedAuthorizationUserIds = [approved.userId];
    } else {
      // Rejected
      result = await this.prisma.role_assignment_requests.update({
        where: { request_id: requestId },
        data: {
          status: 'rejected',
          approved_by: approverId,
          comment,
          reviewed_at: new Date(),
        },
        include: {
          user: {
            select: {
              user_id: true,
              name: true,
              paternal_last_name: true,
            },
          },
          role: { select: { role_id: true, role_name: true } },
          requester: {
            select: {
              user_id: true,
              name: true,
              paternal_last_name: true,
            },
          },
          approver: {
            select: {
              user_id: true,
              name: true,
              paternal_last_name: true,
            },
          },
          club_section: {
            include: { club_types: { select: { name: true } } },
          },
        },
      });
    }

    await Promise.all(
      affectedAuthorizationUserIds.map((userId) =>
        this.authorizationContext.invalidateUserAuthorizationCache(userId),
      ),
    );

    // Notify the requester and the target user about the decision
    try {
      const roleName = request.role.role_name;
      const title = action === 'approved' ? 'Rol aprobado' : 'Rol en revisión';
      const body =
        action === 'approved'
          ? `La asignación del rol ${roleName} fue aprobada`
          : `La asignación del rol ${roleName} necesita revisión${comment ? ': ' + comment : '.'}`;
      const notifData = { type: 'assignment', entity_id: requestId, action };

      const assignmentSource = `requests:assignment_${action}`;

      // Notify the requester (assistant-lf or whoever requested)
      void this.notifications.notifySafe(
        request.requested_by,
        title,
        body,
        notifData,
        assignmentSource,
      );

      // Notify the target user (the person being assigned)
      if (request.user_id !== request.requested_by) {
        void this.notifications.notifySafe(
          request.user_id,
          title,
          body,
          notifData,
          assignmentSource,
        );
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Notification failed for assignment review ${requestId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return result;
  }

  async getAssignmentRequests(filters?: {
    status?: string;
    sectionId?: number;
  }) {
    const where: Record<string, unknown> = {};

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.sectionId) {
      where.club_section_id = filters.sectionId;
    }

    return this.prisma.role_assignment_requests.findMany({
      where,
      include: {
        user: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
          },
        },
        role: { select: { role_id: true, role_name: true } },
        requester: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
          },
        },
        approver: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
          },
        },
        club_section: {
          include: {
            club_types: { select: { name: true } },
            clubs: { select: { name: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async getAssignmentRequest(requestId: string) {
    const request = await this.prisma.role_assignment_requests.findUnique({
      where: { request_id: requestId },
      include: {
        user: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            email: true,
          },
        },
        role: { select: { role_id: true, role_name: true } },
        requester: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
          },
        },
        approver: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
          },
        },
        club_section: {
          include: {
            club_types: { select: { name: true } },
            clubs: { select: { name: true } },
          },
        },
      },
    });

    if (!request) {
      throw new AppNotFoundException(ErrorCode.REQUEST_ASSIGNMENT_NOT_FOUND);
    }

    return request;
  }

  // ========================================
  // HELPERS
  // ========================================

  private async validateRoleSlotForRequest(
    sectionId: number,
    roleId: string,
    options: {
      client?: PrismaService | Prisma.TransactionClient;
      includePendingRequests?: boolean;
    } = {},
  ): Promise<void> {
    const client = options.client ?? this.prisma;
    const role = await client.roles.findUnique({
      where: { role_id: roleId },
      select: { role_name: true },
    });

    if (!role) return;

    const roleName = role.role_name.toLowerCase();
    const slotLimit = await client.role_slot_limits.findUnique({
      where: { role_id: roleId },
    });
    const maxPerSection = this.getEffectiveMaxPerSection(
      roleName,
      slotLimit?.max_per_section,
    );

    if (maxPerSection != null) {
      // Count current active assignments
      const currentCount = await client.club_role_assignments.count({
        where: {
          club_section_id: sectionId,
          role_id: roleId,
          active: true,
        },
      });

      // Also count pending requests for same role+section
      const pendingCount = options.includePendingRequests
        ? await client.role_assignment_requests.count({
            where: {
              club_section_id: sectionId,
              role_id: roleId,
              status: 'pending',
            },
          })
        : 0;

      if (currentCount + pendingCount >= maxPerSection) {
        throw new AppConflictException(
          ErrorCode.REQUEST_ROLE_SLOT_LIMIT_REACHED,
        );
      }
    }

    await this.validateRoleExclusivityForRequest(client, sectionId, roleName);
  }

  private async validateRoleExclusivityForRequest(
    client: PrismaService | Prisma.TransactionClient,
    sectionId: number,
    roleName: string,
  ): Promise<void> {
    const conflictingRoleNames =
      roleName === 'secretary' || roleName === 'treasurer'
        ? ['secretary-treasurer']
        : roleName === 'secretary-treasurer'
          ? ['secretary', 'treasurer']
          : [];

    if (conflictingRoleNames.length === 0) return;

    const conflictingRoles = await client.roles.findMany({
      where: { role_name: { in: conflictingRoleNames }, active: true },
      select: { role_id: true },
    });

    if (conflictingRoles.length === 0) return;

    const existingConflict = await client.club_role_assignments.findFirst({
      where: {
        club_section_id: sectionId,
        role_id: { in: conflictingRoles.map((item) => item.role_id) },
        active: true,
      },
    });

    if (existingConflict) {
      throw new AppConflictException(ErrorCode.CLUB_ROLE_EXCLUSIVE_CONFLICT);
    }
  }

  private getEffectiveMaxPerSection(
    roleName: string,
    configuredMax: number | null | undefined,
  ): number | null {
    return (
      configuredMax ??
      RequestsService.CANONICAL_ROLE_SLOT_LIMITS_BY_NAME[roleName] ??
      null
    );
  }

  private async getActiveEcclesiasticalYearId(
    tx?: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
  ): Promise<number> {
    const prisma = tx ?? this.prisma;
    const currentYear = await prisma.ecclesiastical_years.findFirst({
      where: {
        start_date: { lte: new Date() },
        end_date: { gte: new Date() },
      },
      select: { year_id: true },
    });

    if (!currentYear) {
      throw new AppBadRequestException(ErrorCode.REQUEST_NO_ACTIVE_YEAR);
    }

    return currentYear.year_id;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ClassAssignmentResolverService } from '../common/services/class-assignment-resolver.service';

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
    private readonly classAssignmentResolver: ClassAssignmentResolverService,
  ) {}

  // ========================================
  // CLUB TRANSFERS
  // ========================================

  async createTransferRequest(
    userId: string,
    fromSectionId: number,
    toSectionId: number,
    reason?: string,
  ) {
    if (fromSectionId === toSectionId) {
      throw new AppBadRequestException(ErrorCode.REQUEST_TRANSFER_SAME_SECTION);
    }

    // Validate user has an active role assignment in from_section
    const userAssignment = await this.prisma.club_role_assignments.findFirst({
      where: {
        user_id: userId,
        club_section_id: fromSectionId,
        active: true,
      },
    });

    if (!userAssignment) {
      throw new AppBadRequestException(
        ErrorCode.REQUEST_TRANSFER_USER_NOT_IN_SECTION,
      );
    }

    // Validate to_section exists
    const toSection = await this.prisma.club_sections.findUnique({
      where: { club_section_id: toSectionId },
    });

    if (!toSection) {
      throw new AppNotFoundException(
        ErrorCode.REQUEST_TRANSFER_SECTION_NOT_FOUND,
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

    const result = await this.prisma.club_transfer_requests.create({
      data: {
        user_id: userId,
        from_section_id: fromSectionId,
        to_section_id: toSectionId,
        reason,
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
      },
    });

    // Notify director of from_section about the transfer request
    try {
      void this.notifications.sendToSectionRole(
        fromSectionId,
        ['director'],
        'Nueva solicitud de traslado',
        `${result.user.name} ${result.user.paternal_last_name} ha solicitado un traslado`,
        {
          type: 'transfer',
          entity_id: result.transfer_request_id,
          status: 'pending',
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

    let result;

    if (action === 'approved') {
      // Move user's club_role_assignments from old section to new section in a transaction
      result = await this.prisma.$transaction(async (tx) => {
        // Update all active role assignments from old section to new section
        await tx.club_role_assignments.updateMany({
          where: {
            user_id: request.user_id,
            club_section_id: request.from_section_id,
            active: true,
          },
          data: {
            club_section_id: request.to_section_id,
            modified_at: new Date(),
          },
        });

        await this.resolveTransferOperationalEnrollment(tx, {
          userId: request.user_id,
          clubSectionId: request.to_section_id,
        });

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

        return updated;
      });
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

    // Notify the member about the transfer decision
    try {
      const title =
        action === 'approved' ? 'Traslado aprobado' : 'Traslado rechazado';
      const body =
        action === 'approved'
          ? 'Tu solicitud de traslado ha sido aprobada'
          : `Tu solicitud de traslado ha sido rechazada${comment ? ': ' + comment : ''}`;

      void this.notifications.notifySafe(
        request.user_id,
        title,
        body,
        { type: 'transfer', entity_id: requestId, action },
        `requests:transfer_${action}`,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Notification failed for transfer review ${requestId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return result;
  }

  private async resolveTransferOperationalEnrollment(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      clubSectionId: number;
    },
  ) {
    const now = new Date();
    const currentYear = await tx.ecclesiastical_years.findFirst({
      where: {
        start_date: { lte: now },
        end_date: { gte: now },
      },
      select: {
        year_id: true,
        start_date: true,
      },
    });

    if (!currentYear) {
      throw new AppBadRequestException(ErrorCode.POST_REG_NO_ACTIVE_YEAR);
    }

    const targetSection = await tx.club_sections.findUnique({
      where: { club_section_id: params.clubSectionId },
      select: { club_type_id: true },
    });

    if (!targetSection) {
      throw new AppNotFoundException(
        ErrorCode.REQUEST_TRANSFER_SECTION_NOT_FOUND,
      );
    }

    const expectedClassId =
      await this.classAssignmentResolver.resolveClassIdForUserClubType(tx, {
        userId: params.userId,
        clubTypeId: targetSection.club_type_id,
        currentYear,
        userNotFoundExceptionFactory: () =>
          new AppNotFoundException(ErrorCode.USER_NOT_FOUND),
      });

    await tx.enrollments.updateMany({
      where: {
        user_id: params.userId,
        ecclesiastical_year_id: currentYear.year_id,
        active: true,
        NOT: { class_id: expectedClassId },
      },
      data: { active: false },
    });

    const enrollmentWhere = {
      user_id_class_id_ecclesiastical_year_id: {
        user_id: params.userId,
        class_id: expectedClassId,
        ecclesiastical_year_id: currentYear.year_id,
      },
    };

    const existingEnrollment = await tx.enrollments.findUnique({
      where: enrollmentWhere,
      select: {
        enrollment_id: true,
        active: true,
      },
    });

    if (existingEnrollment) {
      if (!existingEnrollment.active) {
        await tx.enrollments.update({
          where: { enrollment_id: existingEnrollment.enrollment_id },
          data: { active: true },
        });
      }
      return;
    }

    await tx.enrollments.create({
      data: {
        user_id: params.userId,
        class_id: expectedClassId,
        ecclesiastical_year_id: currentYear.year_id,
      },
    });
  }

  async getTransferRequests(filters?: { status?: string; sectionId?: number }) {
    const where: Record<string, unknown> = {};

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.sectionId) {
      where.OR = [
        { from_section_id: filters.sectionId },
        { to_section_id: filters.sectionId },
      ];
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

  async getTransferRequest(requestId: string) {
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

    return request;
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
        'Nueva solicitud de asignación de rol',
        `Se ha solicitado asignar el rol ${result.role.role_name} a ${userName}`,
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

    if (action === 'approved') {
      result = await this.prisma.$transaction(async (tx) => {
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
        await tx.club_role_assignments.create({
          data: {
            user_id: request.user_id,
            role_id: request.role_id,
            club_section_id: request.club_section_id,
            ecclesiastical_year_id: ecclesiasticalYearId,
            start_date: new Date(),
            active: true,
            status: 'active',
          },
        });

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

        return updated;
      });
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

    // Notify the requester and the target user about the decision
    try {
      const roleName = request.role.role_name;
      const title =
        action === 'approved'
          ? 'Asignación de rol aprobada'
          : 'Asignación de rol rechazada';
      const body =
        action === 'approved'
          ? `La asignación del rol ${roleName} ha sido aprobada`
          : `La asignación del rol ${roleName} ha sido rechazada${comment ? ': ' + comment : ''}`;
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

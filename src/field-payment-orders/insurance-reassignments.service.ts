import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { assertSameClubTransfer } from '../insurance/domain/insurance-policy';
import { PrismaService } from '../prisma/prisma.service';
import type { OrderActor } from './order-actor';

export interface CreateReassignmentInput {
  insurance_assignment_id: number;
  to_user_id: string;
  reason?: string;
}

/**
 * Reasignación de coberturas activas (plan base Task 2.3): el club solicita
 * mover una assignment ACTIVE a otro miembro del mismo club; el Campo Local
 * revisa. El approve cierra la assignment vieja (RELEASED) y abre una nueva
 * ACTIVE sobre el mismo slot, en una sola TX.
 */
@Injectable()
export class InsuranceReassignmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateReassignmentInput, actor: OrderActor) {
    const assignment = await this.prisma.insurance_assignments.findUnique({
      where: { insurance_assignment_id: input.insurance_assignment_id },
      include: {
        coverage_slot: {
          select: {
            insurance_coverage_slot_id: true,
            current_section_id: true,
            purchase: { select: { insurance_cycle_config_id: true } },
          },
        },
      },
    });
    if (!assignment) {
      throw new AppNotFoundException(
        ErrorCode.INSURANCE_REASSIGNMENT_NOT_FOUND,
      );
    }
    if (
      assignment.status !== 'ACTIVE' ||
      assignment.subject_type !== 'MEMBER' ||
      !assignment.user_id
    ) {
      throw new AppBadRequestException(
        ErrorCode.INSURANCE_REASSIGNMENT_INVALID,
        { reason: 'assignment_not_active_member' },
      );
    }
    if (assignment.user_id === input.to_user_id) {
      throw new AppBadRequestException(
        ErrorCode.INSURANCE_REASSIGNMENT_INVALID,
        { reason: 'same_user' },
      );
    }

    const currentSectionId = assignment.coverage_slot.current_section_id;
    if (
      !actor.globalAccess &&
      !actor.sectionIds.includes(currentSectionId) &&
      !(actor.canReview && typeof actor.localFieldId === 'number')
    ) {
      throw new AppForbiddenException(ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN);
    }

    await this.assertSameClubDestination(
      this.prisma,
      currentSectionId,
      input.to_user_id,
    );
    await this.assertDestinationNotCovered(
      this.prisma,
      assignment.coverage_slot.purchase.insurance_cycle_config_id,
      input.to_user_id,
    );

    try {
      return await this.prisma.insurance_reassignment_requests.create({
        data: {
          insurance_assignment_id: input.insurance_assignment_id,
          from_user_id: assignment.user_id,
          to_user_id: input.to_user_id,
          reason: input.reason?.trim() || null,
          status: 'PENDING',
          requested_by_id: actor.userId,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppConflictException(
          ErrorCode.INSURANCE_REASSIGNMENT_PENDING_EXISTS,
        );
      }
      throw error;
    }
  }

  async list(
    filters: { status?: 'PENDING' | 'APPROVED' | 'REJECTED' },
    actor: OrderActor,
  ) {
    const requests = await this.prisma.insurance_reassignment_requests.findMany(
      {
        where: filters.status ? { status: filters.status } : {},
        orderBy: { created_at: 'asc' },
      },
    );
    if (actor.globalAccess) {
      return requests;
    }

    if (requests.length === 0) {
      return requests;
    }
    const assignments = await this.prisma.insurance_assignments.findMany({
      where: {
        insurance_assignment_id: {
          in: requests.map((request) => request.insurance_assignment_id),
        },
      },
      select: {
        insurance_assignment_id: true,
        coverage_slot: {
          select: {
            current_section_id: true,
            current_section: {
              select: { clubs: { select: { local_field_id: true } } },
            },
          },
        },
      },
    });
    const byId = new Map(
      assignments.map((assignment) => [
        assignment.insurance_assignment_id,
        assignment,
      ]),
    );

    return requests.filter((request) => {
      const assignment = byId.get(request.insurance_assignment_id);
      if (!assignment) {
        return false;
      }
      if (actor.canReview) {
        return (
          assignment.coverage_slot.current_section?.clubs?.local_field_id ===
          actor.localFieldId
        );
      }
      return (
        actor.sectionIds.includes(assignment.coverage_slot.current_section_id) ||
        request.requested_by_id === actor.userId
      );
    });
  }

  async approve(requestId: number, actor: OrderActor) {
    this.requireReviewer(actor);
    const request = await this.findRequest(requestId);
    if (request.status !== 'PENDING') {
      throw new AppConflictException(ErrorCode.INSURANCE_REASSIGNMENT_INVALID, {
        reason: 'request_not_pending',
      });
    }

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.insurance_assignments.findUnique({
        where: {
          insurance_assignment_id: request.insurance_assignment_id,
        },
        include: {
          coverage_slot: {
            select: {
              insurance_coverage_slot_id: true,
              current_section_id: true,
            },
          },
        },
      });
      if (!assignment || assignment.status !== 'ACTIVE') {
        throw new AppConflictException(
          ErrorCode.INSURANCE_REASSIGNMENT_INVALID,
          { reason: 'assignment_no_longer_active' },
        );
      }
      await this.assertSameClubDestination(
        tx as unknown as PrismaService,
        assignment.coverage_slot.current_section_id,
        request.to_user_id,
      );

      await tx.insurance_assignments.update({
        where: {
          insurance_assignment_id: assignment.insurance_assignment_id,
        },
        data: {
          status: 'RELEASED',
          release_reason: `Reassigned to ${request.to_user_id} (request #${requestId})`,
          modified_by_id: actor.userId,
        },
      });

      const replacement = await tx.insurance_assignments.create({
        data: {
          insurance_coverage_slot_id:
            assignment.coverage_slot.insurance_coverage_slot_id,
          subject_type: 'MEMBER',
          user_id: request.to_user_id,
          valid_from: now,
          valid_until: assignment.valid_until,
          status: 'ACTIVE',
          assigned_by_id: actor.userId,
          confirmed_by_id: actor.userId,
          confirmed_at: now,
          created_by_id: actor.userId,
          modified_by_id: actor.userId,
        },
      });

      await tx.insurance_slot_movements.createMany({
        data: [
          {
            insurance_coverage_slot_id:
              assignment.coverage_slot.insurance_coverage_slot_id,
            movement_type: 'REASSIGNED',
            from_section_id: assignment.coverage_slot.current_section_id,
            to_section_id: assignment.coverage_slot.current_section_id,
            insurance_assignment_id: replacement.insurance_assignment_id,
            reason: `Reassignment request #${requestId} approved`,
            performed_by_id: actor.userId,
          },
        ],
      });

      return tx.insurance_reassignment_requests.update({
        where: { insurance_reassignment_request_id: requestId },
        data: {
          status: 'APPROVED',
          reviewed_by_id: actor.userId,
          reviewed_at: now,
        },
      });
    });
  }

  async reject(requestId: number, comment: string, actor: OrderActor) {
    this.requireReviewer(actor);
    if (!comment?.trim()) {
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_REJECT_REASON_REQUIRED,
      );
    }
    const request = await this.findRequest(requestId);
    if (request.status !== 'PENDING') {
      throw new AppConflictException(ErrorCode.INSURANCE_REASSIGNMENT_INVALID, {
        reason: 'request_not_pending',
      });
    }
    return this.prisma.insurance_reassignment_requests.update({
      where: { insurance_reassignment_request_id: requestId },
      data: {
        status: 'REJECTED',
        review_comment: comment.trim(),
        reviewed_by_id: actor.userId,
        reviewed_at: new Date(),
      },
    });
  }

  private async findRequest(requestId: number) {
    const request =
      await this.prisma.insurance_reassignment_requests.findUnique({
        where: { insurance_reassignment_request_id: requestId },
      });
    if (!request) {
      throw new AppNotFoundException(
        ErrorCode.INSURANCE_REASSIGNMENT_NOT_FOUND,
      );
    }
    return request;
  }

  private requireReviewer(actor: OrderActor) {
    if (!actor.canReview && !actor.globalAccess) {
      throw new AppForbiddenException(ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN);
    }
  }

  /** Destination member must belong to the same main club (assertSameClubTransfer). */
  private async assertSameClubDestination(
    db: Pick<PrismaService, 'club_sections' | 'club_role_assignments'>,
    currentSectionId: number,
    toUserId: string,
  ): Promise<void> {
    const sourceSection = await db.club_sections.findUnique({
      where: { club_section_id: currentSectionId },
      select: { main_club_id: true },
    });
    if (!sourceSection?.main_club_id) {
      throw new AppBadRequestException(
        ErrorCode.INSURANCE_REASSIGNMENT_INVALID,
        { reason: 'source_section_without_club' },
      );
    }

    const destinationMemberships = await db.club_role_assignments.findMany({
      where: {
        user_id: toUserId,
        active: true,
        status: 'active',
        club_section_id: { not: null },
      },
      select: {
        club_sections: { select: { main_club_id: true } },
      },
    });
    const destination = destinationMemberships.find(
      (membership) =>
        membership.club_sections?.main_club_id === sourceSection.main_club_id,
    );
    if (!destination?.club_sections?.main_club_id) {
      throw new AppBadRequestException(
        ErrorCode.INSURANCE_REASSIGNMENT_INVALID,
        { reason: 'destination_not_in_same_club' },
      );
    }
    assertSameClubTransfer(
      { main_club_id: sourceSection.main_club_id },
      { main_club_id: destination.club_sections.main_club_id },
    );
  }

  private async assertDestinationNotCovered(
    db: Pick<PrismaService, 'insurance_assignments'>,
    cycleConfigId: number,
    toUserId: string,
  ): Promise<void> {
    const covered = await db.insurance_assignments.findFirst({
      where: {
        user_id: toUserId,
        status: 'ACTIVE',
        coverage_slot: {
          purchase: { insurance_cycle_config_id: cycleConfigId },
        },
      },
      select: { insurance_assignment_id: true },
    });
    if (covered) {
      throw new AppConflictException(
        ErrorCode.FIELD_PAYMENT_ORDER_DUPLICATE_BENEFICIARY,
        { user_ids: [toUserId] },
      );
    }
  }
}

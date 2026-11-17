import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  formatUserName,
  InsuranceCoverageService,
  type CoverageDb,
} from './insurance-coverage.service';
import type { OrderActor } from './order-actor';

export interface CreateReassignmentInput {
  insurance_assignment_id: number;
  to_user_id: string;
  reason?: string;
}

async function loadAssignment(db: CoverageDb, assignmentId: number) {
  const assignment = await db.insurance_assignments.findUnique({
    where: { insurance_assignment_id: assignmentId },
    include: {
      coverage_slot: {
        select: {
          insurance_coverage_slot_id: true,
          current_section_id: true,
          current_section: {
            select: {
              main_club_id: true,
              clubs: { select: { local_field_id: true } },
            },
          },
          purchase: {
            select: {
              external_reference: true,
              cycle_config: {
                select: {
                  ecclesiastical_year_id: true,
                  product: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!assignment) {
    throw new AppNotFoundException(ErrorCode.INSURANCE_REASSIGNMENT_NOT_FOUND);
  }
  return assignment;
}

type LoadedAssignment = Awaited<ReturnType<typeof loadAssignment>>;

/**
 * Reasignación DIRECTA de coberturas (modelo anual): el seguro es del club; si
 * el titular se va, la directiva de la sección lo reasigna a alguien sin
 * seguro sin pasar por el Campo Local. `create` ejecuta de inmediato y deja la
 * fila en `insurance_reassignment_requests` como APPROVED con
 * reviewer = actor (registro de auditoría). `approve`/`reject` solo existen
 * para filas PENDING heredadas del flujo anterior.
 */
@Injectable()
export class InsuranceReassignmentsService {
  private readonly logger = new Logger(InsuranceReassignmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly coverage: InsuranceCoverageService,
  ) {}

  async create(input: CreateReassignmentInput, actor: OrderActor) {
    const now = new Date();
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const assignment = await loadAssignment(
            tx,
            input.insurance_assignment_id,
          );
          await this.assertActorScope(assignment, actor);
          return this.execute(tx, {
            assignment,
            toUserId: input.to_user_id,
            reason: input.reason?.trim() || null,
            actor,
            now,
            requireSourceLeft: true,
            requestedById: actor.userId,
            existingRequestId: null,
          });
        },
        { timeout: 15_000 },
      );
      this.logger.log(
        JSON.stringify({
          event: 'insurance_reassignment.executed',
          request_id: result.insurance_reassignment_request_id,
          assignment_id: result.insurance_assignment_id,
          from_user_id: result.from_user_id,
          to_user_id: result.to_user_id,
          actor_id: actor.userId,
        }),
      );
      return result;
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
    const visible = await this.filterVisible(requests, actor);
    return this.withNames(visible);
  }

  /** Adds display names so clients never show raw user ids. */
  private async withNames<
    T extends {
      from_user_id: string;
      to_user_id: string;
      requested_by_id: string;
      reviewed_by_id: string | null;
    },
  >(requests: T[]) {
    if (requests.length === 0) {
      return [];
    }
    const ids = new Set<string>();
    for (const request of requests) {
      ids.add(request.from_user_id);
      ids.add(request.to_user_id);
      ids.add(request.requested_by_id);
      if (request.reviewed_by_id) {
        ids.add(request.reviewed_by_id);
      }
    }
    const users = await this.prisma.users.findMany({
      where: { user_id: { in: [...ids] } },
      select: {
        user_id: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
      },
    });
    const nameById = new Map(
      users.map((user) => [user.user_id, formatUserName(user)] as const),
    );
    const nameOf = (id: string | null) =>
      id ? (nameById.get(id) ?? null) : null;
    return requests.map((request) => ({
      ...request,
      from_user_name: nameOf(request.from_user_id),
      to_user_name: nameOf(request.to_user_id),
      requested_by_name: nameOf(request.requested_by_id),
      reviewed_by_name: nameOf(request.reviewed_by_id),
    }));
  }

  private async filterVisible<
    T extends { insurance_assignment_id: number; requested_by_id: string },
  >(requests: T[], actor: OrderActor): Promise<T[]> {
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
        actor.sectionIds.includes(
          assignment.coverage_slot.current_section_id,
        ) || request.requested_by_id === actor.userId
      );
    });
  }

  /** Solo para filas PENDING heredadas; las nuevas se ejecutan en `create`. */
  async approve(requestId: number, actor: OrderActor) {
    this.requireReviewer(actor);
    const request = await this.findRequest(requestId);
    if (request.status !== 'PENDING') {
      throw new AppConflictException(ErrorCode.INSURANCE_REASSIGNMENT_INVALID, {
        reason: 'request_not_pending',
      });
    }

    const now = new Date();
    return this.prisma.$transaction(
      async (tx) => {
        const assignment = await loadAssignment(
          tx,
          request.insurance_assignment_id,
        );
        await this.assertReviewerTerritory(assignment, actor);
        return this.execute(tx, {
          assignment,
          toUserId: request.to_user_id,
          reason: request.reason,
          actor,
          now,
          requireSourceLeft: false,
          requestedById: request.requested_by_id,
          existingRequestId: requestId,
        });
      },
      { timeout: 15_000 },
    );
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

  /**
   * Direct reassignment is for the section leadership: the actor's ACTIVE
   * assignment (the one `insurance:create` was evaluated against) must be in
   * the slot's section. Global admins and LF reviewers of the section's
   * territory are allowed too.
   */
  private async assertActorScope(
    assignment: LoadedAssignment,
    actor: OrderActor,
  ) {
    const sectionId = assignment.coverage_slot.current_section_id;
    if (
      actor.globalAccess ||
      actor.activeSection?.club_section_id === sectionId
    ) {
      return;
    }
    await this.assertReviewerTerritory(assignment, actor);
  }

  private async assertReviewerTerritory(
    assignment: LoadedAssignment,
    actor: OrderActor,
  ) {
    if (actor.globalAccess) {
      return;
    }
    const lfId =
      assignment.coverage_slot.current_section?.clubs?.local_field_id;
    if (
      actor.canReview &&
      typeof actor.localFieldId === 'number' &&
      lfId === actor.localFieldId
    ) {
      return;
    }
    throw new AppForbiddenException(ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN);
  }

  /**
   * Validates and applies a reassignment inside `tx`: release the old
   * assignment, open a new ACTIVE one on the same slot with the same
   * `valid_until`, write the REASSIGNED movement, move the legacy bridge and
   * record the request row as APPROVED (reviewer = actor).
   */
  private async execute(
    tx: CoverageDb,
    input: {
      assignment: LoadedAssignment;
      toUserId: string;
      reason: string | null;
      actor: OrderActor;
      now: Date;
      requireSourceLeft: boolean;
      requestedById: string;
      existingRequestId: number | null;
    },
  ) {
    const { assignment, toUserId, actor, now } = input;
    const invalid = (reason: string, extra?: Record<string, unknown>) =>
      new AppBadRequestException(ErrorCode.INSURANCE_REASSIGNMENT_INVALID, {
        reason,
        ...extra,
      });

    if (
      assignment.status !== 'ACTIVE' ||
      assignment.subject_type !== 'MEMBER' ||
      !assignment.user_id
    ) {
      throw invalid('assignment_not_active_member');
    }
    const fromUserId = assignment.user_id;
    if (fromUserId === toUserId) {
      throw invalid('same_user');
    }
    if (assignment.valid_until < this.coverage.today(now)) {
      throw invalid('assignment_expired');
    }
    const slot = assignment.coverage_slot;
    const yearId = slot.purchase.cycle_config.ecclesiastical_year_id;
    const currentYear = await this.coverage.getCurrentYear(tx, now);
    if (!currentYear || currentYear.year_id !== yearId) {
      throw invalid('assignment_not_current_year');
    }
    const clubId = slot.current_section?.main_club_id;
    if (!clubId) {
      throw invalid('source_section_without_club');
    }

    if (input.requireSourceLeft) {
      const stillIn = await this.coverage.findActiveClubUserIds(tx, clubId, [
        fromUserId,
      ]);
      if (stillIn.has(fromUserId)) {
        throw invalid('holder_still_in_club');
      }
    }

    // Destination: active member/staff of the same section, uncovered and not
    // in a live-or-paid order this year.
    if (
      !(await this.coverage.isActiveInSection(
        tx,
        slot.current_section_id,
        toUserId,
      ))
    ) {
      throw invalid('destination_not_in_section');
    }
    await this.coverage.assertCanBeInsured(tx, {
      yearId,
      userIds: [toUserId],
    });

    // Optimistic guard against a concurrent reassignment of the same assignment.
    const released = await tx.insurance_assignments.updateMany({
      where: {
        insurance_assignment_id: assignment.insurance_assignment_id,
        status: 'ACTIVE',
      },
      data: {
        status: 'RELEASED',
        release_reason: `Reassigned to ${toUserId}`,
        modified_by_id: actor.userId,
      },
    });
    if (released.count !== 1) {
      throw new AppConflictException(ErrorCode.INSURANCE_REASSIGNMENT_INVALID, {
        reason: 'assignment_no_longer_active',
      });
    }

    const replacement = await tx.insurance_assignments.create({
      data: {
        insurance_coverage_slot_id: slot.insurance_coverage_slot_id,
        subject_type: 'MEMBER',
        user_id: toUserId,
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

    await tx.insurance_slot_movements.create({
      data: {
        insurance_coverage_slot_id: slot.insurance_coverage_slot_id,
        movement_type: 'REASSIGNED',
        from_section_id: slot.current_section_id,
        to_section_id: slot.current_section_id,
        insurance_assignment_id: replacement.insurance_assignment_id,
        reason: input.reason
          ? `Direct reassignment: ${input.reason}`
          : 'Direct reassignment',
        performed_by_id: actor.userId,
      },
    });

    // Bridge (member_insurances): old holder off, destination on/extended.
    const folio = slot.purchase.external_reference;
    await this.coverage.deactivateBridge(tx, {
      userId: fromUserId,
      folioReference: folio,
      actorId: actor.userId,
    });
    await this.coverage.upsertBridges(tx, {
      userIds: [toUserId],
      providerName: slot.purchase.cycle_config.product.name,
      folioReference:
        folio ?? `reassignment-${assignment.insurance_assignment_id}`,
      validFrom: now,
      validUntil: assignment.valid_until,
      actorId: actor.userId,
    });

    if (input.existingRequestId !== null) {
      return tx.insurance_reassignment_requests.update({
        where: { insurance_reassignment_request_id: input.existingRequestId },
        data: {
          status: 'APPROVED',
          reviewed_by_id: actor.userId,
          reviewed_at: now,
        },
      });
    }
    return tx.insurance_reassignment_requests.create({
      data: {
        insurance_assignment_id: assignment.insurance_assignment_id,
        from_user_id: fromUserId,
        to_user_id: toUserId,
        reason: input.reason,
        status: 'APPROVED',
        requested_by_id: input.requestedById,
        reviewed_by_id: actor.userId,
        reviewed_at: now,
      },
    });
  }
}

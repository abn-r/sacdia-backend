import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  assertReviewerCanAccessLocalField,
  resolveReviewerAccess,
  type ReviewerAccess,
} from '../common/reviewer-scope/reviewer-scope';
import { InstructorsService } from '../instructors/instructors.service';
import {
  instructorKind,
  instructorUserSelectNoPhoto,
  sameInstructor,
  toInstructorView,
} from '../instructors/instructor-view';
import { displayName } from '../investiture-requests/investiture-communications.rules';
import { PrismaService } from '../prisma/prisma.service';
import {
  INSTRUCTOR_PROPOSAL_ACTIONS as ACTION,
  PROPOSAL_INSTRUCTOR_INCLUDE,
  toMemberProposalView,
} from './honor-instructor-proposal-view';
import {
  HonorInstructorProposalQueueStatus,
  ListHonorInstructorProposalsDto,
  ProposeHonorInstructorDto,
  RejectHonorInstructorProposalDto,
} from './dto/honor-instructor-proposals.dto';

const ADMIN_INCLUDE = {
  instructor: { select: instructorUserSelectNoPhoto },
  user_honor: {
    select: {
      user_honor_id: true,
      user_id: true,
      active: true,
      validation_status: true,
      instructor_user_id: true,
      instructor_name: true,
      instructor: { select: instructorUserSelectNoPhoto },
      honors: { select: { honor_id: true, name: true } },
      users: {
        select: {
          user_id: true,
          name: true,
          paternal_last_name: true,
          maternal_last_name: true,
          local_field_id: true,
        },
      },
    },
  },
} satisfies Prisma.honor_instructor_proposalsInclude;

type AdminProposalRow = Prisma.honor_instructor_proposalsGetPayload<{
  include: typeof ADMIN_INCLUDE;
}>;

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2002';
}

/**
 * Instructor de una especialidad YA aprobada (D11). El miembro propone y el
 * Campo Local decide. La propuesta vive aparte de `users_honors`, que solo se
 * toca al aprobar y solo en `instructor_*` (`applyApprovedInstructor`).
 */
@Injectable()
export class HonorInstructorProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly instructors: InstructorsService,
  ) {}

  // ========================================
  // MIEMBRO
  // ========================================

  async propose(
    callerId: string,
    ownerUserId: string,
    honorId: number,
    dto: ProposeHonorInstructorDto,
  ) {
    this.assertOwner(callerId, ownerUserId);
    const userHonor = await this.findOwnHonor(ownerUserId, honorId);
    if (!userHonor.active || userHonor.validation_status !== 'APPROVED') {
      throw new AppBadRequestException(
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_APPROVED,
      );
    }

    const instructorUserId = dto.instructorUserId ?? null;
    const instructorName = dto.instructorName ?? null;
    if (instructorUserId && instructorName) {
      throw new AppBadRequestException(ErrorCode.HONOR_INSTRUCTOR_AMBIGUOUS);
    }
    if (!instructorUserId && !instructorName) {
      throw new AppBadRequestException(ErrorCode.HONOR_INSTRUCTOR_REQUIRED);
    }
    const proposed = {
      instructor_user_id: instructorUserId,
      instructor_name: instructorName,
    };
    if (instructorUserId) {
      await this.instructors.assertEligible(ownerUserId, instructorUserId);
    }
    if (sameInstructor(proposed, userHonor)) {
      throw new AppBadRequestException(ErrorCode.HONOR_INSTRUCTOR_UNCHANGED);
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const pending = await tx.honor_instructor_proposals.findFirst({
          where: { user_honor_id: userHonor.user_honor_id, status: 'PENDING' },
          select: { proposal_id: true },
        });
        if (pending) {
          await tx.honor_instructor_proposals.updateMany({
            where: { proposal_id: pending.proposal_id, status: 'PENDING' },
            data: { status: 'WITHDRAWN' },
          });
        }
        // El índice único parcial resuelve la carrera: el que pierde cae en P2002.
        const row = await tx.honor_instructor_proposals.create({
          data: {
            user_honor_id: userHonor.user_honor_id,
            proposed_by_id: callerId,
            ...proposed,
          },
          include: PROPOSAL_INSTRUCTOR_INCLUDE,
        });
        await this.audit(tx, ACTION.proposed, userHonor.user_honor_id, {
          ownerUserId,
          performedBy: callerId,
          comment: {
            proposal_id: row.proposal_id,
            kind: instructorKind(row),
            ...(pending ? { replaced_proposal_id: pending.proposal_id } : {}),
          },
        });
        return row;
      });
      return this.toMemberResponse(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppConflictException(
          ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_PENDING,
        );
      }
      throw error;
    }
  }

  async withdraw(callerId: string, ownerUserId: string, honorId: number) {
    this.assertOwner(callerId, ownerUserId);
    const userHonor = await this.findOwnHonor(ownerUserId, honorId);
    const pending = await this.prisma.honor_instructor_proposals.findFirst({
      where: { user_honor_id: userHonor.user_honor_id, status: 'PENDING' },
      select: { proposal_id: true },
    });
    if (!pending) {
      throw new AppNotFoundException(
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_FOUND,
      );
    }

    const withdrawn = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.honor_instructor_proposals.updateMany({
        where: { proposal_id: pending.proposal_id, status: 'PENDING' },
        data: { status: 'WITHDRAWN' },
      });
      if (count === 0) {
        // El Campo Local la resolvió entre la lectura y la escritura.
        throw new AppConflictException(
          ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_PENDING,
        );
      }
      await this.audit(tx, ACTION.withdrawn, userHonor.user_honor_id, {
        ownerUserId,
        performedBy: callerId,
        comment: { proposal_id: pending.proposal_id },
      });
      return tx.honor_instructor_proposals.findUniqueOrThrow({
        where: { proposal_id: pending.proposal_id },
        include: PROPOSAL_INSTRUCTOR_INCLUDE,
      });
    });
    return this.toMemberResponse(withdrawn);
  }

  // ========================================
  // ADMIN (Campo Local)
  // ========================================

  async list(reviewerId: string, query: ListHonorInstructorProposalsDto) {
    const access = await this.reviewerAccess(reviewerId);
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const where: Prisma.honor_instructor_proposalsWhereInput = {
      status: query.status ?? HonorInstructorProposalQueueStatus.PENDING,
      ...(access.global
        ? {}
        : { user_honor: { users: { local_field_id: access.localFieldId } } }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.honor_instructor_proposals.findMany({
        where,
        include: ADMIN_INCLUDE,
        orderBy: [{ created_at: 'asc' }, { proposal_id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.honor_instructor_proposals.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.toAdminItem(row)),
      total,
      page,
      limit,
    };
  }

  async approve(reviewerId: string, proposalId: string) {
    const proposal = await this.loadForReview(reviewerId, proposalId);
    const honor = proposal.user_honor;
    // Pasa tiempo entre proponer y decidir: se revalida todo antes de escribir.
    if (!honor.active || honor.validation_status !== 'APPROVED') {
      throw this.honorNotApproved();
    }
    if (proposal.instructor_user_id) {
      await this.instructors.assertEligible(
        honor.user_id,
        proposal.instructor_user_id,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await this.decide(tx, proposalId, {
        status: 'APPROVED',
        reviewed_by_id: reviewerId,
        reviewed_at: new Date(),
      });
      await this.applyApprovedInstructor(tx, honor.user_honor_id, proposal);
      await this.audit(tx, ACTION.approved, honor.user_honor_id, {
        ownerUserId: honor.user_id,
        performedBy: reviewerId,
        comment: {
          proposal_id: proposalId,
          kind: instructorKind(proposal),
          previous_kind: instructorKind(honor),
        },
      });
    });
    return this.reload(proposalId);
  }

  async reject(
    reviewerId: string,
    proposalId: string,
    dto: RejectHonorInstructorProposalDto,
  ) {
    const proposal = await this.loadForReview(reviewerId, proposalId);
    await this.prisma.$transaction(async (tx) => {
      await this.decide(tx, proposalId, {
        status: 'REJECTED',
        rejection_reason: dto.reason,
        reviewed_by_id: reviewerId,
        reviewed_at: new Date(),
      });
      await this.audit(tx, ACTION.rejected, proposal.user_honor.user_honor_id, {
        ownerUserId: proposal.user_honor.user_id,
        performedBy: reviewerId,
        comment: { proposal_id: proposalId, reason: dto.reason },
      });
    });
    return this.reload(proposalId);
  }

  /**
   * LA ÚNICA escritura sobre una especialidad aprobada (D11). Solo
   * `instructor_*` y `modified_at`; no pasa por `assertHonorIsMutable` y no
   * toca estado, validador, fechas, evidencias ni `active`. El `where` repite
   * "activa y APPROVED" para que una carrera con otro cambio no la escriba.
   */
  private async applyApprovedInstructor(
    tx: Prisma.TransactionClient,
    userHonorId: number,
    proposal: {
      instructor_user_id: string | null;
      instructor_name: string | null;
    },
  ) {
    const { count } = await tx.users_honors.updateMany({
      where: {
        user_honor_id: userHonorId,
        active: true,
        validation_status: 'APPROVED',
      },
      data: {
        instructor_user_id: proposal.instructor_user_id,
        instructor_name: proposal.instructor_name,
        modified_at: new Date(),
      },
    });
    if (count === 0) {
      throw this.honorNotApproved();
    }
  }

  /** Al decidir, que la especialidad ya no esté aprobada es un conflicto de estado (409). */
  private honorNotApproved() {
    return new AppConflictException(
      ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_APPROVED,
    );
  }

  // ========================================
  // Internos
  // ========================================

  /** `PENDING` a un estado final; 0 filas = ya la resolvió otro (409). */
  private async decide(
    tx: Prisma.TransactionClient,
    proposalId: string,
    data: Prisma.honor_instructor_proposalsUncheckedUpdateManyInput,
  ) {
    const { count } = await tx.honor_instructor_proposals.updateMany({
      where: { proposal_id: proposalId, status: 'PENDING' },
      data,
    });
    if (count === 0) {
      throw new AppConflictException(
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_PENDING,
      );
    }
  }

  /** Propuesta + alcance del revisor (403) + todavía pendiente (409). */
  private async loadForReview(reviewerId: string, proposalId: string) {
    const access = await this.reviewerAccess(reviewerId);
    const proposal = await this.prisma.honor_instructor_proposals.findUnique({
      where: { proposal_id: proposalId },
      include: ADMIN_INCLUDE,
    });
    if (!proposal) {
      throw new AppNotFoundException(
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_FOUND,
      );
    }
    assertReviewerCanAccessLocalField(
      access,
      proposal.user_honor.users.local_field_id,
      () => this.forbidden(),
    );
    if (proposal.status !== 'PENDING') {
      throw new AppConflictException(
        ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_NOT_PENDING,
      );
    }
    return proposal;
  }

  private async reload(proposalId: string) {
    const row = await this.prisma.honor_instructor_proposals.findUniqueOrThrow({
      where: { proposal_id: proposalId },
      include: ADMIN_INCLUDE,
    });
    return this.toAdminItem(row);
  }

  private reviewerAccess(reviewerId: string): Promise<ReviewerAccess> {
    return resolveReviewerAccess(this.prisma, reviewerId, {
      reviewerNotFound: () => this.forbidden(),
      scopeRequired: () => this.forbidden(),
    });
  }

  private forbidden() {
    return new AppForbiddenException(
      ErrorCode.HONOR_INSTRUCTOR_PROPOSAL_FORBIDDEN,
    );
  }

  /** Es una declaración personal: ni el Campo Local propone por el miembro. */
  private assertOwner(callerId: string, ownerUserId: string) {
    if (callerId !== ownerUserId) {
      throw this.forbidden();
    }
  }

  private async findOwnHonor(ownerUserId: string, honorId: number) {
    const userHonor = await this.prisma.users_honors.findFirst({
      where: { user_id: ownerUserId, honor_id: honorId },
      select: {
        user_honor_id: true,
        active: true,
        validation_status: true,
        instructor_user_id: true,
        instructor_name: true,
      },
    });
    if (!userHonor) {
      throw new AppNotFoundException(ErrorCode.HONOR_USER_HONOR_NOT_FOUND);
    }
    return userHonor;
  }

  private async toMemberResponse(
    row: Prisma.honor_instructor_proposalsGetPayload<{
      include: typeof PROPOSAL_INSTRUCTOR_INCLUDE;
    }>,
  ) {
    const photoUrls = row.instructor
      ? await this.instructors.photoUrlsFor([row.instructor])
      : undefined;
    return toMemberProposalView(row, photoUrls);
  }

  /** `comment` nunca lleva el nombre libre del instructor: solo ids y tipos. */
  private audit(
    tx: Prisma.TransactionClient,
    action: string,
    userHonorId: number,
    entry: {
      ownerUserId: string;
      performedBy: string;
      comment: Record<string, unknown>;
    },
  ) {
    return tx.validation_logs.create({
      data: {
        entity_type: 'honor',
        entity_id: String(userHonorId),
        user_id: entry.ownerUserId,
        action,
        performed_by: entry.performedBy,
        comment: JSON.stringify(entry.comment),
      },
    });
  }

  /** Elemento de la cola: sin correo ni foto firmada. */
  private toAdminItem(row: AdminProposalRow) {
    return {
      proposal_id: row.proposal_id,
      status: row.status,
      created_at: row.created_at,
      honor: row.user_honor.honors,
      member: {
        user_id: row.user_honor.users.user_id,
        display_name: displayName(row.user_honor.users),
      },
      current_instructor: toInstructorView(row.user_honor),
      proposed_instructor: toInstructorView(row),
      rejection_reason: row.rejection_reason,
      reviewed_at: row.reviewed_at,
    };
  }
}

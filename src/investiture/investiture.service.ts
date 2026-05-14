import { Injectable, Logger } from '@nestjs/common';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  Prisma,
  investiture_status_enum,
  investiture_action_enum,
} from '@prisma/client';
import {
  PaginatedResult,
  PaginationDto,
  createPaginatedResult,
} from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { AchievementsService } from '../achievements/achievements.service';
import { SubmitForValidationDto } from './dto/submit-for-validation.dto';
import { ApproveInvestitureDto } from './dto/approve-investiture.dto';
import { RejectInvestitureDto } from './dto/reject-investiture.dto';
import { MarkInvestidoDto } from './dto/mark-investido.dto';
import { CreateInvestitureConfigDto } from './dto/create-investiture-config.dto';
import { UpdateInvestitureConfigDto } from './dto/update-investiture-config.dto';
import {
  BulkApproveEnrollmentsDto,
  BulkApproveAction,
} from './dto/bulk-approve-enrollments.dto';
import { BulkRejectEnrollmentsDto } from './dto/bulk-reject-enrollments.dto';

// ─── Approval chain state machine ──────────────────────────────────
// eligible (auto)  →  submitted  →  club_approved  →  coordinator_approved  →  field_approved  →  invested
//                             ↕           ↕                  ↕                      ↕
//                          rejected     rejected           rejected              rejected
// ────────────────────────────────────────────────────────────────────

/** Valid approval chain transitions: from → to */
const APPROVAL_TRANSITIONS: Record<
  string,
  { target: investiture_status_enum; action: investiture_action_enum }
> = {
  SUBMITTED_FOR_VALIDATION: {
    target: investiture_status_enum.CLUB_APPROVED,
    action: investiture_action_enum.CLUB_APPROVED,
  },
  CLUB_APPROVED: {
    target: investiture_status_enum.COORDINATOR_APPROVED,
    action: investiture_action_enum.COORDINATOR_APPROVED,
  },
  COORDINATOR_APPROVED: {
    target: investiture_status_enum.FIELD_APPROVED,
    action: investiture_action_enum.FIELD_APPROVED,
  },
};

/** Statuses from which rejection is possible */
const REJECTABLE_STATUSES: investiture_status_enum[] = [
  investiture_status_enum.SUBMITTED_FOR_VALIDATION,
  investiture_status_enum.CLUB_APPROVED,
  investiture_status_enum.COORDINATOR_APPROVED,
  investiture_status_enum.FIELD_APPROVED,
];

type ApprovalResult = {
  enrollment_id: number;
  investiture_status: string;
  approved_by: string;
  approved_at: Date;
};

@Injectable()
export class InvestitureService {
  private readonly logger = new Logger(InvestitureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly notifications: NotificationsService,
    private readonly achievementsService: AchievementsService,
  ) {}

  // ========================================
  // SUBMIT FOR VALIDATION (counselor submits)
  // ========================================

  /**
   * Enviar enrollment a validación de investidura.
   * Transiciones válidas: IN_PROGRESS → SUBMITTED_FOR_VALIDATION
   *                        REJECTED  → SUBMITTED_FOR_VALIDATION (re-envío)
   */
  async submitForValidation(
    enrollmentId: number,
    actorId: string,
    dto: SubmitForValidationDto,
  ): Promise<{
    enrollment_id: number;
    investiture_status: string;
    submitted_at: Date;
    is_late: boolean;
  }> {
    // Step 1: Find enrollment with user's local_field_id
    const enrollment = await this.prisma.enrollments.findUnique({
      where: { enrollment_id: enrollmentId },
      select: {
        enrollment_id: true,
        user_id: true,
        class_id: true,
        ecclesiastical_year_id: true,
        investiture_status: true,
        locked_for_validation: true,
        active: true,
        users: {
          select: { local_field_id: true },
        },
      },
    });

    // Step 2: Not found or inactive
    if (!enrollment || enrollment.active === false) {
      throw new AppNotFoundException(
        ErrorCode.INVESTITURE_ENROLLMENT_NOT_FOUND,
      );
    }

    // Step 3: Validate state transition
    const validSourceStatuses: investiture_status_enum[] = [
      investiture_status_enum.IN_PROGRESS,
      investiture_status_enum.REJECTED,
    ];
    if (!validSourceStatuses.includes(enrollment.investiture_status)) {
      throw new AppBadRequestException(
        ErrorCode.INVESTITURE_INVALID_STATE_TRANSITION,
        { status: enrollment.investiture_status },
      );
    }

    // Step 4: Resolve investiture_config (throws NotFoundException if not found)
    const config = await this.resolveInvestitureConfig(enrollment);

    // Step 5: Check deadline (soft warning — do NOT block)
    const now = new Date();
    const is_late = config.submission_deadline < now;

    // Step 6: Atomic transaction using array syntax
    const submittedAt = now;
    const [updatedEnrollment] = await this.prisma.$transaction([
      this.prisma.enrollments.update({
        where: { enrollment_id: enrollmentId },
        data: {
          investiture_status: investiture_status_enum.SUBMITTED_FOR_VALIDATION,
          submitted_for_validation: true,
          submitted_at: submittedAt,
          locked_for_validation: true,
          rejection_reason: null,
        },
      }),
      this.prisma.investiture_validation_history.create({
        data: {
          enrollment_id: enrollmentId,
          action: investiture_action_enum.SUBMITTED,
          performed_by: actorId,
          comments: dto.comments ?? null,
        },
      }),
    ]);

    this.logger.log(
      `Enrollment ${enrollmentId} submitted for validation by ${actorId}`,
    );

    // Notify director of the member's section
    try {
      const memberSection = await this.prisma.club_role_assignments.findFirst({
        where: { user_id: enrollment.user_id, active: true },
        select: { club_section_id: true },
      });

      if (memberSection?.club_section_id) {
        void this.notifications.sendToSectionRole(
          memberSection.club_section_id,
          ['director'],
          'Investidura enviada a validación',
          'Un consejero ha enviado un enrollment para aprobación',
          {
            type: 'investiture',
            entity_id: String(enrollmentId),
            status: 'submitted',
          },
          'investiture:submitted',
        );
      }
    } catch (error: unknown) {
      this.logger.error(
        `Notification failed for investiture submission ${enrollmentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Step 7: Return result
    return {
      enrollment_id: updatedEnrollment.enrollment_id,
      investiture_status: updatedEnrollment.investiture_status,
      submitted_at: updatedEnrollment.submitted_at as Date,
      is_late,
    };
  }

  // ========================================
  // CLUB APPROVE (director of section)
  // ========================================

  /**
   * Director de sección aprueba el enrollment.
   * Transición: SUBMITTED_FOR_VALIDATION → CLUB_APPROVED
   */
  async clubApprove(
    enrollmentId: number,
    actorId: string,
    dto: ApproveInvestitureDto,
  ): Promise<ApprovalResult> {
    return this.transitionApprovalState(
      enrollmentId,
      actorId,
      investiture_status_enum.SUBMITTED_FOR_VALIDATION,
      dto.comments,
    );
  }

  // ========================================
  // COORDINATOR APPROVE (zone/local field coordinator)
  // ========================================

  /**
   * Coordinador aprueba el enrollment.
   * Transición: CLUB_APPROVED → COORDINATOR_APPROVED
   */
  async coordinatorApprove(
    enrollmentId: number,
    actorId: string,
    dto: ApproveInvestitureDto,
  ): Promise<ApprovalResult> {
    return this.transitionApprovalState(
      enrollmentId,
      actorId,
      investiture_status_enum.CLUB_APPROVED,
      dto.comments,
    );
  }

  // ========================================
  // FIELD APPROVE (local field director/assistant)
  // ========================================

  /**
   * Director o asistente de campo local aprueba el enrollment.
   * Transición: COORDINATOR_APPROVED → FIELD_APPROVED
   */
  async fieldApprove(
    enrollmentId: number,
    actorId: string,
    dto: ApproveInvestitureDto,
  ): Promise<ApprovalResult> {
    return this.transitionApprovalState(
      enrollmentId,
      actorId,
      investiture_status_enum.COORDINATOR_APPROVED,
      dto.comments,
    );
  }

  // ========================================
  // REJECT (at any approval level)
  // ========================================

  /**
   * Rechazar un enrollment en cualquier nivel del flujo de aprobación.
   * Los estados rechazables son: SUBMITTED_FOR_VALIDATION, CLUB_APPROVED,
   * COORDINATOR_APPROVED, FIELD_APPROVED.
   * El rechazo desbloquea el enrollment para corrección y re-envío.
   */
  async reject(
    enrollmentId: number,
    actorId: string,
    dto: RejectInvestitureDto,
  ): Promise<{
    enrollment_id: number;
    investiture_status: string;
    rejection_reason: string;
    rejected_by: string;
    rejected_at: Date;
  }> {
    // 1. Find enrollment
    const enrollment = await this.prisma.enrollments.findFirst({
      where: { enrollment_id: enrollmentId, active: true },
      select: {
        enrollment_id: true,
        user_id: true,
        investiture_status: true,
      },
    });

    if (!enrollment) {
      throw new AppNotFoundException(
        ErrorCode.INVESTITURE_ENROLLMENT_NOT_FOUND,
      );
    }

    // 2. Validate that current status allows rejection
    if (!REJECTABLE_STATUSES.includes(enrollment.investiture_status)) {
      throw new AppBadRequestException(
        ErrorCode.INVESTITURE_INVALID_STATE_TRANSITION,
        { status: enrollment.investiture_status },
      );
    }

    // 3. Transaction: update status + create history
    const now = new Date();
    const updatedEnrollment = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.enrollments.update({
        where: { enrollment_id: enrollmentId },
        data: {
          investiture_status: investiture_status_enum.REJECTED,
          validated_by: actorId,
          validated_at: now,
          rejection_reason: dto.reason,
          locked_for_validation: false,
          submitted_for_validation: false,
        },
      });

      await tx.investiture_validation_history.create({
        data: {
          enrollment_id: enrollmentId,
          action: investiture_action_enum.REJECTED,
          performed_by: actorId,
          comments: dto.reason,
        },
      });

      return updated;
    });

    this.logger.log(
      `Enrollment ${enrollmentId} rejected by ${actorId} from status ${enrollment.investiture_status}`,
    );

    // Notify the submitter (counselor) who originally submitted the enrollment
    try {
      const submittedEntry =
        await this.prisma.investiture_validation_history.findFirst({
          where: {
            enrollment_id: enrollmentId,
            action: investiture_action_enum.SUBMITTED,
          },
          orderBy: { created_at: 'desc' },
          select: { performed_by: true },
        });

      const submitterId = submittedEntry?.performed_by;
      if (submitterId) {
        void this.notifications.notifySafe(
          submitterId,
          'Investidura rechazada',
          `El enrollment ha sido rechazado: ${dto.reason}`,
          {
            type: 'investiture',
            entity_id: String(enrollmentId),
            status: 'rejected',
          },
          'investiture:rejected',
        );
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Notification failed for investiture rejection ${enrollmentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      enrollment_id: updatedEnrollment.enrollment_id,
      investiture_status: updatedEnrollment.investiture_status,
      rejection_reason: dto.reason,
      rejected_by: actorId,
      rejected_at: now,
    };
  }

  // ========================================
  // MARK INVESTIDO
  // ========================================

  /**
   * Registrar la investidura formal de un enrollment en estado FIELD_APPROVED.
   */
  async markInvestido(
    enrollmentId: number,
    actorId: string,
    dto: MarkInvestidoDto,
  ): Promise<{
    enrollment_id: number;
    investiture_status: string;
    investiture_date: Date | null;
  }> {
    // Step 1: Find enrollment with user relation for local_field_id resolution
    const enrollment = await this.prisma.enrollments.findUnique({
      where: { enrollment_id: enrollmentId },
      select: {
        enrollment_id: true,
        user_id: true,
        class_id: true,
        ecclesiastical_year_id: true,
        investiture_status: true,
        active: true,
        users: {
          select: {
            local_field_id: true,
          },
        },
        classes: {
          select: {
            name: true,
            club_type_id: true,
          },
        },
      },
    });

    // Step 2: Throw if not found or inactive
    if (!enrollment || enrollment.active === false) {
      throw new AppNotFoundException(
        ErrorCode.INVESTITURE_ENROLLMENT_NOT_FOUND,
      );
    }

    // Step 3: Validate state — must be FIELD_APPROVED
    const currentStatus = enrollment.investiture_status;

    if (currentStatus === investiture_status_enum.INVESTIDO) {
      throw new AppConflictException(ErrorCode.INVESTITURE_ALREADY_INVESTIDO);
    }

    if (currentStatus !== investiture_status_enum.FIELD_APPROVED) {
      throw new AppBadRequestException(
        ErrorCode.INVESTITURE_INVALID_STATE_TRANSITION,
        { status: currentStatus },
      );
    }

    // Step 4: Resolve investiture_config to get the ceremony date
    const investitureConfig = await this.resolveInvestitureConfig(enrollment);

    // Step 5: Interactive transaction — three operations in sequence
    const updated = await this.prisma.$transaction(async (tx) => {
      // 5a. Update enrollment: investiture_status = INVESTIDO, investiture_date from config
      const updatedEnrollment = await tx.enrollments.update({
        where: { enrollment_id: enrollmentId },
        data: {
          investiture_status: investiture_status_enum.INVESTIDO,
          investiture_date: investitureConfig.investiture_date,
        },
      });

      // 5b. Create history entry
      await tx.investiture_validation_history.create({
        data: {
          enrollment_id: enrollmentId,
          action: investiture_action_enum.INVESTIDO,
          performed_by: actorId,
          comments: dto.comments ?? 'Marcado como investido',
        },
      });

      return updatedEnrollment;
    });

    this.logger.log(
      `Enrollment ${enrollmentId} marked as invested by ${actorId}`,
    );

    // Notify the member that they have been invested
    try {
      void this.notifications.notifySafe(
        enrollment.user_id,
        'Felicidades, has sido investido',
        'Tu investidura ha sido completada oficialmente.',
        {
          type: 'investiture',
          entity_id: String(enrollmentId),
          status: 'invested',
        },
        'investiture:invested',
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Notification failed for investiture completion ${enrollmentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Emit achievement event for class completion
    try {
      await this.achievementsService.emitEvent({
        userId: enrollment.user_id,
        eventType: 'class.completed',
        payload: {
          class_id: enrollment.class_id,
          class_name: enrollment.classes?.name ?? null,
          club_type_id: enrollment.classes?.club_type_id ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to emit achievement event: ${(error as Error).message}`,
      );
    }

    // Step 6: Return result
    return {
      enrollment_id: updated.enrollment_id,
      investiture_status: updated.investiture_status,
      investiture_date: updated.investiture_date,
    };
  }

  // ========================================
  // GET PENDING (filterable by approval level)
  // ========================================

  /**
   * Listar enrollments pendientes por nivel de aprobación con paginación.
   * Auto-scoping: si no se provee localFieldId, se usa el campo local del actor.
   * Filtros opcionales: status (approval level), localFieldId, ecclesiasticalYearId.
   */
  async getPending(
    actorId: string,
    localFieldId?: number,
    ecclesiasticalYearId?: number,
    page?: number,
    limit?: number,
    status?: investiture_status_enum,
  ): Promise<PaginatedResult<any>> {
    // Build pagination DTO from raw params
    const pagination = new PaginationDto();
    if (page !== undefined) pagination.page = page;
    if (limit !== undefined) pagination.limit = limit;

    // Resolve effective localFieldId: use provided value or fall back to actor's own field
    let effectiveLocalFieldId = localFieldId;
    if (!effectiveLocalFieldId) {
      const actor = await this.prisma.users.findUnique({
        where: { user_id: actorId },
        select: { local_field_id: true },
      });
      effectiveLocalFieldId = actor?.local_field_id ?? undefined;
    }

    // Default to SUBMITTED_FOR_VALIDATION for backwards compatibility
    const pendingStatuses: investiture_status_enum[] = status
      ? [status]
      : [
          investiture_status_enum.SUBMITTED_FOR_VALIDATION,
          investiture_status_enum.CLUB_APPROVED,
          investiture_status_enum.COORDINATOR_APPROVED,
          investiture_status_enum.FIELD_APPROVED,
        ];

    // Build where clause
    const where: Prisma.enrollmentsWhereInput = {
      investiture_status: { in: pendingStatuses },
      active: true,
    };

    if (effectiveLocalFieldId) {
      where.users = { local_field_id: effectiveLocalFieldId };
    }

    if (ecclesiasticalYearId) {
      where.ecclesiastical_year_id = ecclesiasticalYearId;
    }

    const [data, total] = await Promise.all([
      this.prisma.enrollments.findMany({
        where,
        include: {
          users: {
            select: {
              name: true,
              paternal_last_name: true,
              maternal_last_name: true,
              email: true,
            },
          },
          classes: { select: { name: true } },
          ecclesiastical_year: { select: { start_date: true, end_date: true } },
        },
        orderBy: { submitted_at: 'asc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.enrollments.count({ where }),
    ]);

    return createPaginatedResult(data, total, pagination);
  }

  // ========================================
  // GET HISTORY
  // ========================================

  /**
   * Obtener historial de validación de un enrollment.
   * Autorización dual: admin/coordinator pueden ver cualquier historial;
   * director/consejero solo si tienen rol activo en el club del enrollment.
   *
   * MVP simplification: global roles (admin/coordinator/super-admin/assistant-admin) bypass
   * authorization entirely. Others may only view their own enrollment's history.
   */
  async getHistory(
    enrollmentId: number,
    actorId: string,
  ): Promise<{
    enrollment_id: number;
    history: Array<{
      history_id: number;
      action: string;
      performed_by: { name: string | null; paternal_last_name: string | null };
      comments: string | null;
      created_at: Date;
    }>;
  }> {
    // 1. Verify enrollment exists
    const enrollment = await this.prisma.enrollments.findUnique({
      where: { enrollment_id: enrollmentId },
      select: { enrollment_id: true, user_id: true },
    });

    if (!enrollment) {
      throw new AppNotFoundException(
        ErrorCode.INVESTITURE_ENROLLMENT_NOT_FOUND,
      );
    }

    // 2. Authorization check — query DB for actual global roles (JWT payload does NOT carry roles)
    const allowedGlobalRoles = [
      'admin',
      'coordinator',
      'super-admin',
      'assistant-admin',
    ];
    const hasGlobalAccess = await this.authorizationContext.hasAnyGlobalRole(
      actorId,
      allowedGlobalRoles,
    );

    if (!hasGlobalAccess) {
      // Club-role check: allow if actor is an active director or counselor
      // in any club_section where the enrollment's user also has an active assignment.
      const enrollmentUserSections = await this.prisma.club_role_assignments
        .findMany({
          where: { user_id: enrollment.user_id, active: true },
          select: { club_section_id: true },
        })
        .then((rows) =>
          rows
            .map((r) => r.club_section_id)
            .filter((id): id is number => id !== null),
        );

      const isClubStaff =
        enrollmentUserSections.length > 0
          ? await this.prisma.club_role_assignments.findFirst({
              where: {
                user_id: actorId,
                active: true,
                status: 'active',
                roles: {
                  role_name: { in: ['director', 'counselor'] },
                },
                club_section_id: { in: enrollmentUserSections },
              },
              select: { assignment_id: true },
            })
          : null;

      if (!isClubStaff) {
        // Fall through to enrollment owner check
        if (actorId !== enrollment.user_id) {
          throw new AppForbiddenException(ErrorCode.INVESTITURE_ACCESS_DENIED);
        }
      }
    }

    // 3. Query history ordered by created_at ASC (chronological)
    const history = await this.prisma.investiture_validation_history.findMany({
      where: { enrollment_id: enrollmentId },
      include: {
        users: {
          select: {
            name: true,
            paternal_last_name: true,
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    // 4. Return shaped result
    return {
      enrollment_id: enrollmentId,
      history: history.map((entry) => ({
        history_id: entry.history_id,
        action: entry.action,
        performed_by: {
          name: entry.users.name,
          paternal_last_name: entry.users.paternal_last_name,
        },
        comments: entry.comments ?? null,
        created_at: entry.created_at,
      })),
    };
  }

  // ========================================
  // VALIDATE ENROLLMENT (legacy — kept for backwards compatibility)
  // ========================================

  /**
   * @deprecated Use clubApprove/coordinatorApprove/fieldApprove/reject instead.
   * Aprobar o rechazar un enrollment en estado SUBMITTED_FOR_VALIDATION.
   * APPROVED mantiene locked_for_validation = true.
   * REJECTED desbloquea el enrollment para corrección y re-envío.
   */
  async validateEnrollment(
    enrollmentId: number,
    actorId: string,
    dto: { action: 'APPROVED' | 'REJECTED'; comments?: string },
  ): Promise<{
    enrollment_id: number;
    investiture_status: string;
    validated_by: string | null;
    validated_at: Date | null;
    rejection_reason: string | null;
  }> {
    // 1. Find enrollment
    const enrollment = await this.prisma.enrollments.findFirst({
      where: { enrollment_id: enrollmentId, active: true },
      select: {
        enrollment_id: true,
        investiture_status: true,
      },
    });

    if (!enrollment) {
      throw new AppNotFoundException(
        ErrorCode.INVESTITURE_ENROLLMENT_NOT_FOUND,
      );
    }

    // 2. Validate state
    if (
      enrollment.investiture_status !==
      investiture_status_enum.SUBMITTED_FOR_VALIDATION
    ) {
      throw new AppConflictException(
        ErrorCode.INVESTITURE_INVALID_STATE_TRANSITION,
        { status: enrollment.investiture_status },
      );
    }

    // 3. Business validation: REJECTED requires comments
    if (
      dto.action === 'REJECTED' &&
      (!dto.comments || dto.comments.trim() === '')
    ) {
      throw new AppBadRequestException(
        ErrorCode.INVESTITURE_REJECT_COMMENTS_REQUIRED,
      );
    }

    // 4. Transaction
    const now = new Date();

    const updatedEnrollment = await this.prisma.$transaction(async (tx) => {
      if (dto.action === 'APPROVED') {
        const updated = await tx.enrollments.update({
          where: { enrollment_id: enrollmentId },
          data: {
            investiture_status: investiture_status_enum.CLUB_APPROVED,
            validated_by: actorId,
            validated_at: now,
            rejection_reason: null,
            locked_for_validation: true,
          },
          select: {
            enrollment_id: true,
            investiture_status: true,
            validated_by: true,
            validated_at: true,
            rejection_reason: true,
          },
        });

        await tx.investiture_validation_history.create({
          data: {
            enrollment_id: enrollmentId,
            action: investiture_action_enum.CLUB_APPROVED,
            performed_by: actorId,
            comments: dto.comments ?? null,
          },
        });

        return updated;
      } else {
        // REJECTED
        const updated = await tx.enrollments.update({
          where: { enrollment_id: enrollmentId },
          data: {
            investiture_status: investiture_status_enum.REJECTED,
            validated_by: actorId,
            validated_at: now,
            rejection_reason: dto.comments,
            locked_for_validation: false,
            submitted_for_validation: false,
          },
          select: {
            enrollment_id: true,
            investiture_status: true,
            validated_by: true,
            validated_at: true,
            rejection_reason: true,
          },
        });

        await tx.investiture_validation_history.create({
          data: {
            enrollment_id: enrollmentId,
            action: investiture_action_enum.REJECTED,
            performed_by: actorId,
            comments: dto.comments,
          },
        });

        return updated;
      }
    });

    // 5. Return
    return {
      enrollment_id: updatedEnrollment.enrollment_id,
      investiture_status: updatedEnrollment.investiture_status,
      validated_by: updatedEnrollment.validated_by,
      validated_at: updatedEnrollment.validated_at,
      rejection_reason: updatedEnrollment.rejection_reason,
    };
  }

  // ========================================
  // BULK APPROVE
  // ========================================

  /**
   * Aprobar múltiples enrollments en bloque.
   *
   * Seguridad: valida que el actor tenga el rol requerido para la acción
   * solicitada antes de procesar. Los roles son evaluados en el servicio
   * porque el bulk endpoint usa un único guard de nivel superior
   * (GlobalRolesGuard admin|coordinator), y algunas acciones requieren
   * restricciones adicionales (field-approve → solo admin).
   *
   * NOTA: club-approve NO está disponible en bulk. Los directores de club
   * deben usar el endpoint individual /club-approve para preservar la
   * validación de rol a nivel de club vía ClubRolesGuard.
   *
   * Mapa de acción → estado fuente requerido:
   *   coordinator-approve → CLUB_APPROVED
   *   field-approve       → COORDINATOR_APPROVED  (solo admin)
   *   invest              → FIELD_APPROVED
   */
  async bulkApproveEnrollments(
    actorId: string,
    dto: BulkApproveEnrollmentsDto,
  ): Promise<{
    succeeded: number[];
    failed: { id: number; reason: string }[];
  }> {
    // C1 — Per-action role validation
    // field-approve requires admin only (not coordinator).
    // We query the actor's roles from DB because the JWT payload does not carry them.
    if (dto.action === 'field-approve') {
      const isAdmin = await this.authorizationContext.hasAnyGlobalRole(
        actorId,
        ['admin', 'assistant-admin', 'super-admin'],
      );
      if (!isAdmin) {
        throw new AppForbiddenException(
          ErrorCode.INVESTITURE_FIELD_APPROVE_REQUIRES_ADMIN,
        );
      }
    }

    // coordinator-approve and invest require admin or coordinator — already
    // guaranteed by the controller-level GlobalRolesGuard('admin', 'coordinator'),
    // so no additional check needed here.

    const ACTION_SOURCE_MAP: Record<
      BulkApproveAction,
      investiture_status_enum
    > = {
      'coordinator-approve': investiture_status_enum.CLUB_APPROVED,
      'field-approve': investiture_status_enum.COORDINATOR_APPROVED,
      invest: investiture_status_enum.FIELD_APPROVED,
    };

    const expectedSourceStatus = ACTION_SOURCE_MAP[dto.action];

    // 1. Fetch all requested enrollments in one query
    const enrollments = await this.prisma.enrollments.findMany({
      where: {
        enrollment_id: { in: dto.enrollmentIds },
        active: true,
      },
      select: {
        enrollment_id: true,
        investiture_status: true,
        user_id: true,
        class_id: true,
        ecclesiastical_year_id: true,
        users: { select: { local_field_id: true } },
        classes: { select: { name: true, club_type_id: true } },
      },
    });

    // 2. Build a lookup map for fast access
    const enrollmentMap = new Map(enrollments.map((e) => [e.enrollment_id, e]));

    const succeeded: number[] = [];
    const failed: { id: number; reason: string }[] = [];

    // 3. Classify each requested ID as eligible or failed
    for (const id of dto.enrollmentIds) {
      const enrollment = enrollmentMap.get(id);

      if (!enrollment) {
        failed.push({ id, reason: 'Enrollment no encontrado o inactivo' });
        continue;
      }

      if (enrollment.investiture_status !== expectedSourceStatus) {
        failed.push({
          id,
          reason: `Estado inválido para esta acción: ${enrollment.investiture_status} (se requiere ${expectedSourceStatus})`,
        });
        continue;
      }

      if (
        !(await this.canActorManageInvestitureEnrollment(actorId, enrollment))
      ) {
        failed.push({
          id,
          reason: 'Sin acceso al scope del enrollment',
        });
        continue;
      }

      succeeded.push(id);
    }

    // 4. If nothing to process, return early
    if (succeeded.length === 0) {
      return { succeeded, failed };
    }

    const now = new Date();

    // 5. Atomic transaction — invest requires per-enrollment updates to resolve
    //    investiture_config (ceremony date); other actions use efficient updateMany.
    if (dto.action === 'invest') {
      // C2 — Pre-resolve investiture_config for each enrollment before the transaction
      //      to avoid I/O-heavy work inside the transaction loop (keeps the transaction short).
      type ConfigResult =
        | { status: 'ok'; investiture_date: Date }
        | { status: 'missing' };

      const configResults = new Map<number, ConfigResult>();
      await Promise.all(
        succeeded.map(async (enrollmentId) => {
          const enrollment = enrollmentMap.get(enrollmentId)!;
          const config = await this.prisma.investiture_config.findFirst({
            where: {
              local_field_id: enrollment.users.local_field_id ?? undefined,
              ecclesiastical_year_id: enrollment.ecclesiastical_year_id,
              active: true,
            },
            select: { investiture_date: true },
          });
          configResults.set(
            enrollmentId,
            config
              ? { status: 'ok', investiture_date: config.investiture_date }
              : { status: 'missing' },
          );
        }),
      );

      // Split into those with a valid config vs those without
      const investable = succeeded.filter(
        (id) => configResults.get(id)!.status === 'ok',
      );
      const noConfig = succeeded.filter(
        (id) => configResults.get(id)!.status === 'missing',
      );

      noConfig.forEach((id) =>
        failed.push({
          id,
          reason:
            'No existe configuración de investidura para este campo local y año',
        }),
      );

      if (investable.length > 0) {
        await this.prisma.$transaction(async (tx) => {
          // W3 — Per-row updateMany with status re-check for atomicity
          for (const enrollmentId of investable) {
            const cfg = configResults.get(enrollmentId) as {
              status: 'ok';
              investiture_date: Date;
            };
            await tx.enrollments.updateMany({
              where: {
                enrollment_id: enrollmentId,
                investiture_status: investiture_status_enum.FIELD_APPROVED,
              },
              data: {
                investiture_status: investiture_status_enum.INVESTIDO,
                investiture_date: cfg.investiture_date,
                validated_by: actorId,
                validated_at: now,
              },
            });
          }

          await tx.investiture_validation_history.createMany({
            data: investable.map((enrollmentId) => ({
              enrollment_id: enrollmentId,
              action: investiture_action_enum.INVESTIDO,
              performed_by: actorId,
              comments: dto.comments ?? null,
            })),
          });
        });
      }

      // Reflect final invest-eligible IDs in succeeded
      succeeded.length = 0;
      succeeded.push(...investable);
    } else {
      // Efficient batch path for coordinator-approve and field-approve
      const transition = APPROVAL_TRANSITIONS[expectedSourceStatus];
      const targetStatus = transition.target;
      const historyAction = transition.action;

      await this.prisma.$transaction(async (tx) => {
        // W3 — Add expectedSourceStatus to WHERE clause to re-check atomically
        const updateResult = await tx.enrollments.updateMany({
          where: {
            enrollment_id: { in: succeeded },
            investiture_status: expectedSourceStatus,
          },
          data: {
            investiture_status: targetStatus,
            validated_by: actorId,
            validated_at: now,
            rejection_reason: null,
            locked_for_validation: true,
          },
        });

        // Detect concurrent modifications
        if (updateResult.count !== succeeded.length) {
          this.logger.warn(
            `Bulk ${dto.action}: expected to update ${succeeded.length} rows but updated ${updateResult.count}. ` +
              `Possible concurrent modification.`,
          );
        }

        await tx.investiture_validation_history.createMany({
          data: succeeded.map((enrollmentId) => ({
            enrollment_id: enrollmentId,
            action: historyAction,
            performed_by: actorId,
            comments: dto.comments ?? null,
          })),
        });
      });
    }

    this.logger.log(
      `Bulk ${dto.action} by ${actorId}: ${succeeded.length} succeeded, ${failed.length} failed`,
    );

    // W1 — Send notifications for each succeeded enrollment.
    //      Use Promise.allSettled so one failure doesn't block the rest.
    const succeededEnrollments = succeeded.map((id) => enrollmentMap.get(id)!);

    if (dto.action === 'invest') {
      await Promise.allSettled(
        succeededEnrollments.map((enrollment) =>
          this.notifications.notifySafe(
            enrollment.user_id,
            'Felicidades, has sido investido',
            'Tu investidura ha sido completada oficialmente.',
            {
              type: 'investiture',
              entity_id: String(enrollment.enrollment_id),
              status: 'invested',
            },
            'investiture:invested',
          ),
        ),
      );

      // Emit achievement events for each invested enrollment (fire-and-forget)
      await Promise.allSettled(
        succeededEnrollments.map((enrollment) =>
          this.achievementsService
            .emitEvent({
              userId: enrollment.user_id,
              eventType: 'class.completed',
              payload: {
                class_id: enrollment.class_id,
                class_name: enrollment.classes?.name ?? null,
                club_type_id: enrollment.classes?.club_type_id ?? null,
              },
            })
            .catch((error: Error) => {
              this.logger.warn(
                `Failed to emit achievement event for enrollment ${enrollment.enrollment_id}: ${error.message}`,
              );
            }),
        ),
      );
    } else {
      const notifData = (id: number) => ({
        type: 'investiture',
        entity_id: String(id),
        status:
          dto.action === 'field-approve'
            ? 'field_approved'
            : 'coordinator_approved',
      });

      await Promise.allSettled(
        succeededEnrollments.map((enrollment) => {
          if (dto.action === 'coordinator-approve') {
            if (!enrollment.users.local_field_id) return Promise.resolve();
            return this.notifications.sendToGlobalRole(
              ['assistant-admin', 'admin'],
              'Investidura aprobada por coordinador',
              'Un enrollment ha sido aprobado por el coordinador y requiere aprobación del campo',
              notifData(enrollment.enrollment_id),
              enrollment.users.local_field_id,
              'investiture:coordinator_approved',
            );
          } else {
            // field-approve → notify the member
            return this.notifications.notifySafe(
              enrollment.user_id,
              'Investidura aprobada por el campo',
              'Tu investidura ha sido aprobada a nivel de campo. Pronto serás investido.',
              notifData(enrollment.enrollment_id),
              'investiture:field_approved',
            );
          }
        }),
      );
    }

    return { succeeded, failed };
  }

  // ========================================
  // BULK REJECT
  // ========================================

  /**
   * Rechazar múltiples enrollments en bloque.
   *
   * Validación individual: solo se pueden rechazar enrollments en estados
   * rechazables (SUBMITTED_FOR_VALIDATION, CLUB_APPROVED, COORDINATOR_APPROVED,
   * FIELD_APPROVED). Los demás se incluyen en `failed`.
   * Los elegibles se actualizan en una única transacción de Prisma.
   */
  async bulkRejectEnrollments(
    actorId: string,
    dto: BulkRejectEnrollmentsDto,
  ): Promise<{
    succeeded: number[];
    failed: { id: number; reason: string }[];
  }> {
    // 1. Fetch all requested enrollments in one query
    const enrollments = await this.prisma.enrollments.findMany({
      where: {
        enrollment_id: { in: dto.enrollmentIds },
        active: true,
      },
      select: {
        enrollment_id: true,
        investiture_status: true,
        user_id: true,
        ecclesiastical_year_id: true,
        classes: { select: { club_type_id: true } },
      },
    });

    // 2. Build lookup map
    const enrollmentMap = new Map(enrollments.map((e) => [e.enrollment_id, e]));

    const succeeded: number[] = [];
    const failed: { id: number; reason: string }[] = [];

    // 3. Classify each requested ID
    for (const id of dto.enrollmentIds) {
      const enrollment = enrollmentMap.get(id);

      if (!enrollment) {
        failed.push({ id, reason: 'Enrollment no encontrado o inactivo' });
        continue;
      }

      if (!REJECTABLE_STATUSES.includes(enrollment.investiture_status)) {
        failed.push({
          id,
          reason: `No se puede rechazar un enrollment en estado ${enrollment.investiture_status}`,
        });
        continue;
      }

      if (
        !(await this.canActorManageInvestitureEnrollment(actorId, enrollment))
      ) {
        failed.push({
          id,
          reason: 'Sin acceso al scope del enrollment',
        });
        continue;
      }

      succeeded.push(id);
    }

    // 4. Early exit if nothing to process
    if (succeeded.length === 0) {
      return { succeeded, failed };
    }

    const now = new Date();

    // 5. Atomic transaction
    await this.prisma.$transaction(async (tx) => {
      // W3 — Re-check eligible statuses atomically to guard against concurrent modifications.
      //      updateMany only touches rows still in a rejectable status.
      const updateResult = await tx.enrollments.updateMany({
        where: {
          enrollment_id: { in: succeeded },
          investiture_status: { in: REJECTABLE_STATUSES },
        },
        data: {
          investiture_status: investiture_status_enum.REJECTED,
          validated_by: actorId,
          validated_at: now,
          rejection_reason: dto.comments,
          locked_for_validation: false,
          submitted_for_validation: false,
        },
      });

      if (updateResult.count !== succeeded.length) {
        this.logger.warn(
          `Bulk reject: expected to update ${succeeded.length} rows but updated ${updateResult.count}. ` +
            `Possible concurrent modification.`,
        );
      }

      await tx.investiture_validation_history.createMany({
        data: succeeded.map((enrollmentId) => ({
          enrollment_id: enrollmentId,
          action: investiture_action_enum.REJECTED,
          performed_by: actorId,
          comments: dto.comments,
        })),
      });
    });

    this.logger.log(
      `Bulk reject by ${actorId}: ${succeeded.length} succeeded, ${failed.length} failed`,
    );

    // W1 — Notify each member of the rejection via Promise.allSettled
    await Promise.allSettled(
      succeeded.map((id) => {
        const enrollment = enrollmentMap.get(id)!;
        return this.notifications.notifySafe(
          enrollment.user_id,
          'Tu investidura ha sido rechazada',
          `El enrollment ha sido rechazado: ${dto.comments}`,
          { type: 'investiture', entity_id: String(id), status: 'rejected' },
          'investiture:rejected',
        );
      }),
    );

    return { succeeded, failed };
  }

  // ========================================
  // INVESTITURE CONFIG CRUD
  // ========================================

  /**
   * Listar todas las configuraciones de investidura.
   * Filtrado opcional por campo local.
   */
  async getConfigs(localFieldId?: number) {
    const where: Prisma.investiture_configWhereInput = {};
    if (localFieldId) {
      where.local_field_id = localFieldId;
    }

    return this.prisma.investiture_config.findMany({
      where,
      include: {
        local_fields: { select: { name: true } },
        ecclesiastical_year: { select: { start_date: true, end_date: true } },
      },
      orderBy: [{ ecclesiastical_year_id: 'desc' }, { local_field_id: 'asc' }],
    });
  }

  /**
   * Obtener una configuración de investidura por su ID.
   */
  async getConfig(configId: number) {
    const config = await this.prisma.investiture_config.findUnique({
      where: { config_id: configId },
      include: {
        local_fields: { select: { name: true } },
        ecclesiastical_year: { select: { start_date: true, end_date: true } },
      },
    });

    if (!config) {
      throw new AppNotFoundException(ErrorCode.INVESTITURE_CONFIG_NOT_FOUND);
    }

    return config;
  }

  /**
   * Crear una nueva configuración de investidura.
   * Fuerza UNIQUE(local_field_id, ecclesiastical_year_id).
   */
  async createConfig(dto: CreateInvestitureConfigDto) {
    try {
      return await this.prisma.investiture_config.create({
        data: {
          local_field_id: dto.local_field_id,
          ecclesiastical_year_id: dto.ecclesiastical_year_id,
          submission_deadline: new Date(dto.submission_deadline),
          investiture_date: new Date(dto.investiture_date),
        },
        include: {
          local_fields: { select: { name: true } },
          ecclesiastical_year: { select: { start_date: true, end_date: true } },
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppConflictException(ErrorCode.INVESTITURE_CONFIG_DUPLICATE);
      }
      throw error;
    }
  }

  /**
   * Actualizar deadline, fecha de investidura y/o estado activo de una config.
   */
  async updateConfig(configId: number, dto: UpdateInvestitureConfigDto) {
    await this.getConfig(configId);

    const data: Prisma.investiture_configUpdateInput = {};
    if (dto.submission_deadline !== undefined) {
      data.submission_deadline = new Date(dto.submission_deadline);
    }
    if (dto.investiture_date !== undefined) {
      data.investiture_date = new Date(dto.investiture_date);
    }
    if (dto.active !== undefined) {
      data.active = dto.active;
    }

    return this.prisma.investiture_config.update({
      where: { config_id: configId },
      data,
      include: {
        local_fields: { select: { name: true } },
        ecclesiastical_year: { select: { start_date: true, end_date: true } },
      },
    });
  }

  /**
   * Soft-delete: marcar una config como inactiva (active = false).
   */
  async deleteConfig(configId: number) {
    await this.getConfig(configId);

    const updated = await this.prisma.investiture_config.update({
      where: { config_id: configId },
      data: { active: false },
    });

    return { config_id: updated.config_id, active: updated.active };
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  private async canActorManageInvestitureEnrollment(
    actorId: string,
    enrollment: {
      user_id: string;
      ecclesiastical_year_id: number;
      classes: { club_type_id: number };
    },
  ): Promise<boolean> {
    const memberAssignment = await this.prisma.club_role_assignments.findFirst({
      where: {
        user_id: enrollment.user_id,
        active: true,
        status: 'active',
        ecclesiastical_year_id: enrollment.ecclesiastical_year_id,
        club_sections: {
          club_type_id: enrollment.classes.club_type_id,
        },
      },
      select: {
        club_sections: {
          select: {
            club_section_id: true,
            main_club_id: true,
          },
        },
      },
    });

    const section = memberAssignment?.club_sections;

    if (!section?.main_club_id) {
      return false;
    }

    if (
      await this.authorizationContext.canManageClub(
        actorId,
        section.main_club_id,
      )
    ) {
      return true;
    }

    const resolved =
      await this.authorizationContext.resolveUserAuthorization(actorId);
    const activeClubScope = resolved.authorization.effective.scope.club;

    return (
      activeClubScope?.club.club_id === section.main_club_id &&
      activeClubScope.section.club_section_id === section.club_section_id
    );
  }

  /**
   * Generic state transition for the approval chain.
   * Validates that the enrollment is in the expected source status,
   * transitions it to the next status, and creates a history entry.
   */
  private async transitionApprovalState(
    enrollmentId: number,
    actorId: string,
    expectedSourceStatus: investiture_status_enum,
    comments?: string,
  ): Promise<ApprovalResult> {
    // 1. Find enrollment
    const enrollment = await this.prisma.enrollments.findFirst({
      where: { enrollment_id: enrollmentId, active: true },
      select: {
        enrollment_id: true,
        user_id: true,
        investiture_status: true,
        users: {
          select: { local_field_id: true },
        },
      },
    });

    if (!enrollment) {
      throw new AppNotFoundException(
        ErrorCode.INVESTITURE_ENROLLMENT_NOT_FOUND,
      );
    }

    // 2. Validate current status matches expected
    if (enrollment.investiture_status !== expectedSourceStatus) {
      throw new AppConflictException(
        ErrorCode.INVESTITURE_INVALID_STATE_TRANSITION,
        { status: enrollment.investiture_status },
      );
    }

    // 3. Look up the transition
    const transition = APPROVAL_TRANSITIONS[expectedSourceStatus];
    if (!transition) {
      throw new AppBadRequestException(
        ErrorCode.INVESTITURE_INVALID_STATE_TRANSITION,
        { status: expectedSourceStatus },
      );
    }

    // 4. Transaction: update status + create history.
    // Use updateMany with the expected source status in the WHERE clause so the
    // write itself is the atomic guard — if another request already changed the
    // status between our read (step 1) and this write, count will be 0.
    const now = new Date();
    const updatedEnrollment = await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.enrollments.updateMany({
        where: {
          enrollment_id: enrollmentId,
          investiture_status: expectedSourceStatus,
        },
        data: {
          investiture_status: transition.target,
          validated_by: actorId,
          validated_at: now,
          rejection_reason: null,
          locked_for_validation: true,
        },
      });

      if (updateResult.count === 0) {
        throw new AppConflictException(ErrorCode.INVESTITURE_CONCURRENT_UPDATE);
      }

      await tx.investiture_validation_history.create({
        data: {
          enrollment_id: enrollmentId,
          action: transition.action,
          performed_by: actorId,
          comments: comments ?? null,
        },
      });

      // Row is guaranteed to exist: updateMany confirmed count > 0 above.
      return (await tx.enrollments.findUnique({
        where: { enrollment_id: enrollmentId },
      }))!;
    });

    this.logger.log(
      `Enrollment ${enrollmentId} transitioned ${expectedSourceStatus} → ${transition.target} by ${actorId}`,
    );

    // 5. Send notifications based on the new status
    try {
      const notifData = {
        type: 'investiture',
        entity_id: String(enrollmentId),
        status: transition.target,
      };

      switch (transition.target) {
        case investiture_status_enum.CLUB_APPROVED:
          // Club approved → notify coordinator (global role scoped to local field)
          if (enrollment.users.local_field_id) {
            void this.notifications.sendToGlobalRole(
              ['coordinator'],
              'Investidura aprobada por el club',
              'Un enrollment ha sido aprobado por el director y requiere revisión del coordinador',
              notifData,
              enrollment.users.local_field_id,
              'investiture:club_approved',
            );
          }
          break;

        case investiture_status_enum.COORDINATOR_APPROVED:
          // Coordinator approved → notify field (assistant-admin)
          if (enrollment.users.local_field_id) {
            void this.notifications.sendToGlobalRole(
              ['assistant-admin', 'admin'],
              'Investidura aprobada por coordinador',
              'Un enrollment ha sido aprobado por el coordinador y requiere aprobación del campo',
              notifData,
              enrollment.users.local_field_id,
              'investiture:coordinator_approved',
            );
          }
          break;

        case investiture_status_enum.FIELD_APPROVED:
          // Field approved → notify the member
          void this.notifications.notifySafe(
            enrollment.user_id,
            'Investidura aprobada por el campo',
            'Tu investidura ha sido aprobada a nivel de campo. Pronto serás investido.',
            notifData,
            'investiture:field_approved',
          );
          break;
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Notification failed for investiture transition ${enrollmentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      enrollment_id: updatedEnrollment.enrollment_id,
      investiture_status: updatedEnrollment.investiture_status,
      approved_by: actorId,
      approved_at: now,
    };
  }

  /**
   * Resolver el investiture_config activo para un enrollment dado.
   * Cadena: enrollment.user_id → users.local_field_id → investiture_config
   */
  private async resolveInvestitureConfig(enrollment: {
    user_id: string;
    ecclesiastical_year_id: number;
    users: { local_field_id: number | null };
  }) {
    const localFieldId = enrollment.users.local_field_id;
    const yearId = enrollment.ecclesiastical_year_id;

    if (!localFieldId) {
      throw new AppNotFoundException(ErrorCode.INVESTITURE_CONFIG_NOT_FOUND);
    }

    const config = await this.prisma.investiture_config.findFirst({
      where: {
        local_field_id: localFieldId,
        ecclesiastical_year_id: yearId,
        active: true,
      },
    });

    if (!config) {
      throw new AppNotFoundException(ErrorCode.INVESTITURE_CONFIG_NOT_FOUND);
    }

    return config;
  }
}

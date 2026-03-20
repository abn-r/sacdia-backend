import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PaginatedResult,
  PaginationDto,
  createPaginatedResult,
} from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { SubmitForValidationDto } from './dto/submit-for-validation.dto';
import { ValidateEnrollmentDto } from './dto/validate-enrollment.dto';
import { MarkInvestidoDto } from './dto/mark-investido.dto';

@Injectable()
export class InvestitureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

  // ========================================
  // SUBMIT FOR VALIDATION
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
      throw new NotFoundException('Enrollment no encontrado');
    }

    // Step 3: Validate state transition
    const validSourceStatuses = ['IN_PROGRESS', 'REJECTED'];
    if (!validSourceStatuses.includes(enrollment.investiture_status as string)) {
      throw new BadRequestException(
        `Transición inválida. El enrollment está en estado ${enrollment.investiture_status}`,
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
          investiture_status: 'SUBMITTED_FOR_VALIDATION',
          submitted_for_validation: true,
          submitted_at: submittedAt,
          locked_for_validation: true,
        },
      }),
      this.prisma.investiture_validation_history.create({
        data: {
          enrollment_id: enrollmentId,
          action: 'SUBMITTED',
          performed_by: actorId,
          comments: dto.comments ?? null,
        },
      }),
    ]);

    // Step 7: Return result
    return {
      enrollment_id: updatedEnrollment.enrollment_id,
      investiture_status: updatedEnrollment.investiture_status as string,
      submitted_at: updatedEnrollment.submitted_at as Date,
      is_late,
    };
  }

  // ========================================
  // VALIDATE ENROLLMENT
  // ========================================

  /**
   * Aprobar o rechazar un enrollment en estado SUBMITTED_FOR_VALIDATION.
   * APPROVED mantiene locked_for_validation = true.
   * REJECTED desbloquea el enrollment para corrección y re-envío.
   */
  async validateEnrollment(
    enrollmentId: number,
    actorId: string,
    dto: ValidateEnrollmentDto,
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
      throw new NotFoundException('Enrollment no encontrado');
    }

    // 2. Validate state
    if (enrollment.investiture_status !== 'SUBMITTED_FOR_VALIDATION') {
      throw new ConflictException(
        `El enrollment no está en estado SUBMITTED_FOR_VALIDATION. Estado actual: ${enrollment.investiture_status}`,
      );
    }

    // 3. Business validation: REJECTED requires comments
    if (
      dto.action === 'REJECTED' &&
      (!dto.comments || dto.comments.trim() === '')
    ) {
      throw new BadRequestException(
        'El campo comments es requerido para rechazar un enrollment',
      );
    }

    // 4. Transaction
    const now = new Date();

    const updatedEnrollment = await this.prisma.$transaction(async (tx) => {
      if (dto.action === 'APPROVED') {
        const updated = await tx.enrollments.update({
          where: { enrollment_id: enrollmentId },
          data: {
            investiture_status: 'APPROVED',
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
            action: 'APPROVED',
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
            investiture_status: 'REJECTED',
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
            action: 'REJECTED',
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
  // MARK INVESTIDO
  // ========================================

  /**
   * Registrar la investidura formal de un enrollment en estado APPROVED.
   * Hace auto-sync de users_classes con investiture = true.
   */
  async markInvestido(
    enrollmentId: number,
    actorId: string,
    dto: MarkInvestidoDto,
  ): Promise<{
    enrollment_id: number;
    investiture_status: string;
    investiture_date: Date | null;
    users_classes_synced: boolean;
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
      },
    });

    // Step 2: Throw if not found or inactive
    if (!enrollment || enrollment.active === false) {
      throw new NotFoundException('Enrollment no encontrado');
    }

    // Step 3: Validate state — must be APPROVED
    const currentStatus = enrollment.investiture_status;

    if (currentStatus === 'INVESTIDO') {
      throw new ConflictException('El enrollment ya fue investido');
    }

    if (currentStatus !== 'APPROVED') {
      throw new BadRequestException(
        `El enrollment debe estar en estado APPROVED para ser investido. Estado actual: ${currentStatus}`,
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
          investiture_status: 'INVESTIDO',
          investiture_date: investitureConfig.investiture_date,
        },
      });

      // 5b. Create history entry
      await tx.investiture_validation_history.create({
        data: {
          enrollment_id: enrollmentId,
          action: 'INVESTIDO',
          performed_by: actorId,
          comments: dto.comments ?? 'Marcado como investido',
        },
      });

      // 5c. Auto-sync users_classes (backwards compatibility with Flutter app)
      // TODO: Migrar lecturas de Flutter a enrollments.investiture_status y deprecar users_classes.investiture
      await tx.users_classes.upsert({
        where: {
          user_id_class_id: {
            user_id: enrollment.user_id,
            class_id: enrollment.class_id,
          },
        },
        update: {
          investiture: true,
          date_investiture: investitureConfig.investiture_date,
        },
        create: {
          user_id: enrollment.user_id,
          class_id: enrollment.class_id,
          investiture: true,
          date_investiture: investitureConfig.investiture_date,
          current_class: true,
          active: true,
        },
      });

      return updatedEnrollment;
    });

    // Step 6: Return result
    return {
      enrollment_id: updated.enrollment_id,
      investiture_status: updated.investiture_status,
      investiture_date: updated.investiture_date,
      users_classes_synced: true,
    };
  }

  // ========================================
  // GET PENDING
  // ========================================

  /**
   * Listar enrollments en estado SUBMITTED_FOR_VALIDATION con paginación.
   * Auto-scoping: si no se provee localFieldId, se usa el campo local del actor.
   * Filtros opcionales: localFieldId, ecclesiasticalYearId.
   */
  async getPending(
    actorId: string,
    localFieldId?: number,
    ecclesiasticalYearId?: number,
    page?: number,
    limit?: number,
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

    // Build where clause
    const where: Prisma.enrollmentsWhereInput = {
      investiture_status: 'SUBMITTED_FOR_VALIDATION',
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
   * MVP simplification: global roles (admin/coordinator/super_admin/assistant_admin) bypass
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
      throw new NotFoundException('Enrollment no encontrado');
    }

    // 2. Authorization check — query DB for actual global roles (JWT payload does NOT carry roles)
    const allowedGlobalRoles = [
      'admin',
      'coordinator',
      'super_admin',
      'assistant_admin',
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
          throw new ForbiddenException(
            'Sin acceso al historial de este enrollment',
          );
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
        action: entry.action as string,
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
  // PRIVATE HELPERS
  // ========================================

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
      throw new NotFoundException(
        'No existe configuración de investidura para este campo local y año eclesiástico',
      );
    }

    const config = await this.prisma.investiture_config.findFirst({
      where: {
        local_field_id: localFieldId,
        ecclesiastical_year_id: yearId,
        active: true,
      },
    });

    if (!config) {
      throw new NotFoundException(
        'No existe configuración de investidura para este campo local y año eclesiástico',
      );
    }

    return config;
  }
}

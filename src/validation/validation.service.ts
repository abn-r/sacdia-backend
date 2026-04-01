import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  investiture_status_enum,
  investiture_action_enum,
} from '@prisma/client';

type EntityType = 'class' | 'honor';

@Injectable()
export class ValidationService {
  private readonly logger = new Logger(ValidationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ========================================
  // SUBMIT FOR REVIEW
  // ========================================

  async submitForReview(
    entityType: EntityType,
    entityId: number,
    userId: string,
  ) {
    if (entityType === 'class') {
      return this.submitClassForReview(entityId, userId);
    }
    return this.submitHonorForReview(entityId, userId);
  }

  private async submitClassForReview(enrollmentId: number, userId: string) {
    const enrollment = await this.prisma.enrollments.findUnique({
      where: { enrollment_id: enrollmentId },
    });

    if (!enrollment) {
      throw new NotFoundException(
        `Inscripcion con ID ${enrollmentId} no encontrada`,
      );
    }

    if (enrollment.user_id !== userId) {
      throw new BadRequestException(
        'La inscripcion no pertenece al usuario autenticado',
      );
    }

    if (enrollment.investiture_status !== investiture_status_enum.IN_PROGRESS) {
      throw new BadRequestException(
        `La inscripcion debe estar en estado IN_PROGRESS para enviar a revision. Estado actual: ${enrollment.investiture_status}`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.enrollments.update({
        where: { enrollment_id: enrollmentId },
        data: {
          investiture_status: investiture_status_enum.SUBMITTED_FOR_VALIDATION,
          submitted_for_validation: true,
          submitted_at: new Date(),
          locked_for_validation: true,
        },
      });

      await tx.investiture_validation_history.create({
        data: {
          enrollment_id: enrollmentId,
          action: investiture_action_enum.SUBMITTED,
          performed_by: userId,
          comments: 'Enviado a revision por el miembro',
        },
      });

      // Generic validation log
      await tx.validation_logs.create({
        data: {
          entity_type: 'class',
          entity_id: String(enrollmentId),
          user_id: userId,
          action: 'submitted',
          performed_by: userId,
          comment: 'Enviado a revision por el miembro',
        },
      });

      return updated;
    });

    // Notify coordinators/directors of the member's section
    try {
      const memberSection = await this.prisma.club_role_assignments.findFirst({
        where: { user_id: userId, active: true },
        select: { club_section_id: true },
      });

      if (memberSection?.club_section_id) {
        void this.notifications.sendToSectionRole(
          memberSection.club_section_id,
          ['coordinator', 'director'],
          'Nueva clase enviada a revisión',
          'Un miembro ha enviado una clase para validación',
          {
            type: 'validation',
            entity_type: 'class',
            entity_id: String(enrollmentId),
          },
          'validation:class_submitted',
        );
      }
    } catch (error) {
      this.logger.warn(
        `Notification failed for class submission ${enrollmentId}: ${error.message}`,
      );
    }

    return result;
  }

  private async submitHonorForReview(userHonorId: number, userId: string) {
    const userHonor = await this.prisma.users_honors.findUnique({
      where: { user_honor_id: userHonorId },
    });

    if (!userHonor) {
      throw new NotFoundException(
        `Honor de usuario con ID ${userHonorId} no encontrado`,
      );
    }

    if (userHonor.user_id !== userId) {
      throw new BadRequestException(
        'El honor no pertenece al usuario autenticado',
      );
    }

    if (
      userHonor.validate === true ||
      userHonor.validation_status === 'APPROVED'
    ) {
      throw new BadRequestException('El honor ya se encuentra validado');
    }

    if (userHonor.validation_status === 'PENDING_REVIEW') {
      throw new BadRequestException(
        'El honor ya se encuentra pendiente de revision',
      );
    }

    // Allow submission from: IN_PROGRESS, REJECTED
    const allowedStatuses = ['IN_PROGRESS', 'REJECTED'];
    if (!allowedStatuses.includes(userHonor.validation_status)) {
      throw new BadRequestException(
        `El honor debe estar en estado IN_PROGRESS o REJECTED para enviar a revision. Estado actual: ${userHonor.validation_status}`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.users_honors.update({
        where: { user_honor_id: userHonorId },
        data: {
          validation_status: 'PENDING_REVIEW',
          submitted_at: new Date(),
          rejection_reason: null, // Clear any previous rejection
          modified_at: new Date(),
        },
      });

      // Generic validation log
      await tx.validation_logs.create({
        data: {
          entity_type: 'honor',
          entity_id: String(userHonorId),
          user_id: userId,
          action: 'submitted',
          performed_by: userId,
          comment: 'Honor enviado a revision por el miembro',
        },
      });

      return updated;
    });

    // Notify coordinators/directors of the member's section
    try {
      const memberSection = await this.prisma.club_role_assignments.findFirst({
        where: { user_id: userId, active: true },
        select: { club_section_id: true },
      });

      if (memberSection?.club_section_id) {
        void this.notifications.sendToSectionRole(
          memberSection.club_section_id,
          ['coordinator', 'director'],
          'Nuevo honor enviado a revisión',
          'Un miembro ha enviado un honor para validación',
          {
            type: 'validation',
            entity_type: 'honor',
            entity_id: String(userHonorId),
          },
          'validation:honor_submitted',
        );
      }
    } catch (error) {
      this.logger.warn(
        `Notification failed for honor submission ${userHonorId}: ${error.message}`,
      );
    }

    return result;
  }

  // ========================================
  // REVIEW (APPROVE / REJECT)
  // ========================================

  async review(
    entityType: EntityType,
    entityId: number,
    action: 'approved' | 'rejected',
    performedBy: string,
    comment?: string,
  ) {
    if (action === 'rejected' && !comment) {
      throw new BadRequestException(
        'Se requiere un comentario al rechazar una validacion',
      );
    }

    if (entityType === 'class') {
      return this.reviewClass(entityId, action, performedBy, comment);
    }
    return this.reviewHonor(entityId, action, performedBy, comment);
  }

  private async reviewClass(
    enrollmentId: number,
    action: 'approved' | 'rejected',
    performedBy: string,
    comment?: string,
  ) {
    const enrollment = await this.prisma.enrollments.findUnique({
      where: { enrollment_id: enrollmentId },
    });

    if (!enrollment) {
      throw new NotFoundException(
        `Inscripcion con ID ${enrollmentId} no encontrada`,
      );
    }

    if (
      enrollment.investiture_status !==
      investiture_status_enum.SUBMITTED_FOR_VALIDATION
    ) {
      throw new BadRequestException(
        `La inscripcion debe estar en estado SUBMITTED_FOR_VALIDATION para revisar. Estado actual: ${enrollment.investiture_status}`,
      );
    }

    const newStatus =
      action === 'approved'
        ? investiture_status_enum.APPROVED
        : investiture_status_enum.IN_PROGRESS;

    const historyAction =
      action === 'approved'
        ? investiture_action_enum.APPROVED
        : investiture_action_enum.REJECTED;

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.enrollments.update({
        where: { enrollment_id: enrollmentId },
        data: {
          investiture_status: newStatus,
          validated_by: performedBy,
          validated_at: new Date(),
          rejection_reason: action === 'rejected' ? comment : null,
          locked_for_validation: action === 'approved',
          submitted_for_validation: action === 'rejected' ? false : true,
        },
      });

      await tx.investiture_validation_history.create({
        data: {
          enrollment_id: enrollmentId,
          action: historyAction,
          performed_by: performedBy,
          comments: comment ?? null,
        },
      });

      // Generic validation log
      await tx.validation_logs.create({
        data: {
          entity_type: 'class',
          entity_id: String(enrollmentId),
          user_id: enrollment.user_id,
          action,
          performed_by: performedBy,
          comment: comment ?? null,
        },
      });

      return updated;
    });

    // Notify the member about approval/rejection
    try {
      const title =
        action === 'approved' ? 'Clase aprobada' : 'Clase rechazada';
      const body =
        action === 'approved'
          ? 'Tu clase ha sido aprobada por el revisor'
          : `Tu clase ha sido rechazada: ${comment}`;

      void this.notifications.notifySafe(
        enrollment.user_id,
        title,
        body,
        {
          type: 'validation',
          entity_type: 'class',
          entity_id: String(enrollmentId),
          action,
        },
        `validation:class_${action}`,
      );
    } catch (error) {
      this.logger.warn(
        `Notification failed for class review ${enrollmentId}: ${error.message}`,
      );
    }

    return result;
  }

  private async reviewHonor(
    userHonorId: number,
    action: 'approved' | 'rejected',
    performedBy: string,
    comment?: string,
  ) {
    const userHonor = await this.prisma.users_honors.findUnique({
      where: { user_honor_id: userHonorId },
    });

    if (!userHonor) {
      throw new NotFoundException(
        `Honor de usuario con ID ${userHonorId} no encontrado`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Update validation_status + backward-compat boolean
      const newValidationStatus =
        action === 'approved' ? 'APPROVED' : 'REJECTED';

      const updated = await tx.users_honors.update({
        where: { user_honor_id: userHonorId },
        data: {
          validate: action === 'approved',
          validation_status: newValidationStatus,
          validated_by_id: performedBy,
          validated_at: new Date(),
          rejection_reason: action === 'rejected' ? comment : null,
          modified_at: new Date(),
        },
      });

      // Generic validation log
      await tx.validation_logs.create({
        data: {
          entity_type: 'honor',
          entity_id: String(userHonorId),
          user_id: userHonor.user_id,
          action,
          performed_by: performedBy,
          comment: comment ?? null,
        },
      });

      return updated;
    });

    // Notify the member about approval/rejection
    try {
      const title =
        action === 'approved' ? 'Honor aprobado' : 'Honor rechazado';
      const body =
        action === 'approved'
          ? 'Tu honor ha sido aprobado por el revisor'
          : `Tu honor ha sido rechazado: ${comment}`;

      void this.notifications.notifySafe(
        userHonor.user_id,
        title,
        body,
        {
          type: 'validation',
          entity_type: 'honor',
          entity_id: String(userHonorId),
          action,
        },
        `validation:honor_${action}`,
      );
    } catch (error) {
      this.logger.warn(
        `Notification failed for honor review ${userHonorId}: ${error.message}`,
      );
    }

    return result;
  }

  // ========================================
  // PENDING REVIEWS
  // ========================================

  async getPendingReviews(filters?: {
    club_section_id?: number;
    entity_type?: EntityType;
  }) {
    const results: {
      classes: unknown[];
      honors: unknown[];
    } = { classes: [], honors: [] };

    const shouldIncludeClasses =
      !filters?.entity_type || filters.entity_type === 'class';
    const shouldIncludeHonors =
      !filters?.entity_type || filters.entity_type === 'honor';

    if (shouldIncludeClasses) {
      results.classes = await this.prisma.enrollments.findMany({
        where: {
          investiture_status: investiture_status_enum.SUBMITTED_FOR_VALIDATION,
          active: true,
          ...(filters?.club_section_id
            ? {
                users: {
                  club_role_assignments: {
                    some: {
                      club_section_id: filters.club_section_id,
                      active: true,
                    },
                  },
                },
              }
            : {}),
        },
        include: {
          users: {
            select: {
              user_id: true,
              name: true,
              paternal_last_name: true,
              maternal_last_name: true,
              email: true,
            },
          },
          classes: {
            select: {
              class_id: true,
              name: true,
              club_type_id: true,
            },
          },
        },
        orderBy: { submitted_at: 'asc' },
      });
    }

    if (shouldIncludeHonors) {
      results.honors = await this.prisma.users_honors.findMany({
        where: {
          validation_status: 'PENDING_REVIEW',
          active: true,
          ...(filters?.club_section_id
            ? {
                users: {
                  club_role_assignments: {
                    some: {
                      club_section_id: filters.club_section_id,
                      active: true,
                    },
                  },
                },
              }
            : {}),
        },
        include: {
          users: {
            select: {
              user_id: true,
              name: true,
              paternal_last_name: true,
              maternal_last_name: true,
              email: true,
            },
          },
          honors: {
            select: {
              honor_id: true,
              name: true,
            },
          },
        },
        orderBy: { created_at: 'asc' },
      });
    }

    return results;
  }

  // ========================================
  // VALIDATION HISTORY
  // ========================================

  async getValidationHistory(entityType: EntityType, entityId: number) {
    // Use the generic validation_logs table for both classes and honors
    return this.prisma.validation_logs.findMany({
      where: {
        entity_type: entityType,
        entity_id: String(entityId),
      },
      include: {
        performer: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  // ========================================
  // INVESTITURE ELIGIBILITY CHECK
  // ========================================

  async checkInvestmentEligibility(userId: string) {
    // Read configurable threshold from system_config
    const config = await this.prisma.system_config.findUnique({
      where: { config_key: 'investiture.min_approval_percentage' },
    });

    const threshold = config ? parseFloat(config.config_value) : 80;

    // Count approved vs total enrollments for the user
    const enrollments = await this.prisma.enrollments.findMany({
      where: {
        user_id: userId,
        active: true,
      },
      select: {
        enrollment_id: true,
        investiture_status: true,
      },
    });

    const totalEnrollments = enrollments.length;
    const approvedEnrollments = enrollments.filter(
      (e) =>
        e.investiture_status === investiture_status_enum.APPROVED ||
        e.investiture_status === investiture_status_enum.INVESTIDO,
    ).length;

    // Count validated honors
    const honorsAgg = await this.prisma.users_honors.aggregate({
      where: { user_id: userId, active: true },
      _count: { user_honor_id: true },
    });
    const validatedHonorsAgg = await this.prisma.users_honors.aggregate({
      where: { user_id: userId, active: true, validate: true },
      _count: { user_honor_id: true },
    });

    const totalHonors = honorsAgg._count.user_honor_id;
    const validatedHonors = validatedHonorsAgg._count.user_honor_id;

    const totalRequirements = totalEnrollments + totalHonors;
    const approvedRequirements = approvedEnrollments + validatedHonors;

    const percentage =
      totalRequirements > 0
        ? Math.round((approvedRequirements / totalRequirements) * 100 * 100) /
          100
        : 0;

    return {
      eligible: percentage >= threshold,
      percentage,
      threshold,
      detail: {
        classes: {
          total: totalEnrollments,
          approved: approvedEnrollments,
        },
        honors: {
          total: totalHonors,
          validated: validatedHonors,
        },
      },
    };
  }
}

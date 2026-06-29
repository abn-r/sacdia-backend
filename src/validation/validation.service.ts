import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  investiture_status_enum,
  investiture_action_enum,
} from '@prisma/client';
import {
  AppBadRequestException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { HonorValidationWorkflowService } from '../honors/honor-validation-workflow.service';

type EntityType = 'class' | 'honor';

@Injectable()
export class ValidationService {
  private readonly logger = new Logger(ValidationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly honorValidationWorkflow: HonorValidationWorkflowService,
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
    return this.honorValidationWorkflow.submitForReview(entityId, userId);
  }

  private async submitClassForReview(enrollmentId: number, userId: string) {
    const enrollment = await this.prisma.enrollments.findUnique({
      where: { enrollment_id: enrollmentId },
    });

    if (!enrollment) {
      throw new AppNotFoundException(ErrorCode.VALIDATION_ENROLLMENT_NOT_FOUND);
    }

    if (enrollment.user_id !== userId) {
      throw new AppBadRequestException(
        ErrorCode.VALIDATION_ENROLLMENT_NOT_OWNED,
      );
    }

    if (enrollment.investiture_status !== investiture_status_enum.IN_PROGRESS) {
      throw new AppBadRequestException(
        ErrorCode.VALIDATION_ENROLLMENT_NOT_IN_PROGRESS,
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
          'Clase lista para revisar',
          'Un miembro completó una clase y espera revisión',
          {
            type: 'validation',
            entity_type: 'class',
            entity_id: String(enrollmentId),
          },
          'validation:class_submitted',
        );
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Notification failed for class submission ${enrollmentId}: ${error instanceof Error ? error.message : String(error)}`,
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
      throw new AppBadRequestException(
        ErrorCode.VALIDATION_REJECT_COMMENT_REQUIRED,
      );
    }

    if (entityType === 'class') {
      return this.reviewClass(entityId, action, performedBy, comment);
    }

    if (action === 'approved') {
      return this.honorValidationWorkflow.approve(
        entityId,
        performedBy,
        comment,
      );
    }

    return this.honorValidationWorkflow.reject(entityId, performedBy, comment!);
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
      throw new AppNotFoundException(ErrorCode.VALIDATION_ENROLLMENT_NOT_FOUND);
    }

    if (
      enrollment.investiture_status !==
      investiture_status_enum.SUBMITTED_FOR_VALIDATION
    ) {
      throw new AppBadRequestException(
        ErrorCode.VALIDATION_ENROLLMENT_NOT_SUBMITTED,
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
        action === 'approved' ? '¡Tu clase fue aprobada!' : 'Tu clase necesita ajustes';
      const body =
        action === 'approved'
          ? 'Tu avance ya quedó validado. ¡Buen trabajo!'
          : `Tu clase necesita ajustes${comment ? ': ' + comment : '.'}`;

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
    } catch (error: unknown) {
      this.logger.warn(
        `Notification failed for class review ${enrollmentId}: ${error instanceof Error ? error.message : String(error)}`,
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

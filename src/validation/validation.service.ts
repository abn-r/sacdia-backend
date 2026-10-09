import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { investiture_status_enum } from '@prisma/client';
import { AppBadRequestException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { HonorValidationWorkflowService } from '../honors/honor-validation-workflow.service';
import { throwLegacyInvestiturePipelineRetired } from '../investiture/legacy-investiture-pipeline-retired';

type EntityType = 'class' | 'honor';

@Injectable()
export class ValidationService {
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
      throwLegacyInvestiturePipelineRetired();
    }
    return this.honorValidationWorkflow.submitForReview(entityId, userId);
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
    if (entityType === 'class') {
      throwLegacyInvestiturePipelineRetired();
    }

    if (action === 'rejected' && !comment) {
      throw new AppBadRequestException(
        ErrorCode.VALIDATION_REJECT_COMMENT_REQUIRED,
      );
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

  // ========================================
  // PENDING REVIEWS
  // ========================================

  async getPendingReviews(filters?: {
    club_section_id?: number;
    entity_type?: EntityType;
  }) {
    const results: { classes: unknown[]; honors: unknown[] } = {
      classes: [],
      honors: [],
    };
    const shouldIncludeHonors =
      !filters?.entity_type || filters.entity_type === 'honor';

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

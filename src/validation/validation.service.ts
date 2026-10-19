import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { investiture_status_enum, Prisma } from '@prisma/client';
import {
  AppBadRequestException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { HonorValidationWorkflowService } from '../honors/honor-validation-workflow.service';
import { throwLegacyInvestiturePipelineRetired } from '../investiture/legacy-investiture-pipeline-retired';
import {
  type ActorSectionScope,
  type ActorSectionScopePermissions,
  activeMembershipInScopeWhere,
  isActorSectionScopeEmpty,
} from '../common/authorization/actor-section-scope';
import { ActorSectionScopeService } from '../coordination/actor-section-scope.service';

type EntityType = 'class' | 'honor';

/**
 * Who may see or decide someone else's validation: reviewers, scoped to the
 * sections they review (club staff), coordinate, or govern (territory).
 */
export const VALIDATION_REVIEW_SCOPE: ActorSectionScopePermissions = {
  club: 'validation:review',
  global: 'validation:review',
};

@Injectable()
export class ValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly honorValidationWorkflow: HonorValidationWorkflowService,
    private readonly actorSectionScope: ActorSectionScopeService,
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

    // Only a reviewer whose scope covers the member may decide. Outside the
    // scope the honor does not exist for this actor (no enumeration).
    const owner = await this.findHonorOwner(entityId);
    const scope = await this.actorSectionScope.resolve(
      performedBy,
      VALIDATION_REVIEW_SCOPE,
    );
    if (!(await this.actorSectionScope.includesMember(scope, owner))) {
      throw new AppNotFoundException(ErrorCode.VALIDATION_USER_HONOR_NOT_FOUND);
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

  async getPendingReviews(
    actorId: string,
    filters?: {
      club_section_id?: number;
      entity_type?: EntityType;
    },
  ) {
    const results: { classes: unknown[]; honors: unknown[] } = {
      classes: [],
      honors: [],
    };
    const shouldIncludeHonors =
      !filters?.entity_type || filters.entity_type === 'honor';

    if (!shouldIncludeHonors) {
      return results;
    }

    const scope = await this.actorSectionScope.resolve(
      actorId,
      VALIDATION_REVIEW_SCOPE,
    );
    if (isActorSectionScopeEmpty(scope)) {
      // Not a reviewer anywhere: nobody else's pending items.
      return results;
    }

    results.honors = await this.prisma.users_honors.findMany({
      where: {
        validation_status: 'PENDING_REVIEW',
        active: true,
        ...this.pendingMemberWhere(scope, filters?.club_section_id),
      },
      include: {
        users: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
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

    return results;
  }

  private pendingMemberWhere(
    scope: ActorSectionScope,
    clubSectionId?: number,
  ): Pick<Prisma.users_honorsWhereInput, 'users'> {
    if (scope.all && clubSectionId === undefined) {
      return {};
    }

    return {
      users: {
        club_role_assignments: {
          some: activeMembershipInScopeWhere(scope, clubSectionId),
        },
      },
    };
  }

  // ========================================
  // VALIDATION HISTORY
  // ========================================

  async getValidationHistory(
    entityType: EntityType,
    entityId: number,
    actorId: string,
  ) {
    const ownerId =
      entityType === 'class'
        ? await this.findClassProgressOwner(entityId)
        : await this.findHonorOwner(entityId);

    if (ownerId !== actorId) {
      const scope = await this.actorSectionScope.resolve(
        actorId,
        VALIDATION_REVIEW_SCOPE,
      );
      if (!(await this.actorSectionScope.includesMember(scope, ownerId))) {
        this.throwEntityNotFound(entityType);
      }
    }

    // Use the generic validation_logs table for both classes and honors.
    // `user_id` pins the logs to the owner that was authorized above.
    return this.prisma.validation_logs.findMany({
      where: {
        entity_type: entityType,
        entity_id: String(entityId),
        user_id: ownerId,
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

  private async findHonorOwner(userHonorId: number): Promise<string> {
    const honor = await this.prisma.users_honors.findUnique({
      where: { user_honor_id: userHonorId },
      select: { user_id: true },
    });
    if (!honor) {
      this.throwEntityNotFound('honor');
    }
    return honor.user_id;
  }

  private async findClassProgressOwner(
    sectionProgressId: number,
  ): Promise<string> {
    const progress = await this.prisma.class_section_progress.findUnique({
      where: { section_progress_id: sectionProgressId },
      select: { user_id: true },
    });
    if (!progress) {
      this.throwEntityNotFound('class');
    }
    return progress.user_id;
  }

  private throwEntityNotFound(entityType: EntityType): never {
    throw new AppNotFoundException(
      entityType === 'class'
        ? ErrorCode.EVIDENCE_REVIEW_CLASS_RECORD_NOT_FOUND
        : ErrorCode.VALIDATION_USER_HONOR_NOT_FOUND,
    );
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

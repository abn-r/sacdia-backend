import { Injectable, Logger } from '@nestjs/common';
import { AchievementsService } from '../achievements/achievements.service';
import {
  AppBadRequestException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  HonorValidationResult,
  HonorValidationStatus,
} from './honor-validation-workflow.types';

const HONOR_STATUS_IN_PROGRESS = 'IN_PROGRESS' as const;
const HONOR_STATUS_PENDING = 'PENDING_REVIEW' as const;
const HONOR_STATUS_APPROVED = 'APPROVED' as const;
const HONOR_STATUS_REJECTED = 'REJECTED' as const;

type UserHonorRecord = {
  user_honor_id: number;
  user_id: string;
  honor_id: number;
  active: boolean;
  validate: boolean;
  validation_status: string;
  images: unknown;
  document: string | null;
  certificate: string | null;
  validated_at: Date | null;
  modified_at: Date;
};

@Injectable()
export class HonorValidationWorkflowService {
  private readonly logger = new Logger(HonorValidationWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly achievementsService: AchievementsService,
  ) {}

  async submitForReview(userHonorId: number, userId: string) {
    const userHonor = await this.prisma.users_honors.findUnique({
      where: { user_honor_id: userHonorId },
    });

    if (!userHonor) {
      throw new AppNotFoundException(ErrorCode.VALIDATION_USER_HONOR_NOT_FOUND);
    }

    if (userHonor.user_id !== userId) {
      throw new AppBadRequestException(ErrorCode.VALIDATION_HONOR_NOT_OWNED);
    }

    if (!userHonor.active) {
      throw new AppBadRequestException(ErrorCode.VALIDATION_HONOR_INACTIVE);
    }

    if (
      userHonor.validate === true ||
      userHonor.validation_status === HONOR_STATUS_APPROVED
    ) {
      throw new AppBadRequestException(
        ErrorCode.VALIDATION_HONOR_ALREADY_VALIDATED,
      );
    }

    if (userHonor.validation_status === HONOR_STATUS_PENDING) {
      throw new AppBadRequestException(
        ErrorCode.VALIDATION_HONOR_ALREADY_PENDING,
      );
    }

    if (
      ![HONOR_STATUS_IN_PROGRESS, HONOR_STATUS_REJECTED].includes(
        userHonor.validation_status as typeof HONOR_STATUS_IN_PROGRESS,
      )
    ) {
      throw new AppBadRequestException(
        ErrorCode.VALIDATION_HONOR_INVALID_STATUS,
      );
    }

    await this.assertSubmitEligibility(userHonor as UserHonorRecord);

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.users_honors.update({
        where: { user_honor_id: userHonorId },
        data: {
          validation_status: HONOR_STATUS_PENDING,
          submitted_at: now,
          rejection_reason: null,
          modified_at: now,
        },
      });

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

    await this.notifyHonorSubmitted(userHonorId, userId);

    return result;
  }

  async approve(
    userHonorId: number,
    actorId: string,
    comments?: string,
  ): Promise<HonorValidationResult> {
    const record = await this.prisma.users_honors.findUnique({
      where: { user_honor_id: userHonorId },
      include: {
        honors: {
          select: {
            honor_id: true,
            name: true,
            honors_category_id: true,
            club_type_id: true,
          },
        },
      },
    });

    if (!record) {
      throw new AppNotFoundException(
        ErrorCode.EVIDENCE_REVIEW_USER_HONOR_NOT_FOUND,
        { id: userHonorId },
      );
    }

    if (record.validation_status !== HONOR_STATUS_PENDING) {
      throw new AppBadRequestException(ErrorCode.VALIDATION_HONOR_NOT_PENDING, {
        status: record.validation_status,
      });
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.users_honors.update({
        where: { user_honor_id: userHonorId },
        data: {
          validation_status: HONOR_STATUS_APPROVED,
          validate: true,
          validated_by_id: actorId,
          validated_at: now,
          rejection_reason: null,
          modified_at: now,
        },
      });

      await tx.validation_logs.create({
        data: {
          entity_type: 'honor',
          entity_id: String(userHonorId),
          user_id: record.user_id,
          action: 'APPROVED',
          performed_by: actorId,
          comment: comments ?? null,
        },
      });

      return result;
    });

    await Promise.all([
      this.emitHonorValidated(record),
      this.notifyHonorReviewed(record.user_id, userHonorId, 'approved'),
    ]);

    return this.toValidationResult(
      updated.user_honor_id,
      updated.validation_status,
    );
  }

  async reject(
    userHonorId: number,
    actorId: string,
    reason: string,
  ): Promise<HonorValidationResult> {
    const record = await this.prisma.users_honors.findUnique({
      where: { user_honor_id: userHonorId },
    });

    if (!record) {
      throw new AppNotFoundException(
        ErrorCode.EVIDENCE_REVIEW_USER_HONOR_NOT_FOUND,
        { id: userHonorId },
      );
    }

    if (record.validation_status !== HONOR_STATUS_PENDING) {
      throw new AppBadRequestException(ErrorCode.VALIDATION_HONOR_NOT_PENDING, {
        status: record.validation_status,
      });
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.users_honors.update({
        where: { user_honor_id: userHonorId },
        data: {
          validation_status: HONOR_STATUS_REJECTED,
          validate: false,
          validated_by_id: actorId,
          validated_at: now,
          rejection_reason: reason,
          modified_at: now,
        },
      });

      await tx.validation_logs.create({
        data: {
          entity_type: 'honor',
          entity_id: String(userHonorId),
          user_id: record.user_id,
          action: 'REJECTED',
          performed_by: actorId,
          comment: reason,
        },
      });

      return result;
    });

    await this.notifyHonorReviewed(
      record.user_id,
      userHonorId,
      'rejected',
      reason,
    );

    return this.toValidationResult(
      updated.user_honor_id,
      updated.validation_status,
    );
  }

  private async assertSubmitEligibility(userHonor: UserHonorRecord) {
    const hasEvidence = await this.hasMinimumEvidence(userHonor);
    if (!hasEvidence) {
      throw new AppBadRequestException(
        ErrorCode.VALIDATION_HONOR_MISSING_EVIDENCE,
      );
    }

    const requirementsComplete = await this.areRequiredRequirementsComplete(
      userHonor.user_honor_id,
      userHonor.honor_id,
    );
    if (!requirementsComplete) {
      throw new AppBadRequestException(
        ErrorCode.VALIDATION_HONOR_REQUIREMENTS_INCOMPLETE,
      );
    }

    if (
      userHonor.validation_status === HONOR_STATUS_REJECTED &&
      userHonor.validated_at &&
      userHonor.modified_at <= userHonor.validated_at
    ) {
      throw new AppBadRequestException(
        ErrorCode.VALIDATION_HONOR_NO_CHANGES_AFTER_REJECTION,
      );
    }
  }

  private async hasMinimumEvidence(
    userHonor: Pick<
      UserHonorRecord,
      'user_honor_id' | 'images' | 'document' | 'certificate'
    >,
  ): Promise<boolean> {
    const images = Array.isArray(userHonor.images) ? userHonor.images : [];
    if (
      images.length > 0 ||
      Boolean(userHonor.document) ||
      Boolean(userHonor.certificate)
    ) {
      return true;
    }

    const generalEvidenceCount = await this.prisma.evidence_files.count({
      where: { user_honor_id: userHonor.user_honor_id, active: true },
    });
    if (generalEvidenceCount > 0) {
      return true;
    }

    const requirementEvidenceCount =
      await this.prisma.requirement_evidence.count({
        where: {
          active: true,
          progress: {
            user_honor_id: userHonor.user_honor_id,
            active: true,
          },
        },
      });

    return requirementEvidenceCount > 0;
  }

  private async areRequiredRequirementsComplete(
    userHonorId: number,
    honorId: number,
  ): Promise<boolean> {
    const requirements = await this.prisma.honor_requirements.findMany({
      where: { honor_id: honorId, active: true },
      select: { requirement_id: true, parent_id: true },
    });

    if (requirements.length === 0) {
      return true;
    }

    const parentIds = new Set(
      requirements
        .map((requirement) => requirement.parent_id)
        .filter((id): id is number => id !== null),
    );
    const leafRequirementIds = requirements
      .filter((requirement) => !parentIds.has(requirement.requirement_id))
      .map((requirement) => requirement.requirement_id);

    if (leafRequirementIds.length === 0) {
      return true;
    }

    const completedProgress =
      await this.prisma.user_honor_requirement_progress.findMany({
        where: {
          user_honor_id: userHonorId,
          requirement_id: { in: leafRequirementIds },
          active: true,
          completed: true,
        },
        select: { requirement_id: true },
      });

    return (
      new Set(completedProgress.map((progress) => progress.requirement_id))
        .size === leafRequirementIds.length
    );
  }

  private async notifyHonorSubmitted(userHonorId: number, userId: string) {
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
    } catch (error: unknown) {
      this.logger.warn(
        `Notification failed for honor submission ${userHonorId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async notifyHonorReviewed(
    userId: string,
    userHonorId: number,
    action: 'approved' | 'rejected',
    reason?: string,
  ) {
    try {
      const title =
        action === 'approved' ? 'Honor aprobado' : 'Honor rechazado';
      const body =
        action === 'approved'
          ? 'Tu honor ha sido aprobado por el revisor'
          : `Tu honor ha sido rechazado: ${reason}`;

      void this.notifications.notifySafe(
        userId,
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
    } catch (error: unknown) {
      this.logger.warn(
        `Notification failed for honor review ${userHonorId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async emitHonorValidated(record: {
    user_id: string;
    honor_id: number;
    honors?: {
      honor_id: number;
      honors_category_id: number | null;
      name: string;
      club_type_id: number | null;
    } | null;
  }) {
    try {
      await this.achievementsService.emitEvent({
        userId: record.user_id,
        eventType: 'honor.validated',
        payload: {
          honor_id: record.honors?.honor_id ?? record.honor_id,
          category_id: record.honors?.honors_category_id ?? null,
          honor_name: record.honors?.name ?? null,
          club_type_id: record.honors?.club_type_id ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to emit achievement event: ${(error as Error).message}`,
      );
    }
  }

  private toValidationResult(
    id: number,
    status: string,
  ): HonorValidationResult {
    return {
      id,
      type: 'honor',
      status: status as HonorValidationStatus,
    };
  }
}

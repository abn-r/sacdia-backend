import { Injectable, Logger } from '@nestjs/common';
import { AchievementsService } from '../achievements/achievements.service';
import {
  AppBadRequestException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { MasterHonorsEvaluatorService } from './master-honors-evaluator.service';
import {
  HonorValidationResult,
  HonorValidationStatus,
} from './honor-validation-workflow.types';

const HONOR_STATUS_IN_PROGRESS = 'IN_PROGRESS' as const;
const HONOR_STATUS_PENDING = 'PENDING_REVIEW' as const;
const HONOR_STATUS_APPROVED = 'APPROVED' as const;
const HONOR_STATUS_REJECTED = 'REJECTED' as const;
const HONOR_COMPLETION_MODE_UNDECIDED = 'UNDECIDED' as const;
const HONOR_COMPLETION_MODE_IN_APP = 'IN_APP' as const;
const HONOR_COMPLETION_MODE_EXTERNAL = 'EXTERNAL' as const;

type HonorCompletionMode =
  | typeof HONOR_COMPLETION_MODE_UNDECIDED
  | typeof HONOR_COMPLETION_MODE_IN_APP
  | typeof HONOR_COMPLETION_MODE_EXTERNAL;

type UserHonorRecord = {
  user_honor_id: number;
  user_id: string;
  honor_id: number;
  active: boolean;
  validate: boolean;
  validation_status: string;
  completion_mode: string | null;
  images: unknown;
  document: string | null;
  certificate: string | null;
  validated_at: Date | null;
  modified_at: Date;
};

type HonorRequirementRecord = {
  requirement_id: number;
  parent_id: number | null;
  is_choice_group: boolean;
  choice_min: number | null;
  requires_evidence: boolean;
};

type RequirementEvaluation = {
  satisfied: boolean;
  selectedLeafRequirementIds: number[];
  evidenceRequirementIds: number[];
};

@Injectable()
export class HonorValidationWorkflowService {
  private readonly logger = new Logger(HonorValidationWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly achievementsService: AchievementsService,
    private readonly masterHonorsEvaluator: MasterHonorsEvaluatorService,
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

    await this.evaluateMasterHonors(record.user_id, 'approve');

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

    await this.evaluateMasterHonors(record.user_id, 'reject');

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
    switch (userHonor.completion_mode as HonorCompletionMode | null) {
      case HONOR_COMPLETION_MODE_IN_APP:
        await this.assertInAppSubmitEligibility(userHonor);
        break;
      case HONOR_COMPLETION_MODE_EXTERNAL:
        await this.assertExternalSubmitEligibility(userHonor);
        break;
      case HONOR_COMPLETION_MODE_UNDECIDED:
      default:
        throw new AppBadRequestException(
          ErrorCode.VALIDATION_HONOR_COMPLETION_MODE_REQUIRED,
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

  private async assertInAppSubmitEligibility(
    userHonor: Pick<UserHonorRecord, 'user_honor_id' | 'honor_id'>,
  ) {
    const requirementEvaluation =
      await this.evaluateInAppRequirementCompletion(
        userHonor.user_honor_id,
        userHonor.honor_id,
      );

    if (!requirementEvaluation.satisfied) {
      throw new AppBadRequestException(
        ErrorCode.VALIDATION_HONOR_REQUIREMENTS_INCOMPLETE,
      );
    }

    const missingEvidenceRequirementIds =
      requirementEvaluation.evidenceRequirementIds.filter(
        (requirementId) =>
          !requirementEvaluation.evidenceByRequirementId.has(requirementId),
      );

    if (missingEvidenceRequirementIds.length > 0) {
      throw new AppBadRequestException(
        ErrorCode.VALIDATION_HONOR_MISSING_EVIDENCE,
      );
    }
  }

  private async assertExternalSubmitEligibility(
    userHonor: Pick<
      UserHonorRecord,
      'user_honor_id' | 'images' | 'document'
    >,
  ) {
    if (!this.hasCompletedExternalFormat(userHonor)) {
      throw new AppBadRequestException(
        ErrorCode.VALIDATION_HONOR_MISSING_EVIDENCE,
      );
    }

    const hasGeneralEvidence = await this.hasExternalGeneralEvidence(userHonor);
    if (!hasGeneralEvidence) {
      throw new AppBadRequestException(
        ErrorCode.VALIDATION_HONOR_MISSING_EVIDENCE,
      );
    }
  }

  private hasCompletedExternalFormat(
    userHonor: Pick<UserHonorRecord, 'document'>,
  ): boolean {
    return typeof userHonor.document === 'string' && userHonor.document !== '';
  }

  private async hasExternalGeneralEvidence(
    userHonor: Pick<UserHonorRecord, 'user_honor_id' | 'images'>,
  ): Promise<boolean> {
    const images = Array.isArray(userHonor.images) ? userHonor.images : [];
    if (images.length > 0) {
      return true;
    }

    const generalEvidenceCount = await this.prisma.evidence_files.count({
      where: { user_honor_id: userHonor.user_honor_id, active: true },
    });

    return generalEvidenceCount > 0;
  }

  private async evaluateInAppRequirementCompletion(
    userHonorId: number,
    honorId: number,
  ): Promise<
    RequirementEvaluation & {
      evidenceByRequirementId: Set<number>;
    }
  > {
    const requirements: HonorRequirementRecord[] =
      await this.prisma.honor_requirements.findMany({
        where: { honor_id: honorId, active: true },
        select: {
          requirement_id: true,
          parent_id: true,
          is_choice_group: true,
          choice_min: true,
          requires_evidence: true,
        },
        orderBy: { requirement_number: 'asc' },
      });

    if (requirements.length === 0) {
      return {
        satisfied: true,
        selectedLeafRequirementIds: [],
        evidenceRequirementIds: [],
        evidenceByRequirementId: new Set(),
      };
    }

    const progressRows =
      await this.prisma.user_honor_requirement_progress.findMany({
        where: {
          user_honor_id: userHonorId,
          active: true,
          completed: true,
        },
        select: {
          requirement_id: true,
          requirement_evidence: {
            where: { active: true },
            select: { evidence_id: true },
          },
        },
      });

    const completedRequirementIds = new Set(
      progressRows.map((progress) => progress.requirement_id),
    );
    const evidenceByRequirementId = new Set(
      progressRows
        .filter(
          (progress) => (progress.requirement_evidence ?? []).length > 0,
        )
        .map((progress) => progress.requirement_id),
    );

    const childrenByParent = this.groupRequirementsByParent(requirements);
    const topLevelRequirements = childrenByParent.get(null) ?? [];
    const topLevelEvaluation = topLevelRequirements.map((requirement) =>
      this.evaluateRequirementNode(
        requirement,
        childrenByParent,
        completedRequirementIds,
      ),
    );

    return {
      satisfied: topLevelEvaluation.every(
        (evaluation) => evaluation.satisfied,
      ),
      selectedLeafRequirementIds: [
        ...new Set(
          topLevelEvaluation.flatMap(
            (evaluation) => evaluation.selectedLeafRequirementIds,
          ),
        ),
      ],
      evidenceRequirementIds: [
        ...new Set(
          topLevelEvaluation.flatMap(
            (evaluation) => evaluation.evidenceRequirementIds,
          ),
        ),
      ],
      evidenceByRequirementId,
    };
  }

  private groupRequirementsByParent(requirements: HonorRequirementRecord[]) {
    const childrenByParent = new Map<number | null, HonorRequirementRecord[]>();
    for (const requirement of requirements) {
      const siblings = childrenByParent.get(requirement.parent_id) ?? [];
      siblings.push(requirement);
      childrenByParent.set(requirement.parent_id, siblings);
    }
    return childrenByParent;
  }

  private evaluateRequirementNode(
    requirement: HonorRequirementRecord,
    childrenByParent: Map<number | null, HonorRequirementRecord[]>,
    completedRequirementIds: Set<number>,
  ): RequirementEvaluation {
    const children = childrenByParent.get(requirement.requirement_id) ?? [];

    if (requirement.is_choice_group) {
      return this.evaluateChoiceGroup(
        requirement,
        children,
        childrenByParent,
        completedRequirementIds,
      );
    }

    if (children.length > 0) {
      const childEvaluations = children.map((child) =>
        this.evaluateRequirementNode(
          child,
          childrenByParent,
          completedRequirementIds,
        ),
      );
      const satisfied = childEvaluations.every(
        (evaluation) => evaluation.satisfied,
      );

      return {
        satisfied,
        selectedLeafRequirementIds: satisfied
          ? childEvaluations.flatMap(
              (evaluation) => evaluation.selectedLeafRequirementIds,
            )
          : [],
        evidenceRequirementIds: satisfied
          ? [
              ...childEvaluations.flatMap(
                (evaluation) => evaluation.evidenceRequirementIds,
              ),
              ...(requirement.requires_evidence
                ? [requirement.requirement_id]
                : []),
            ]
          : [],
      };
    }

    const satisfied = completedRequirementIds.has(requirement.requirement_id);

    return {
      satisfied,
      selectedLeafRequirementIds: satisfied
        ? [requirement.requirement_id]
        : [],
      evidenceRequirementIds:
        satisfied && requirement.requires_evidence
          ? [requirement.requirement_id]
          : [],
    };
  }

  private evaluateChoiceGroup(
    requirement: HonorRequirementRecord,
    children: HonorRequirementRecord[],
    childrenByParent: Map<number | null, HonorRequirementRecord[]>,
    completedRequirementIds: Set<number>,
  ): RequirementEvaluation {
    const minimumChoices = Math.max(requirement.choice_min ?? 1, 0);
    if (minimumChoices === 0) {
      return {
        satisfied: true,
        selectedLeafRequirementIds: [],
        evidenceRequirementIds: requirement.requires_evidence
          ? [requirement.requirement_id]
          : [],
      };
    }

    const satisfiedChildren = children
      .map((child) =>
        this.evaluateRequirementNode(
          child,
          childrenByParent,
          completedRequirementIds,
        ),
      )
      .filter((evaluation) => evaluation.satisfied);

    if (satisfiedChildren.length < minimumChoices) {
      return {
        satisfied: false,
        selectedLeafRequirementIds: [],
        evidenceRequirementIds: [],
      };
    }

    const selectedChildren = satisfiedChildren.slice(0, minimumChoices);
    return {
      satisfied: true,
      selectedLeafRequirementIds: selectedChildren.flatMap(
        (evaluation) => evaluation.selectedLeafRequirementIds,
      ),
      evidenceRequirementIds: [
        ...selectedChildren.flatMap(
          (evaluation) => evaluation.evidenceRequirementIds,
        ),
        ...(requirement.requires_evidence ? [requirement.requirement_id] : []),
      ],
    };
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

  private async evaluateMasterHonors(userId: string, transition: string) {
    try {
      await this.masterHonorsEvaluator.evaluateUser(userId);
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to evaluate master honors for user ${userId} after honor status ${transition}: ${
          error instanceof Error ? error.message : String(error)
        }`,
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

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  assertReadyForCloseout,
  canTransitionEnrollment,
  computeProgressSummary,
  transitionEnrollment,
  transitionRequirement,
} from '../domain/certification-state-machine';
import type {
  CertificationEnrollmentStatus,
  CertificationRequirementStatus,
  ProgressSummary,
  RequirementProgressSnapshot,
} from '../domain/certification-definition.types';
import type { ApproveCertificationRequirementDto } from '../dto/review-certification-requirement.dto';
import type { RequestCertificationRequirementChangesDto } from '../dto/review-certification-requirement.dto';

type ReviewDbClient = PrismaService | Prisma.TransactionClient;

export type CertificationReviewActor = {
  userId: string;
  localFieldId?: number;
  globalAccess: boolean;
};

const REVIEWABLE_STATUSES: readonly CertificationRequirementStatus[] = [
  'SUBMITTED',
];

export type TrayItem = {
  progress_id: number;
  enrollment_id: number;
  certification_id: number;
  certification_name: string;
  module_id: number;
  module_name: string;
  section_id: number;
  section_name: string;
  status: CertificationRequirementStatus;
  submitted_at: Date | null;
  participant: {
    user_id: string;
    name: string | null;
    paternal_last_name: string | null;
  };
};

export type ReviewComponentView = {
  component_id: number;
  component_type: string;
  label: string;
  required: boolean;
  response: {
    text_value: string | null;
    attestation_confirmed: boolean | null;
    linked_user_honor_id: number | null;
    linked_activity_id: number | null;
  } | null;
  evidences: Array<{
    evidence_id: number;
    original_filename: string;
    mime_type: string;
    size_bytes: number;
    upload_status: string;
  }>;
};

export type ReviewHistoryEntry = {
  review_event_id: number;
  event_type: string;
  comment: string | null;
  performed_by_id: string;
  from_status: string | null;
  to_status: string | null;
  created_at: Date;
};

export type RequirementReviewDetail = TrayItem & {
  lock_version: number;
  components: ReviewComponentView[];
  history: ReviewHistoryEntry[];
};

const TRAY_INCLUDE = {
  users: {
    select: { user_id: true, name: true, paternal_last_name: true },
  },
  certifications: { select: { certification_id: true, name: true } },
  certification_sections: {
    select: {
      section_id: true,
      name: true,
      module_id: true,
      certification_modules: { select: { module_id: true, name: true } },
    },
  },
} satisfies Prisma.certification_section_progressInclude;

type ProgressWithTrayInclude = Prisma.certification_section_progressGetPayload<{
  include: typeof TRAY_INCLUDE;
}>;

@Injectable()
export class CertificationReviewService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // TRAY
  // ---------------------------------------------------------------------------

  async getTray(
    actor: CertificationReviewActor,
    query: { status?: CertificationRequirementStatus } = {},
  ): Promise<TrayItem[]> {
    if (!actor.globalAccess && actor.localFieldId == null) {
      return [];
    }

    const statuses = query.status ? [query.status] : [...REVIEWABLE_STATUSES];

    const rows = await this.prisma.certification_section_progress.findMany({
      where: {
        status: { in: statuses },
        active: true,
        ...(actor.globalAccess
          ? {}
          : { users: { local_field_id: actor.localFieldId } }),
      },
      include: TRAY_INCLUDE,
      orderBy: { submitted_at: 'asc' },
    });

    return rows.map((row) => this.toTrayItem(row));
  }

  // ---------------------------------------------------------------------------
  // DETAIL
  // ---------------------------------------------------------------------------

  async getDetail(
    actor: CertificationReviewActor,
    progressId: number,
  ): Promise<RequirementReviewDetail> {
    const progress = await this.getProgressInScopeOrThrow(actor, progressId);

    const [responses, history, enrollment] = await Promise.all([
      this.prisma.certification_component_responses.findMany({
        where: { progress_id: progressId },
        include: {
          certification_evidences: { where: { active: true } },
        },
      }),
      this.prisma.certification_review_events.findMany({
        where: { progress_id: progressId },
        orderBy: { created_at: 'asc' },
      }),
      this.prisma.users_certifications.findUnique({
        where: { enrollment_id: progress.enrollment_id! },
        select: { lock_version: true },
      }),
    ]);

    const section = await this.prisma.certification_sections.findUnique({
      where: { section_id: progress.section_id },
      include: { certification_requirement_components: true },
    });

    const responseByComponent = new Map(
      responses.map((r) => [r.component_id, r]),
    );

    const components: ReviewComponentView[] = (
      section?.certification_requirement_components ?? []
    ).map((c) => {
      const response = responseByComponent.get(c.component_id);
      return {
        component_id: c.component_id,
        component_type: c.component_type,
        label: c.label,
        required: c.required,
        response: response
          ? {
              text_value: response.text_value,
              attestation_confirmed: response.attestation_confirmed,
              linked_user_honor_id: response.linked_user_honor_id,
              linked_activity_id: response.linked_activity_id,
            }
          : null,
        evidences: (response?.certification_evidences ?? []).map((e) => ({
          evidence_id: e.evidence_id,
          original_filename: e.original_filename,
          mime_type: e.mime_type,
          size_bytes: Number(e.size_bytes),
          upload_status: e.upload_status,
        })),
      };
    });

    return {
      ...this.toTrayItem(progress),
      lock_version: enrollment?.lock_version ?? 0,
      components,
      history: history.map((h) => ({
        review_event_id: h.review_event_id,
        event_type: h.event_type,
        comment: h.comment,
        performed_by_id: h.performed_by_id,
        from_status: h.from_status,
        to_status: h.to_status,
        created_at: h.created_at,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // APPROVE
  // ---------------------------------------------------------------------------

  async approve(
    actor: CertificationReviewActor,
    progressId: number,
    dto: ApproveCertificationRequirementDto,
  ): Promise<{ progress_id: number; status: string; progress_summary: ProgressSummary }> {
    return this.prisma.$transaction(async (tx) => {
      const progress = await this.getProgressInScopeOrThrow(
        actor,
        progressId,
        tx,
      );
      this.assertReviewerIsNotParticipant(actor, progress.user_id);

      const currentStatus =
        progress.status as CertificationRequirementStatus;
      const nextStatus = transitionRequirement(currentStatus, 'APPROVED');

      const lockResult = await tx.users_certifications.updateMany({
        where: {
          enrollment_id: progress.enrollment_id!,
          lock_version: dto.lock_version,
        },
        data: { lock_version: { increment: 1 } },
      });
      if (lockResult.count === 0) {
        throw new AppConflictException(ErrorCode.CERT_CONCURRENT_UPDATE);
      }

      await tx.certification_section_progress.update({
        where: { progress_id: progressId },
        data: {
          status: nextStatus,
          reviewed_at: new Date(),
          reviewed_by_id: actor.userId,
          last_review_comment: dto.comment ?? null,
        },
      });

      await tx.certification_review_events.create({
        data: {
          enrollment_id: progress.enrollment_id!,
          progress_id: progressId,
          event_type: 'REQUIREMENT_APPROVED',
          performed_by_id: actor.userId,
          comment: dto.comment ?? null,
          from_status: currentStatus,
          to_status: nextStatus,
        },
      });

      const enrollment = await tx.users_certifications.findUniqueOrThrow({
        where: { enrollment_id: progress.enrollment_id! },
      });
      const progressSummary = await this.recomputeEnrollmentProgress(
        tx,
        enrollment,
      );

      return {
        progress_id: progressId,
        status: nextStatus,
        progress_summary: progressSummary,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // REQUEST CHANGES
  // ---------------------------------------------------------------------------

  async requestChanges(
    actor: CertificationReviewActor,
    progressId: number,
    dto: RequestCertificationRequirementChangesDto,
  ): Promise<{ progress_id: number; status: string }> {
    return this.prisma.$transaction(async (tx) => {
      const progress = await this.getProgressInScopeOrThrow(
        actor,
        progressId,
        tx,
      );
      this.assertReviewerIsNotParticipant(actor, progress.user_id);

      const currentStatus =
        progress.status as CertificationRequirementStatus;
      const nextStatus = transitionRequirement(
        currentStatus,
        'CHANGES_REQUESTED',
      );

      await tx.certification_section_progress.update({
        where: { progress_id: progressId },
        data: {
          status: nextStatus,
          reviewed_at: new Date(),
          reviewed_by_id: actor.userId,
          last_review_comment: dto.comment,
        },
      });

      await tx.certification_review_events.create({
        data: {
          enrollment_id: progress.enrollment_id!,
          progress_id: progressId,
          event_type: 'REQUIREMENT_CHANGES_REQUESTED',
          performed_by_id: actor.userId,
          comment: dto.comment,
          from_status: currentStatus,
          to_status: nextStatus,
        },
      });

      return { progress_id: progressId, status: nextStatus };
    });
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private async getProgressInScopeOrThrow(
    actor: CertificationReviewActor,
    progressId: number,
    db: ReviewDbClient = this.prisma,
  ): Promise<ProgressWithTrayInclude> {
    const progress = await db.certification_section_progress.findFirst({
      where: { progress_id: progressId, active: true },
      include: TRAY_INCLUDE,
    });

    if (!progress) {
      throw new AppNotFoundException(ErrorCode.RECORD_NOT_FOUND);
    }

    if (progress.enrollment_id == null) {
      // Legacy progress rows predating enrollment_id are not reviewable
      // through the new tray; they are out of scope for this workflow.
      throw new AppBadRequestException(ErrorCode.CERT_SECTION_INVALID, {
        reason: 'progress_missing_enrollment',
      });
    }

    this.assertInScope(
      actor,
      await this.resolveParticipantLocalField(progress, db),
    );

    return progress;
  }

  private async resolveParticipantLocalField(
    progress: ProgressWithTrayInclude,
    db: ReviewDbClient,
  ): Promise<number | null> {
    const user = await db.users.findUnique({
      where: { user_id: progress.user_id },
      select: { local_field_id: true },
    });
    return user?.local_field_id ?? null;
  }

  private assertInScope(
    actor: CertificationReviewActor,
    participantLocalFieldId: number | null,
  ): void {
    if (actor.globalAccess) return;
    if (
      actor.localFieldId != null &&
      actor.localFieldId === participantLocalFieldId
    ) {
      return;
    }
    throw new AppForbiddenException(ErrorCode.CERT_REVIEW_SCOPE_FORBIDDEN);
  }

  private assertReviewerIsNotParticipant(
    actor: CertificationReviewActor,
    participantUserId: string,
  ): void {
    if (actor.userId === participantUserId) {
      throw new AppForbiddenException(ErrorCode.CERT_REVIEW_SCOPE_FORBIDDEN, {
        reason: 'reviewer_is_participant',
      });
    }
  }

  private toTrayItem(progress: ProgressWithTrayInclude): TrayItem {
    return {
      progress_id: progress.progress_id,
      enrollment_id: progress.enrollment_id!,
      certification_id: progress.certifications.certification_id,
      certification_name: progress.certifications.name,
      module_id: progress.certification_sections.module_id,
      module_name: progress.certification_sections.certification_modules.name,
      section_id: progress.certification_sections.section_id,
      section_name: progress.certification_sections.name,
      status: progress.status as CertificationRequirementStatus,
      submitted_at: progress.submitted_at,
      participant: {
        user_id: progress.users.user_id,
        name: progress.users.name,
        paternal_last_name: progress.users.paternal_last_name,
      },
    };
  }

  private async recomputeEnrollmentProgress(
    db: ReviewDbClient,
    enrollment: {
      enrollment_id: number;
      certification_version_id: number;
      status: string;
    },
  ): Promise<ProgressSummary> {
    const sections = await db.certification_sections.findMany({
      where: {
        certification_modules: {
          certification_version_id: enrollment.certification_version_id,
        },
      },
      select: { section_id: true, required: true },
    });

    const progressRows = await db.certification_section_progress.findMany({
      where: { enrollment_id: enrollment.enrollment_id },
      select: { section_id: true, status: true },
    });
    const progressBySection = new Map(
      progressRows.map((p) => [p.section_id, p.status]),
    );

    const snapshots: RequirementProgressSnapshot[] = sections.map((s) => ({
      requirementId: s.section_id,
      required: s.required,
      status: (progressBySection.get(s.section_id) ??
        'DRAFT') as CertificationRequirementStatus,
    }));

    const summary = computeProgressSummary(snapshots);

    if (
      summary.allRequiredApproved &&
      canTransitionEnrollment(
        enrollment.status as CertificationEnrollmentStatus,
        'READY_FOR_CLOSEOUT',
      )
    ) {
      assertReadyForCloseout(snapshots);
      await db.users_certifications.update({
        where: { enrollment_id: enrollment.enrollment_id },
        data: {
          status: transitionEnrollment(
            enrollment.status as CertificationEnrollmentStatus,
            'READY_FOR_CLOSEOUT',
          ),
        },
      });
    }

    return summary;
  }
}

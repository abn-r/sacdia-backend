import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  assertReadyForCloseout,
  assertRequirementEditable,
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
import type { SaveRequirementDraftDto } from '../dto/save-requirement-draft.dto';
import type { SubmitRequirementDto } from '../dto/submit-requirement.dto';

type RequirementDbClient = PrismaService | Prisma.TransactionClient;

type EnrollmentRecord = {
  enrollment_id: number;
  user_id: string;
  certification_id: number;
  certification_version_id: number;
  status: string;
  started_at: Date | null;
  lock_version: number;
};

type ComponentRecord = {
  component_id: number;
  component_type: string;
  label: string;
  required: boolean;
};

type SectionRecord = {
  section_id: number;
  module_id: number;
  name: string;
  required: boolean;
  certification_requirement_components: ComponentRecord[];
};

type ComponentResponseRecord = {
  component_id: number;
  text_value: string | null;
  attestation_confirmed: boolean | null;
  linked_user_honor_id: number | null;
  linked_activity_id: number | null;
};

type ProgressRecord = {
  progress_id: number;
  status: string;
  submitted_at: Date | null;
  reviewed_at: Date | null;
  last_review_comment: string | null;
};

export type RequirementComponentView = {
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
};

export type RequirementView = {
  section_id: number;
  module_id: number;
  name: string;
  required: boolean;
  status: CertificationRequirementStatus;
  submitted_at: Date | null;
  reviewed_at: Date | null;
  last_review_comment: string | null;
  components: RequirementComponentView[];
};

@Injectable()
export class CertificationRequirementsService {
  constructor(private readonly prisma: PrismaService) {}

  async getRequirement(
    userId: string,
    enrollmentId: number,
    sectionId: number,
  ): Promise<RequirementView> {
    const enrollment = await this.getOwnedEnrollmentOrThrow(
      userId,
      enrollmentId,
    );
    const section = await this.getSectionForEnrollmentOrThrow(
      sectionId,
      enrollment,
    );
    const progress = await this.prisma.certification_section_progress.findFirst(
      {
        where: {
          enrollment_id: enrollment.enrollment_id,
          section_id: sectionId,
        },
        include: { certification_component_responses: true },
      },
    );

    return this.buildRequirementView(
      section,
      progress,
      progress?.certification_component_responses ?? [],
    );
  }

  async saveDraft(
    userId: string,
    enrollmentId: number,
    sectionId: number,
    dto: SaveRequirementDraftDto,
  ): Promise<RequirementView> {
    return this.prisma.$transaction(async (tx) => {
      const enrollment = await this.getOwnedEnrollmentOrThrow(
        userId,
        enrollmentId,
        tx,
      );
      const section = await this.getSectionForEnrollmentOrThrow(
        sectionId,
        enrollment,
        tx,
      );

      let progress = await tx.certification_section_progress.findFirst({
        where: {
          enrollment_id: enrollment.enrollment_id,
          section_id: sectionId,
        },
      });

      if (progress) {
        assertRequirementEditable(
          progress.status as CertificationRequirementStatus,
        );
      } else {
        progress = await tx.certification_section_progress.create({
          data: {
            user_id: userId,
            certification_id: enrollment.certification_id,
            module_id: section.module_id,
            section_id: sectionId,
            enrollment_id: enrollment.enrollment_id,
            status: 'DRAFT',
          },
        });
      }

      await this.advanceEnrollmentToInProgress(tx, enrollment);

      for (const response of dto.responses) {
        const component = section.certification_requirement_components.find(
          (c) => c.component_id === response.component_id,
        );

        if (!component) {
          throw new AppBadRequestException(ErrorCode.CERT_SECTION_INVALID, {
            reason: 'component_not_in_section',
            component_id: response.component_id,
          });
        }

        if (component.component_type === 'LINKED_HONOR') {
          await this.assertLinkedHonorApproved(
            tx,
            userId,
            response.linked_user_honor_id,
          );
        }

        await tx.certification_component_responses.upsert({
          where: {
            progress_id_component_id: {
              progress_id: progress.progress_id,
              component_id: component.component_id,
            },
          },
          create: {
            progress_id: progress.progress_id,
            component_id: component.component_id,
            text_value: response.text_value ?? null,
            attestation_confirmed: response.attestation_confirmed ?? null,
            linked_user_honor_id: response.linked_user_honor_id ?? null,
            linked_activity_id: response.linked_activity_id ?? null,
          },
          update: {
            text_value: response.text_value ?? null,
            attestation_confirmed: response.attestation_confirmed ?? null,
            linked_user_honor_id: response.linked_user_honor_id ?? null,
            linked_activity_id: response.linked_activity_id ?? null,
          },
        });
      }

      const responses = await tx.certification_component_responses.findMany({
        where: { progress_id: progress.progress_id },
      });

      return this.buildRequirementView(section, progress, responses);
    });
  }

  async submitRequirement(
    userId: string,
    enrollmentId: number,
    sectionId: number,
    dto: SubmitRequirementDto,
  ): Promise<{ requirement: RequirementView; progress_summary: ProgressSummary }> {
    return this.prisma.$transaction(async (tx) => {
      const enrollment = await this.getOwnedEnrollmentOrThrow(
        userId,
        enrollmentId,
        tx,
      );
      const section = await this.getSectionForEnrollmentOrThrow(
        sectionId,
        enrollment,
        tx,
      );

      const progress = await tx.certification_section_progress.findFirst({
        where: {
          enrollment_id: enrollment.enrollment_id,
          section_id: sectionId,
        },
        include: { certification_component_responses: true },
      });

      if (!progress) {
        throw new AppBadRequestException(ErrorCode.CERT_REQUIREMENT_INCOMPLETE, {
          reason: 'no_draft_saved',
        });
      }

      const currentStatus = progress.status as CertificationRequirementStatus;
      assertRequirementEditable(currentStatus);

      const nextStatus = transitionRequirement(currentStatus, 'SUBMITTED');

      this.assertRequiredComponentsComplete(
        section.certification_requirement_components,
        progress.certification_component_responses,
      );

      const lockResult = await tx.users_certifications.updateMany({
        where: {
          enrollment_id: enrollment.enrollment_id,
          lock_version: dto.lock_version,
        },
        data: { lock_version: { increment: 1 } },
      });

      if (lockResult.count === 0) {
        throw new AppConflictException(ErrorCode.CERT_CONCURRENT_UPDATE);
      }

      const wasResubmit = currentStatus === 'CHANGES_REQUESTED';

      const updatedProgress = await tx.certification_section_progress.update({
        where: { progress_id: progress.progress_id },
        data: { status: nextStatus, submitted_at: new Date() },
      });

      await tx.certification_review_events.create({
        data: {
          enrollment_id: enrollment.enrollment_id,
          progress_id: progress.progress_id,
          event_type: wasResubmit
            ? 'REQUIREMENT_RESUBMITTED'
            : 'REQUIREMENT_SUBMITTED',
          performed_by_id: userId,
          from_status: currentStatus,
          to_status: nextStatus,
        },
      });

      const progressSummary = await this.recomputeEnrollmentProgress(
        tx,
        enrollment,
      );

      return {
        requirement: this.buildRequirementView(
          section,
          updatedProgress,
          progress.certification_component_responses,
        ),
        progress_summary: progressSummary,
      };
    });
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private async getOwnedEnrollmentOrThrow(
    userId: string,
    enrollmentId: number,
    db: RequirementDbClient = this.prisma,
  ): Promise<EnrollmentRecord> {
    const enrollment = await db.users_certifications.findFirst({
      where: {
        enrollment_id: enrollmentId,
        user_id: userId,
        active: true,
      },
    });

    if (!enrollment) {
      throw new AppNotFoundException(ErrorCode.CERT_ENROLLMENT_NOT_FOUND);
    }

    return enrollment as EnrollmentRecord;
  }

  private async getSectionForEnrollmentOrThrow(
    sectionId: number,
    enrollment: Pick<EnrollmentRecord, 'certification_version_id'>,
    db: RequirementDbClient = this.prisma,
  ): Promise<SectionRecord> {
    const section = await db.certification_sections.findFirst({
      where: {
        section_id: sectionId,
        certification_modules: {
          certification_version_id: enrollment.certification_version_id,
        },
      },
      include: { certification_requirement_components: true },
    });

    if (!section) {
      throw new AppBadRequestException(ErrorCode.CERT_SECTION_INVALID, {
        reason: 'section_not_in_version',
        section_id: sectionId,
      });
    }

    return section as SectionRecord;
  }

  private async assertLinkedHonorApproved(
    db: RequirementDbClient,
    userId: string,
    linkedUserHonorId: number | undefined | null,
  ): Promise<void> {
    if (!linkedUserHonorId) {
      throw new AppBadRequestException(ErrorCode.CERT_REQUIREMENT_INCOMPLETE, {
        reason: 'linked_honor_missing',
      });
    }

    const userHonor = await db.users_honors.findFirst({
      where: {
        user_honor_id: linkedUserHonorId,
        user_id: userId,
        validation_status: 'APPROVED',
      },
      select: { user_honor_id: true },
    });

    if (!userHonor) {
      throw new AppBadRequestException(ErrorCode.CERT_REQUIREMENT_INCOMPLETE, {
        reason: 'linked_honor_not_approved',
        linked_user_honor_id: linkedUserHonorId,
      });
    }
  }

  private isComponentResponseComplete(
    component: ComponentRecord,
    response: ComponentResponseRecord | undefined,
  ): boolean {
    switch (component.component_type) {
      case 'AUTO_VALIDATION':
        return true;
      case 'TEXT_RESPONSE':
        return (
          typeof response?.text_value === 'string' &&
          response.text_value.trim().length > 0
        );
      case 'ATTESTATION':
        return response?.attestation_confirmed === true;
      case 'LINKED_HONOR':
        return typeof response?.linked_user_honor_id === 'number';
      case 'LINKED_ACTIVITY':
        return typeof response?.linked_activity_id === 'number';
      case 'FILE_EVIDENCE':
        return response !== undefined;
      default:
        return false;
    }
  }

  private assertRequiredComponentsComplete(
    components: ComponentRecord[],
    responses: ComponentResponseRecord[],
  ): void {
    const responseByComponent = new Map(
      responses.map((r) => [r.component_id, r]),
    );

    const missing = components
      .filter((c) => c.required)
      .filter(
        (c) =>
          !this.isComponentResponseComplete(
            c,
            responseByComponent.get(c.component_id),
          ),
      );

    if (missing.length > 0) {
      throw new AppBadRequestException(ErrorCode.CERT_REQUIREMENT_INCOMPLETE, {
        reason: 'missing_required_components',
        missing_component_ids: missing.map((c) => c.component_id),
      });
    }
  }

  private async advanceEnrollmentToInProgress(
    db: RequirementDbClient,
    enrollment: EnrollmentRecord,
  ): Promise<void> {
    if (
      enrollment.status === 'ENROLLED' &&
      canTransitionEnrollment('ENROLLED', 'IN_PROGRESS')
    ) {
      await db.users_certifications.update({
        where: { enrollment_id: enrollment.enrollment_id },
        data: {
          status: 'IN_PROGRESS',
          started_at: enrollment.started_at ?? new Date(),
        },
      });
      enrollment.status = 'IN_PROGRESS';
    }
  }

  private async recomputeEnrollmentProgress(
    db: RequirementDbClient,
    enrollment: EnrollmentRecord,
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

  private buildRequirementView(
    section: SectionRecord,
    progress: ProgressRecord | null | undefined,
    responses: ComponentResponseRecord[],
  ): RequirementView {
    const responseByComponent = new Map(
      responses.map((r) => [r.component_id, r]),
    );

    return {
      section_id: section.section_id,
      module_id: section.module_id,
      name: section.name,
      required: section.required,
      status: (progress?.status ?? 'DRAFT') as CertificationRequirementStatus,
      submitted_at: progress?.submitted_at ?? null,
      reviewed_at: progress?.reviewed_at ?? null,
      last_review_comment: progress?.last_review_comment ?? null,
      components: section.certification_requirement_components.map((c) => {
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
        };
      }),
    };
  }
}

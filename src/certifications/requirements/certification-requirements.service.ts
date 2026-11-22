import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AppBadRequestException,
  AppConflictException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  assertEnrollmentEditable,
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
import { getOwnedEnrollmentOrThrow } from '../shared/owned-enrollment';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../../common/services/file-storage.service';
import type { FileStorageService } from '../../common/services/file-storage.service';
import { SIGNED_DOWNLOAD_TTL_SECONDS } from '../evidence/certification-evidence.constants';

/** Max activities returned by the LINKED_ACTIVITY picker. */
const ACTIVITY_OPTIONS_LIMIT = 50;

type RequirementDbClient = PrismaService | Prisma.TransactionClient;

/**
 * Loads, in the same round-trip as the responses, whether each response has at
 * least one confirmed and active evidence (take: 1 keeps it to a single row
 * per response). Avoids a per-component query when validating FILE_EVIDENCE.
 */
const CONFIRMED_EVIDENCE_INCLUDE = {
  certification_component_responses: {
    include: {
      certification_evidences: {
        where: { upload_status: 'CONFIRMED', active: true },
        select: { evidence_id: true },
        take: 1,
      },
    },
  },
} satisfies Prisma.certification_section_progressInclude;

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
  instructions?: string | null;
  configuration?: Prisma.JsonValue;
  activity_type_id?: number | null;
};

type SectionRecord = {
  section_id: number;
  module_id: number;
  name: string;
  description?: string | null;
  instructions?: string | null;
  required: boolean;
  certification_requirement_components: ComponentRecord[];
};

type ComponentResponseRecord = {
  component_id: number;
  text_value: string | null;
  attestation_confirmed: boolean | null;
  linked_user_honor_id: number | null;
  linked_activity_id: number | null;
  /**
   * Active, CONFIRMED evidence rows linked to this response. Only loaded by
   * submitRequirement (see CONFIRMED_EVIDENCE_INCLUDE); undefined elsewhere.
   */
  certification_evidences?: EvidenceRecord[];
};

type EvidenceRecord = {
  evidence_id: number;
  object_key?: string;
  original_filename?: string;
  mime_type?: string;
  size_bytes?: bigint | number;
  confirmed_at?: Date | null;
};

export type RequirementEvidenceView = {
  evidence_id: number;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  confirmed_at: Date | null;
  url: string;
  expires_in: number;
};

export type ActivityOption = {
  activity_id: number;
  name: string;
  activity_date: Date | null;
  activity_type_name: string;
  club_name: string | null;
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
  instructions: string | null;
  /** Free-form JSON (e.g. max files / max length). `{}` when unset. */
  configuration: Prisma.JsonValue;
  response: {
    text_value: string | null;
    attestation_confirmed: boolean | null;
    linked_user_honor_id: number | null;
    linked_activity_id: number | null;
  } | null;
  /**
   * Active CONFIRMED evidences with signed download URLs. Only populated by
   * getRequirement; saveDraft/submitRequirement omit it (no signing inside
   * their transactions) and clients should refetch the requirement.
   */
  evidences?: RequirementEvidenceView[];
};

export type RequirementView = {
  section_id: number;
  module_id: number;
  name: string;
  description: string | null;
  instructions: string | null;
  required: boolean;
  status: CertificationRequirementStatus;
  submitted_at: Date | null;
  reviewed_at: Date | null;
  last_review_comment: string | null;
  components: RequirementComponentView[];
  /**
   * Current users_certifications.lock_version. The participant sends it back
   * on submit (optimistic concurrency). Only returned by getRequirement.
   */
  lock_version?: number;
};

@Injectable()
export class CertificationRequirementsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

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
        include: {
          certification_component_responses: {
            include: {
              certification_evidences: {
                where: { upload_status: 'CONFIRMED', active: true },
                orderBy: { confirmed_at: 'asc' },
              },
            },
          },
        },
      },
    );

    const responses = progress?.certification_component_responses ?? [];
    const view = this.buildRequirementView(section, progress, responses);

    // Sign download URLs (900 s) for every confirmed evidence, in parallel.
    const evidencesByComponent = new Map<number, RequirementEvidenceView[]>();
    await Promise.all(
      responses.map(async (response) => {
        const rows = response.certification_evidences ?? [];
        const signed = await Promise.all(
          rows.map(async (e) => ({
            evidence_id: e.evidence_id,
            original_filename: e.original_filename ?? '',
            mime_type: e.mime_type ?? '',
            size_bytes: Number(e.size_bytes ?? 0),
            confirmed_at: e.confirmed_at ?? null,
            url: await this.fileStorage.getSignedDownloadUrl(
              StorageBucketAlias.CERTIFICATION_EVIDENCE,
              e.object_key ?? '',
              { expiresInSeconds: SIGNED_DOWNLOAD_TTL_SECONDS },
            ),
            expires_in: SIGNED_DOWNLOAD_TTL_SECONDS,
          })),
        );
        evidencesByComponent.set(response.component_id, signed);
      }),
    );

    return {
      ...view,
      lock_version: enrollment.lock_version,
      components: view.components.map((c) => ({
        ...c,
        evidences: evidencesByComponent.get(c.component_id) ?? [],
      })),
    };
  }

  /**
   * Activities the user attended, for picking in a LINKED_ACTIVITY component.
   * `activities.attendees` is a Json array of user ids, filtered in SQL.
   */
  async getActivityOptions(
    userId: string,
    enrollmentId: number,
    sectionId: number,
    componentId: number,
  ): Promise<ActivityOption[]> {
    const enrollment = await this.getOwnedEnrollmentOrThrow(
      userId,
      enrollmentId,
    );
    const section = await this.getSectionForEnrollmentOrThrow(
      sectionId,
      enrollment,
    );
    const component = section.certification_requirement_components.find(
      (c) => c.component_id === componentId,
    );

    if (!component) {
      throw new AppBadRequestException(ErrorCode.CERT_SECTION_INVALID, {
        reason: 'component_not_in_section',
        component_id: componentId,
      });
    }
    if (component.component_type !== 'LINKED_ACTIVITY') {
      throw new AppBadRequestException(ErrorCode.CERT_SECTION_INVALID, {
        reason: 'component_not_linked_activity',
        component_id: componentId,
      });
    }

    const typeFilter = component.activity_type_id
      ? Prisma.sql`AND a.activity_type_id = ${component.activity_type_id}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<ActivityOption[]>(Prisma.sql`
      SELECT a.activity_id,
             a.name,
             a.activity_date,
             at.name AS activity_type_name,
             c.name AS club_name
      FROM activities a
      JOIN activity_types at ON at.activity_type_id = a.activity_type_id
      LEFT JOIN club_sections cs ON cs.club_section_id = a.club_section_id
      LEFT JOIN clubs c ON c.club_id = cs.main_club_id
      WHERE a.active = true
        AND a.attendees::jsonb @> jsonb_build_array(${userId}::text)
        ${typeFilter}
      ORDER BY a.activity_date DESC NULLS LAST, a.activity_id DESC
      LIMIT ${ACTIVITY_OPTIONS_LIMIT}
    `);

    return rows;
  }

  async saveDraft(
    userId: string,
    enrollmentId: number,
    sectionId: number,
    dto: SaveRequirementDraftDto,
  ): Promise<RequirementView> {
    return this.prisma.$transaction(async (tx) => {
      const enrollment = await this.getEditableEnrollmentOrThrow(
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
        assertRequirementEditable(progress.status);
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

        if (
          component.component_type === 'LINKED_ACTIVITY' &&
          response.linked_activity_id
        ) {
          await this.assertActivityAttended(
            tx,
            userId,
            response.linked_activity_id,
            component.activity_type_id,
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
  ): Promise<{
    requirement: RequirementView;
    progress_summary: ProgressSummary;
  }> {
    return this.prisma.$transaction(async (tx) => {
      const enrollment = await this.getEditableEnrollmentOrThrow(
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
        include: CONFIRMED_EVIDENCE_INCLUDE,
      });

      if (!progress) {
        throw new AppBadRequestException(
          ErrorCode.CERT_REQUIREMENT_INCOMPLETE,
          {
            reason: 'no_draft_saved',
          },
        );
      }

      const currentStatus = progress.status;
      assertRequirementEditable(currentStatus);

      const nextStatus = transitionRequirement(currentStatus, 'SUBMITTED');

      this.assertRequiredComponentsComplete(
        section.certification_requirement_components,
        progress.certification_component_responses,
      );

      for (const component of section.certification_requirement_components) {
        if (component.component_type !== 'LINKED_ACTIVITY') continue;
        const linkedId = progress.certification_component_responses.find(
          (r) => r.component_id === component.component_id,
        )?.linked_activity_id;
        if (linkedId) {
          await this.assertActivityAttended(
            tx,
            userId,
            linkedId,
            component.activity_type_id,
          );
        }
      }

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

  private getOwnedEnrollmentOrThrow(
    userId: string,
    enrollmentId: number,
    db: RequirementDbClient = this.prisma,
  ): Promise<EnrollmentRecord> {
    return getOwnedEnrollmentOrThrow(db, userId, enrollmentId);
  }

  /**
   * Owned enrollment + enrollment-level edit guard. Use for every mutation
   * (draft / submit); plain reads keep using getOwnedEnrollmentOrThrow.
   */
  private async getEditableEnrollmentOrThrow(
    userId: string,
    enrollmentId: number,
    db: RequirementDbClient = this.prisma,
  ): Promise<EnrollmentRecord> {
    const enrollment = await this.getOwnedEnrollmentOrThrow(
      userId,
      enrollmentId,
      db,
    );
    assertEnrollmentEditable(
      enrollment.status as CertificationEnrollmentStatus,
    );
    return enrollment;
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

    return section;
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

  private async assertActivityAttended(
    db: RequirementDbClient,
    userId: string,
    activityId: number,
    activityTypeId: number | null | undefined,
  ): Promise<void> {
    const typeFilter = activityTypeId
      ? Prisma.sql`AND a.activity_type_id = ${activityTypeId}`
      : Prisma.empty;

    const rows = await db.$queryRaw<{ activity_id: number }[]>(Prisma.sql`
      SELECT a.activity_id
      FROM activities a
      WHERE a.activity_id = ${activityId}
        AND a.active = true
        AND a.attendees::jsonb @> jsonb_build_array(${userId}::text)
        ${typeFilter}
      LIMIT 1
    `);

    if (rows.length === 0) {
      throw new AppBadRequestException(ErrorCode.CERT_REQUIREMENT_INCOMPLETE, {
        reason: 'linked_activity_not_attended',
        linked_activity_id: activityId,
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
        // The response row is created empty by presign/saveDraft, so its mere
        // existence proves nothing: require at least one CONFIRMED, active
        // evidence uploaded for it.
        return (response?.certification_evidences?.length ?? 0) > 0;
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
      status: progressBySection.get(s.section_id) ?? 'DRAFT',
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
      description: section.description ?? null,
      instructions: section.instructions ?? null,
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
          instructions: c.instructions ?? null,
          configuration: c.configuration ?? {},
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

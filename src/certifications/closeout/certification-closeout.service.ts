import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
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
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../../common/services/file-storage.service';
import type { FileStorageService } from '../../common/services/file-storage.service';
import {
  assertReadyForCloseout,
  transitionEnrollment,
} from '../domain/certification-state-machine';
import type {
  CertificationEnrollmentStatus,
  CertificationRequirementStatus,
  RequirementProgressSnapshot,
} from '../domain/certification-definition.types';
import {
  assertAllowedEvidenceFile,
  assertConfirmedObjectMatches,
  extractSafeExtension,
  SIGNED_UPLOAD_TTL_SECONDS,
} from '../evidence/certification-evidence.constants';
import type { PresignCertificationCloseoutEvidenceDto } from '../dto/review-certification-closeout.dto';
import type { ConfirmCertificationCloseoutEvidenceDto } from '../dto/review-certification-closeout.dto';
import type { RequestCertificationCloseoutChangesDto } from '../dto/review-certification-closeout.dto';

type CloseoutDbClient = PrismaService | Prisma.TransactionClient;

export type CertificationCloseoutReviewActor = {
  userId: string;
  localFieldId?: number;
  globalAccess: boolean;
};

type EnrollmentRecord = {
  enrollment_id: number;
  user_id: string;
  certification_id: number;
  certification_version_id: number;
  status: string;
};

@Injectable()
export class CertificationCloseoutService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  // ===========================================================================
  // PARTICIPANT: closeout evidence presign / confirm / submit-final
  // ===========================================================================

  async presignCloseoutEvidence(
    userId: string,
    certificationId: number,
    dto: PresignCertificationCloseoutEvidenceDto,
  ) {
    assertAllowedEvidenceFile(dto.mime_type, dto.file_size);

    return this.prisma.$transaction(async (tx) => {
      const enrollment = await this.getOwnedEnrollmentOrThrow(
        userId,
        certificationId,
        tx,
      );
      await this.ensureEnrollmentReadyForCloseout(tx, enrollment);

      // Replace-before-send: deactivate any evidence not yet approved so the
      // enrollment always has at most one live closeout evidence in flight.
      await tx.certification_closeout_evidences.updateMany({
        where: {
          enrollment_id: enrollment.enrollment_id,
          active: true,
          review_status: { not: 'APPROVED' },
        },
        data: { active: false, deleted_at: new Date() },
      });

      const safeExtension = extractSafeExtension(dto.file_name);
      const objectKey = `enrollment-${enrollment.enrollment_id}/closeout/${randomUUID()}${safeExtension}`;

      const signed = await this.fileStorage.getSignedUploadUrl(
        StorageBucketAlias.CERTIFICATION_EVIDENCE,
        objectKey,
        {
          contentType: dto.mime_type,
          contentLength: dto.file_size,
          expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS,
        },
      );

      const evidence = await tx.certification_closeout_evidences.create({
        data: {
          enrollment_id: enrollment.enrollment_id,
          object_key: signed.key,
          original_filename: dto.file_name,
          mime_type: dto.mime_type,
          size_bytes: BigInt(dto.file_size),
          upload_status: 'PENDING_UPLOAD',
          review_status: 'PENDING',
          uploaded_by_id: userId,
        },
      });

      return {
        closeout_evidence_id: evidence.closeout_evidence_id,
        upload_url: signed.url,
        object_key: signed.key,
        expires_in: signed.expiresInSeconds,
        required_headers: { 'Content-Type': dto.mime_type },
      };
    });
  }

  async confirmCloseoutEvidence(
    userId: string,
    certificationId: number,
    dto: ConfirmCertificationCloseoutEvidenceDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const enrollment = await this.getOwnedEnrollmentOrThrow(
        userId,
        certificationId,
        tx,
      );

      const evidence = await tx.certification_closeout_evidences.findFirst({
        where: {
          closeout_evidence_id: dto.closeout_evidence_id,
          enrollment_id: enrollment.enrollment_id,
          upload_status: 'PENDING_UPLOAD',
          active: true,
        },
      });
      if (!evidence) {
        throw new AppNotFoundException(ErrorCode.RECORD_NOT_FOUND);
      }

      const stored = await this.fileStorage.getObjectInfo(
        StorageBucketAlias.CERTIFICATION_EVIDENCE,
        evidence.object_key,
      );
      assertConfirmedObjectMatches(stored, Number(evidence.size_bytes));

      const confirmed = await tx.certification_closeout_evidences.update({
        where: { closeout_evidence_id: evidence.closeout_evidence_id },
        data: {
          upload_status: 'CONFIRMED',
          confirmed_at: new Date(),
          size_bytes: BigInt(stored!.size),
          mime_type: stored!.contentType ?? evidence.mime_type,
        },
      });

      return {
        closeout_evidence_id: confirmed.closeout_evidence_id,
        upload_status: confirmed.upload_status,
        review_status: confirmed.review_status,
      };
    });
  }

  async submitFinal(userId: string, certificationId: number) {
    return this.prisma.$transaction(async (tx) => {
      const enrollment = await this.getOwnedEnrollmentOrThrow(
        userId,
        certificationId,
        tx,
      );

      if (enrollment.status !== 'READY_FOR_CLOSEOUT') {
        throw new AppBadRequestException(ErrorCode.CERT_CLOSEOUT_INCOMPLETE, {
          reason: 'enrollment_not_ready',
          status: enrollment.status,
        });
      }

      const snapshots = await this.loadRequirementSnapshots(tx, enrollment);
      assertReadyForCloseout(snapshots);

      const evidence = await tx.certification_closeout_evidences.findFirst({
        where: { enrollment_id: enrollment.enrollment_id, active: true },
        orderBy: { created_at: 'desc' },
      });
      if (!evidence || evidence.upload_status !== 'CONFIRMED') {
        throw new AppBadRequestException(ErrorCode.CERT_CLOSEOUT_INCOMPLETE, {
          reason: 'closeout_evidence_missing',
        });
      }

      const nextStatus = transitionEnrollment(
        enrollment.status as CertificationEnrollmentStatus,
        'SUBMITTED_FOR_FINAL_REVIEW',
      );

      await tx.users_certifications.update({
        where: { enrollment_id: enrollment.enrollment_id },
        data: { status: nextStatus, submitted_at: new Date() },
      });

      await tx.certification_closeout_evidences.update({
        where: { closeout_evidence_id: evidence.closeout_evidence_id },
        data: { review_status: 'SUBMITTED' },
      });

      await tx.certification_review_events.create({
        data: {
          enrollment_id: enrollment.enrollment_id,
          event_type: 'CLOSEOUT_SUBMITTED',
          performed_by_id: userId,
          from_status: enrollment.status,
          to_status: nextStatus,
        },
      });

      return { enrollment_id: enrollment.enrollment_id, status: nextStatus };
    });
  }

  // ===========================================================================
  // REVIEWER: final tray (closeout evidence approval + certify)
  // ===========================================================================

  async getFinalTray(actor: CertificationCloseoutReviewActor) {
    if (!actor.globalAccess && actor.localFieldId == null) {
      return [];
    }

    const rows = await this.prisma.users_certifications.findMany({
      where: {
        status: 'SUBMITTED_FOR_FINAL_REVIEW',
        active: true,
        ...(actor.globalAccess
          ? {}
          : { users: { local_field_id: actor.localFieldId } }),
      },
      include: {
        users: {
          select: { user_id: true, name: true, paternal_last_name: true },
        },
        certifications: { select: { certification_id: true, name: true } },
        certification_closeout_evidences: {
          where: { active: true },
          orderBy: { created_at: 'desc' },
          take: 1,
        },
      },
      orderBy: { submitted_at: 'asc' },
    });

    return rows.map((row) => ({
      enrollment_id: row.enrollment_id,
      certification_id: row.certifications.certification_id,
      certification_name: row.certifications.name,
      status: row.status,
      submitted_at: row.submitted_at,
      participant: {
        user_id: row.users.user_id,
        name: row.users.name,
        paternal_last_name: row.users.paternal_last_name,
      },
      closeout_evidence: row.certification_closeout_evidences[0]
        ? {
            closeout_evidence_id:
              row.certification_closeout_evidences[0].closeout_evidence_id,
            review_status: row.certification_closeout_evidences[0].review_status,
            original_filename:
              row.certification_closeout_evidences[0].original_filename,
          }
        : null,
    }));
  }

  async approveCloseoutEvidence(
    actor: CertificationCloseoutReviewActor,
    enrollmentId: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const enrollment = await this.getEnrollmentInScopeOrThrow(
        actor,
        enrollmentId,
        tx,
      );

      if (enrollment.status !== 'SUBMITTED_FOR_FINAL_REVIEW') {
        throw new AppBadRequestException(ErrorCode.CERT_INVALID_TRANSITION, {
          from: enrollment.status,
          to: 'APPROVED',
          entity: 'enrollment',
        });
      }

      const evidence = await tx.certification_closeout_evidences.findFirst({
        where: { enrollment_id: enrollmentId, active: true },
        orderBy: { created_at: 'desc' },
      });
      if (!evidence || evidence.review_status !== 'SUBMITTED') {
        throw new AppBadRequestException(ErrorCode.CERT_CLOSEOUT_INCOMPLETE, {
          reason: 'closeout_evidence_not_submitted',
        });
      }

      await tx.certification_closeout_evidences.update({
        where: { closeout_evidence_id: evidence.closeout_evidence_id },
        data: {
          review_status: 'APPROVED',
          reviewed_by_id: actor.userId,
          reviewed_at: new Date(),
        },
      });

      const nextStatus = transitionEnrollment(
        enrollment.status as CertificationEnrollmentStatus,
        'APPROVED',
      );
      await tx.users_certifications.update({
        where: { enrollment_id: enrollmentId },
        data: { status: nextStatus, approved_at: new Date() },
      });

      await tx.certification_review_events.create({
        data: {
          enrollment_id: enrollmentId,
          event_type: 'CLOSEOUT_APPROVED',
          performed_by_id: actor.userId,
          from_status: enrollment.status,
          to_status: nextStatus,
        },
      });

      return { enrollment_id: enrollmentId, status: nextStatus };
    });
  }

  async requestChanges(
    actor: CertificationCloseoutReviewActor,
    enrollmentId: number,
    dto: RequestCertificationCloseoutChangesDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const enrollment = await this.getEnrollmentInScopeOrThrow(
        actor,
        enrollmentId,
        tx,
      );

      if (enrollment.status !== 'SUBMITTED_FOR_FINAL_REVIEW') {
        throw new AppBadRequestException(ErrorCode.CERT_INVALID_TRANSITION, {
          from: enrollment.status,
          to: 'CHANGES_REQUESTED',
          entity: 'enrollment',
        });
      }

      const evidence = await tx.certification_closeout_evidences.findFirst({
        where: { enrollment_id: enrollmentId, active: true },
        orderBy: { created_at: 'desc' },
      });
      if (evidence) {
        await tx.certification_closeout_evidences.update({
          where: { closeout_evidence_id: evidence.closeout_evidence_id },
          data: {
            review_status: 'CHANGES_REQUESTED',
            review_comment: dto.comment,
            reviewed_by_id: actor.userId,
            reviewed_at: new Date(),
          },
        });
      }

      const nextStatus = transitionEnrollment(
        enrollment.status as CertificationEnrollmentStatus,
        'CHANGES_REQUESTED',
      );
      await tx.users_certifications.update({
        where: { enrollment_id: enrollmentId },
        data: { status: nextStatus },
      });

      await tx.certification_review_events.create({
        data: {
          enrollment_id: enrollmentId,
          event_type: 'CLOSEOUT_CHANGES_REQUESTED',
          performed_by_id: actor.userId,
          comment: dto.comment,
          from_status: enrollment.status,
          to_status: nextStatus,
        },
      });

      return { enrollment_id: enrollmentId, status: nextStatus };
    });
  }

  async certify(actor: CertificationCloseoutReviewActor, enrollmentId: number) {
    return this.prisma.$transaction(async (tx) => {
      const enrollment = await this.getEnrollmentInScopeOrThrow(
        actor,
        enrollmentId,
        tx,
      );

      if (enrollment.status === 'CERTIFIED') {
        // Idempotent: repeated certify calls on an already-certified
        // enrollment are a no-op success, not an error.
        return {
          enrollment_id: enrollmentId,
          status: 'CERTIFIED' as const,
          already_certified: true,
        };
      }

      if (enrollment.status !== 'APPROVED') {
        throw new AppBadRequestException(ErrorCode.CERT_CLOSEOUT_INCOMPLETE, {
          reason: 'enrollment_not_approved',
          status: enrollment.status,
        });
      }

      // Never trust the stored APPROVED status alone — re-verify every
      // required requirement and the closeout evidence inside this
      // transaction, since related data may have changed since approval.
      const snapshots = await this.loadRequirementSnapshots(tx, enrollment);
      assertReadyForCloseout(snapshots);

      const evidence = await tx.certification_closeout_evidences.findFirst({
        where: { enrollment_id: enrollmentId, active: true },
        orderBy: { created_at: 'desc' },
      });
      if (!evidence || evidence.review_status !== 'APPROVED') {
        throw new AppBadRequestException(ErrorCode.CERT_CLOSEOUT_INCOMPLETE, {
          reason: 'closeout_evidence_not_approved',
        });
      }

      const nextStatus = transitionEnrollment(
        enrollment.status as CertificationEnrollmentStatus,
        'CERTIFIED',
      );

      await tx.users_certifications.update({
        where: { enrollment_id: enrollmentId },
        data: {
          status: nextStatus,
          certified_at: new Date(),
          completion_status: true,
          completion_date: new Date(),
        },
      });

      await tx.certification_review_events.create({
        data: {
          enrollment_id: enrollmentId,
          event_type: 'CERTIFIED',
          performed_by_id: actor.userId,
          from_status: enrollment.status,
          to_status: nextStatus,
        },
      });

      return {
        enrollment_id: enrollmentId,
        status: nextStatus,
        already_certified: false,
      };
    });
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private async getOwnedEnrollmentOrThrow(
    userId: string,
    certificationId: number,
    db: CloseoutDbClient = this.prisma,
  ): Promise<EnrollmentRecord> {
    const enrollment = await db.users_certifications.findFirst({
      where: {
        user_id: userId,
        certification_id: certificationId,
        active: true,
      },
    });

    if (!enrollment) {
      throw new AppNotFoundException(ErrorCode.CERT_ENROLLMENT_NOT_FOUND);
    }

    return enrollment as EnrollmentRecord;
  }

  private async getEnrollmentInScopeOrThrow(
    actor: CertificationCloseoutReviewActor,
    enrollmentId: number,
    db: CloseoutDbClient = this.prisma,
  ): Promise<EnrollmentRecord & { user_local_field_id: number | null }> {
    const enrollment = await db.users_certifications.findFirst({
      where: { enrollment_id: enrollmentId, active: true },
      include: { users: { select: { local_field_id: true } } },
    });

    if (!enrollment) {
      throw new AppNotFoundException(ErrorCode.RECORD_NOT_FOUND);
    }

    if (enrollment.user_id === actor.userId) {
      throw new AppForbiddenException(ErrorCode.CERT_REVIEW_SCOPE_FORBIDDEN, {
        reason: 'reviewer_is_participant',
      });
    }

    const participantLocalFieldId = enrollment.users?.local_field_id ?? null;
    if (
      !actor.globalAccess &&
      (actor.localFieldId == null ||
        actor.localFieldId !== participantLocalFieldId)
    ) {
      throw new AppForbiddenException(ErrorCode.CERT_REVIEW_SCOPE_FORBIDDEN);
    }

    return {
      ...(enrollment as EnrollmentRecord),
      user_local_field_id: participantLocalFieldId,
    };
  }

  /**
   * Re-entering the closeout flow after a final-review return: required
   * requirements remain APPROVED from before, so we replay
   * CHANGES_REQUESTED -> IN_PROGRESS -> READY_FOR_CLOSEOUT in one step
   * rather than forcing the participant to resubmit already-approved work.
   */
  private async ensureEnrollmentReadyForCloseout(
    db: CloseoutDbClient,
    enrollment: EnrollmentRecord,
  ): Promise<void> {
    if (enrollment.status === 'READY_FOR_CLOSEOUT') return;

    if (enrollment.status !== 'CHANGES_REQUESTED') {
      throw new AppBadRequestException(ErrorCode.CERT_CLOSEOUT_INCOMPLETE, {
        reason: 'enrollment_not_ready',
        status: enrollment.status,
      });
    }

    await db.users_certifications.update({
      where: { enrollment_id: enrollment.enrollment_id },
      data: {
        status: transitionEnrollment(
          enrollment.status as CertificationEnrollmentStatus,
          'IN_PROGRESS',
        ),
      },
    });

    const snapshots = await this.loadRequirementSnapshots(db, enrollment);
    assertReadyForCloseout(snapshots);

    await db.users_certifications.update({
      where: { enrollment_id: enrollment.enrollment_id },
      data: {
        status: transitionEnrollment('IN_PROGRESS', 'READY_FOR_CLOSEOUT'),
      },
    });
    enrollment.status = 'READY_FOR_CLOSEOUT';
  }

  private async loadRequirementSnapshots(
    db: CloseoutDbClient,
    enrollment: Pick<EnrollmentRecord, 'enrollment_id' | 'certification_version_id'>,
  ): Promise<RequirementProgressSnapshot[]> {
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

    return sections.map((s) => ({
      requirementId: s.section_id,
      required: s.required,
      status: (progressBySection.get(s.section_id) ??
        'DRAFT') as CertificationRequirementStatus,
    }));
  }
}

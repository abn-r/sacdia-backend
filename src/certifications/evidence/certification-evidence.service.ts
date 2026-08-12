import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AppBadRequestException,
  AppNotFoundException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../../common/services/file-storage.service';
import type { FileStorageService } from '../../common/services/file-storage.service';
import { assertRequirementEditable } from '../domain/certification-state-machine';
import type { CertificationRequirementStatus } from '../domain/certification-definition.types';
import {
  assertAllowedEvidenceFile,
  assertConfirmedObjectMatches,
  extractSafeExtension,
  SIGNED_UPLOAD_TTL_SECONDS,
} from './certification-evidence.constants';
import type { PresignCertificationEvidenceDto } from '../dto/presign-certification-evidence.dto';
import type { ConfirmCertificationEvidenceDto } from '../dto/confirm-certification-evidence.dto';

type EvidenceDbClient = PrismaService | Prisma.TransactionClient;

type EnrollmentRecord = {
  enrollment_id: number;
  user_id: string;
  certification_id: number;
  certification_version_id: number;
};

type ComponentRecord = {
  component_id: number;
  component_type: string;
};

type SectionRecord = {
  section_id: number;
  module_id: number;
  certification_requirement_components: ComponentRecord[];
};

export type EvidenceView = {
  evidence_id: number;
  object_key: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  upload_status: string;
  confirmed_at: Date | null;
};

@Injectable()
export class CertificationEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  // ---------------------------------------------------------------------------
  // PRESIGN
  // ---------------------------------------------------------------------------

  async presign(
    userId: string,
    enrollmentId: number,
    sectionId: number,
    dto: PresignCertificationEvidenceDto,
  ) {
    assertAllowedEvidenceFile(dto.mime_type, dto.file_size);

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
      const component = this.getFileEvidenceComponentOrThrow(
        section,
        dto.component_id,
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

      const response = await tx.certification_component_responses.upsert({
        where: {
          progress_id_component_id: {
            progress_id: progress.progress_id,
            component_id: component.component_id,
          },
        },
        create: {
          progress_id: progress.progress_id,
          component_id: component.component_id,
        },
        update: {},
      });

      const safeExtension = extractSafeExtension(dto.file_name);
      const objectKey = `enrollment-${enrollment.enrollment_id}/requirement-${sectionId}/component-${component.component_id}/${randomUUID()}${safeExtension}`;

      const signed = await this.fileStorage.getSignedUploadUrl(
        StorageBucketAlias.CERTIFICATION_EVIDENCE,
        objectKey,
        {
          contentType: dto.mime_type,
          contentLength: dto.file_size,
          expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS,
        },
      );

      const evidence = await tx.certification_evidences.create({
        data: {
          response_id: response.response_id,
          object_key: signed.key,
          original_filename: dto.file_name,
          mime_type: dto.mime_type,
          size_bytes: BigInt(dto.file_size),
          upload_status: 'PENDING_UPLOAD',
          uploaded_by_id: userId,
        },
      });

      return {
        evidence_id: evidence.evidence_id,
        upload_url: signed.url,
        object_key: signed.key,
        expires_in: signed.expiresInSeconds,
        required_headers: { 'Content-Type': dto.mime_type },
      };
    });
  }

  // ---------------------------------------------------------------------------
  // CONFIRM
  // ---------------------------------------------------------------------------

  async confirm(
    userId: string,
    enrollmentId: number,
    sectionId: number,
    dto: ConfirmCertificationEvidenceDto,
  ): Promise<EvidenceView> {
    return this.prisma.$transaction(async (tx) => {
      const enrollment = await this.getOwnedEnrollmentOrThrow(
        userId,
        enrollmentId,
        tx,
      );
      await this.getSectionForEnrollmentOrThrow(sectionId, enrollment, tx);

      const progress = await tx.certification_section_progress.findFirst({
        where: {
          enrollment_id: enrollment.enrollment_id,
          section_id: sectionId,
        },
      });
      if (!progress) {
        throw new AppNotFoundException(ErrorCode.RECORD_NOT_FOUND);
      }
      assertRequirementEditable(
        progress.status as CertificationRequirementStatus,
      );

      const evidence = await tx.certification_evidences.findFirst({
        where: {
          evidence_id: dto.evidence_id,
          upload_status: 'PENDING_UPLOAD',
          active: true,
          certification_component_responses: {
            progress_id: progress.progress_id,
          },
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

      const confirmed = await tx.certification_evidences.update({
        where: { evidence_id: evidence.evidence_id },
        data: {
          upload_status: 'CONFIRMED',
          confirmed_at: new Date(),
          size_bytes: BigInt(stored!.size),
          mime_type: stored!.contentType ?? evidence.mime_type,
          checksum_sha256: dto.checksum_sha256 ?? evidence.checksum_sha256,
        },
      });

      return this.toEvidenceView(confirmed);
    });
  }

  // ---------------------------------------------------------------------------
  // DELETE (soft)
  // ---------------------------------------------------------------------------

  async delete(userId: string, enrollmentId: number, evidenceId: number) {
    return this.prisma.$transaction(async (tx) => {
      const enrollment = await this.getOwnedEnrollmentOrThrow(
        userId,
        enrollmentId,
        tx,
      );

      const evidence = await tx.certification_evidences.findFirst({
        where: {
          evidence_id: evidenceId,
          active: true,
          certification_component_responses: {
            certification_section_progress: {
              enrollment_id: enrollment.enrollment_id,
            },
          },
        },
        include: {
          certification_component_responses: {
            include: { certification_section_progress: true },
          },
        },
      });

      if (!evidence) {
        throw new AppNotFoundException(ErrorCode.RECORD_NOT_FOUND);
      }

      const progress =
        evidence.certification_component_responses
          .certification_section_progress;
      assertRequirementEditable(
        progress.status as CertificationRequirementStatus,
      );

      await tx.certification_evidences.update({
        where: { evidence_id: evidenceId },
        data: { active: false, deleted_at: new Date() },
      });

      return { message: 'Evidencia eliminada correctamente' };
    });
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private async getOwnedEnrollmentOrThrow(
    userId: string,
    enrollmentId: number,
    db: EvidenceDbClient = this.prisma,
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
    db: EvidenceDbClient = this.prisma,
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

  private getFileEvidenceComponentOrThrow(
    section: SectionRecord,
    componentId: number,
  ): ComponentRecord {
    const component = section.certification_requirement_components.find(
      (c) => c.component_id === componentId,
    );

    if (!component) {
      throw new AppBadRequestException(ErrorCode.CERT_SECTION_INVALID, {
        reason: 'component_not_in_section',
        component_id: componentId,
      });
    }

    if (component.component_type !== 'FILE_EVIDENCE') {
      throw new AppBadRequestException(ErrorCode.CERT_SECTION_INVALID, {
        reason: 'component_not_file_evidence',
        component_id: componentId,
      });
    }

    return component;
  }

  private toEvidenceView(evidence: {
    evidence_id: number;
    object_key: string;
    original_filename: string;
    mime_type: string;
    size_bytes: bigint;
    upload_status: string;
    confirmed_at: Date | null;
  }): EvidenceView {
    return {
      evidence_id: evidence.evidence_id,
      object_key: evidence.object_key,
      original_filename: evidence.original_filename,
      mime_type: evidence.mime_type,
      size_bytes: Number(evidence.size_bytes),
      upload_status: evidence.upload_status,
      confirmed_at: evidence.confirmed_at,
    };
  }
}

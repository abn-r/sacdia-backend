import { Injectable } from '@nestjs/common';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { ApproveEvidenceDto } from './dto/approve-evidence.dto';
import { RejectEvidenceDto } from './dto/reject-evidence.dto';
import {
  BulkApproveEvidenceDto,
  EvidenceType,
} from './dto/bulk-approve-evidence.dto';
import { BulkRejectEvidenceDto } from './dto/bulk-reject-evidence.dto';
import { HonorValidationWorkflowService } from '../honors/honor-validation-workflow.service';

// ─── Status constants ─────────────────────────────────────────────────────────
//
// class_section_progress.status uses
// evidence_validation_enum (PENDING / VALIDATED / REJECTED) after the
// 20260327200000_migrate_evidence_status_to_enum migration.
// users_honors.validation_status now uses honor_validation_status_enum (IN_PROGRESS /
// PENDING_REVIEW / APPROVED / REJECTED) after the 20260328110000_honor_validation_status_enum
// migration.

const CLASS_STATUS_SUBMITTED = 'SUBMITTED';
const CLASS_STATUS_VALIDATED = 'VALIDATED';
const CLASS_STATUS_REJECTED = 'REJECTED';

const HONOR_STATUS_PENDING = 'PENDING_REVIEW';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildMemberName(
  user: { name?: string | null; paternal_last_name?: string | null } | null,
): string {
  if (!user) return 'Miembro desconocido';
  return (
    [user.name, user.paternal_last_name].filter(Boolean).join(' ') ||
    'Miembro desconocido'
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type EvidenceItem = {
  id: number;
  type: EvidenceType;
  status: string;
  member_name: string;
  member_id: string;
  section_name: string;
  file_count: number;
  submitted_at: Date | null;
  validated_at: Date | null;
  rejection_reason: string | null;
};

export type EvidenceFile = {
  evidence_file_id: number;
  file_url: string;
  file_name: string;
  file_type: string;
  uploaded_at: Date;
};

export type EvidenceDetail = EvidenceItem & {
  files: EvidenceFile[];
  validated_by_name: string | null;
  honor_review_packet?: HonorReviewPacket;
};

export type HonorRequirementReviewItem = {
  requirement_id: number;
  requirement_number: string;
  display_label: string | null;
  requirement_text: string;
  requires_evidence: boolean;
  completed: boolean;
  completed_at: Date | null;
  evidence_count: number;
  evidences: EvidenceFile[];
};

export type HonorReviewPacket = {
  user_honor_id: number;
  honor_id: number;
  honor_name: string;
  validation_status: string;
  progress: {
    total_requirements: number;
    completed_count: number;
    progress_percentage: number;
  };
  general_files: EvidenceFile[];
  requirement_files: EvidenceFile[];
  requirements: HonorRequirementReviewItem[];
};

export type BulkOperationResult = {
  succeeded: number[];
  failed: { id: number; reason: string }[];
};

export type HistoryEntry = {
  action: string;
  performed_by_name: string | null;
  comment: string | null;
  created_at: Date;
};

// ─── User select shape reused across queries ──────────────────────────────────

const USER_NAME_SELECT = {
  user_id: true,
  name: true,
  paternal_last_name: true,
} as const;

@Injectable()
export class EvidenceReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly honorValidationWorkflow: HonorValidationWorkflowService,
  ) {}

  // ============================================================
  // GET /evidence-review/pending
  // ============================================================

  async getPending(
    type?: EvidenceType,
    page = 1,
    limit = 20,
  ): Promise<{
    data: EvidenceItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    const skip = (page - 1) * limit;

    const [classItems, honorItems] = await Promise.all([
      !type || type === 'class' ? this.getClassPending() : Promise.resolve([]),
      !type || type === 'honor' ? this.getHonorPending() : Promise.resolve([]),
    ]);

    const all: EvidenceItem[] = [...classItems, ...honorItems].sort((a, b) => {
      const aDate = a.submitted_at?.getTime() ?? 0;
      const bDate = b.submitted_at?.getTime() ?? 0;
      return aDate - bDate;
    });

    const total = all.length;
    const data = all.slice(skip, skip + limit);

    return { data, total, page, limit };
  }

  private async getClassPending(): Promise<EvidenceItem[]> {
    const records = await this.prisma.class_section_progress.findMany({
      where: {
        status: CLASS_STATUS_SUBMITTED,
        active: true,
        submitted_at: { not: null },
      },
      include: {
        users: {
          select: USER_NAME_SELECT,
        },
        evidence_files: {
          where: { active: true },
          select: { evidence_file_id: true },
        },
      },
      orderBy: { submitted_at: 'asc' },
    });

    return records.map((r) => ({
      id: r.section_progress_id,
      type: 'class',
      status: r.status,
      member_name: buildMemberName(r.users),
      member_id: r.user_id,
      section_name: `Sección de clase #${r.section_id}`,
      file_count: r.evidence_files.length,
      submitted_at: r.submitted_at,
      validated_at: r.validated_at,
      rejection_reason: r.rejection_reason,
    }));
  }

  private async getHonorPending(): Promise<EvidenceItem[]> {
    const records = await this.prisma.users_honors.findMany({
      where: {
        validation_status: HONOR_STATUS_PENDING,
        active: true,
        submitted_at: { not: null },
      },
      include: {
        users: {
          select: USER_NAME_SELECT,
        },
        honors: {
          select: { honor_id: true, name: true },
        },
        // Prefer normalized evidence_files; fall back to JSON images count below.
        evidence_files: {
          where: { active: true },
          select: { evidence_file_id: true },
        },
      },
      orderBy: { submitted_at: 'asc' },
    });

    return records.map((r) => {
      // Use evidence_files count when available (post-migration); fall back to
      // the legacy JSON array count for records not yet migrated.
      const fileCount =
        r.evidence_files.length > 0
          ? r.evidence_files.length
          : Array.isArray(r.images)
            ? (r.images as unknown[]).length
            : 0;

      return {
        id: r.user_honor_id,
        type: 'honor',
        status: r.validation_status,
        member_name: buildMemberName(r.users),
        member_id: r.user_id,
        section_name: r.honors?.name ?? `Honor #${r.honor_id}`,
        file_count: fileCount,
        submitted_at: r.submitted_at,
        validated_at: r.validated_at,
        rejection_reason: r.rejection_reason,
      };
    });
  }

  // ============================================================
  // GET /evidence-review/:type/:id  (detail with files)
  // ============================================================

  async getDetail(type: EvidenceType, id: number): Promise<EvidenceDetail> {
    switch (type) {
      case 'class':
        return this.getClassDetail(id);
      case 'honor':
        return this.getHonorDetail(id);
      default:
        throw new AppBadRequestException(
          ErrorCode.EVIDENCE_REVIEW_TYPE_INVALID,
          { type },
        );
    }
  }

  private async getClassDetail(id: number): Promise<EvidenceDetail> {
    const record = await this.prisma.class_section_progress.findUnique({
      where: { section_progress_id: id },
      include: {
        users: {
          select: USER_NAME_SELECT,
        },
        evidence_files: {
          where: { active: true },
          orderBy: { uploaded_at: 'asc' },
        },
        validated_by_user: {
          select: { name: true, paternal_last_name: true },
        },
      },
    });

    if (!record) {
      throw new AppNotFoundException(
        ErrorCode.EVIDENCE_REVIEW_CLASS_RECORD_NOT_FOUND,
        { id },
      );
    }

    return {
      id: record.section_progress_id,
      type: 'class',
      status: record.status,
      member_name: buildMemberName(record.users),
      member_id: record.user_id,
      section_name: `Sección de clase #${record.section_id}`,
      file_count: record.evidence_files.length,
      submitted_at: record.submitted_at,
      validated_at: record.validated_at,
      rejection_reason: record.rejection_reason,
      files: record.evidence_files.map((f) => ({
        evidence_file_id: f.evidence_file_id,
        file_url: f.file_url,
        file_name: f.file_name,
        file_type: f.file_type,
        uploaded_at: f.uploaded_at,
      })),
      validated_by_name: record.validated_by_user
        ? buildMemberName(record.validated_by_user)
        : null,
    };
  }

  private async getHonorDetail(id: number): Promise<EvidenceDetail> {
    const record = await this.prisma.users_honors.findUnique({
      where: { user_honor_id: id },
      include: {
        users: {
          select: USER_NAME_SELECT,
        },
        honors: {
          select: { honor_id: true, name: true },
        },
        validator: {
          select: { name: true, paternal_last_name: true },
        },
        // Load normalized evidence files (populated after migration).
        evidence_files: {
          where: { active: true },
          orderBy: { uploaded_at: 'asc' },
        },
      },
    });

    if (!record) {
      throw new AppNotFoundException(
        ErrorCode.EVIDENCE_REVIEW_USER_HONOR_NOT_FOUND,
        { id },
      );
    }

    const honorReviewPacket = await this.buildHonorReviewPacket(record);
    const files = this.dedupeFiles([
      ...honorReviewPacket.general_files,
      ...honorReviewPacket.requirement_files,
    ]);

    return {
      id: record.user_honor_id,
      type: 'honor',
      status: record.validation_status,
      member_name: buildMemberName(record.users),
      member_id: record.user_id,
      section_name: record.honors?.name ?? `Honor #${record.honor_id}`,
      file_count: files.length,
      submitted_at: record.submitted_at,
      validated_at: record.validated_at,
      rejection_reason: record.rejection_reason,
      files,
      validated_by_name: record.validator
        ? buildMemberName(record.validator)
        : null,
      honor_review_packet: honorReviewPacket,
    };
  }

  private async buildHonorReviewPacket(record: {
    user_honor_id: number;
    honor_id: number;
    validation_status: string;
    certificate?: string | null;
    document?: unknown;
    images?: unknown;
    created_at?: Date | null;
    honors?: { honor_id: number; name: string } | null;
    evidence_files: Array<{
      evidence_file_id: number;
      file_url: string;
      file_name: string;
      file_type: string;
      uploaded_at: Date;
    }>;
  }): Promise<HonorReviewPacket> {
    const [requirements, progressRows] = await Promise.all([
      this.prisma.honor_requirements.findMany({
        where: { honor_id: record.honor_id, active: true },
        select: {
          requirement_id: true,
          requirement_number: true,
          display_label: true,
          requirement_text: true,
          requires_evidence: true,
          parent_id: true,
        },
        orderBy: { requirement_number: 'asc' },
      }),
      this.prisma.user_honor_requirement_progress.findMany({
        where: { user_honor_id: record.user_honor_id, active: true },
        include: {
          requirement_evidence: {
            where: { active: true },
            orderBy: { created_at: 'asc' },
          },
        },
      }),
    ]);

    const progressByRequirement = new Map(
      progressRows.map((progress) => [progress.requirement_id, progress]),
    );

    const requirementsPacket: HonorRequirementReviewItem[] = requirements.map(
      (requirement) => {
        const progress = progressByRequirement.get(requirement.requirement_id);
        const evidences = (progress?.requirement_evidence ?? []).map(
          (evidence, index) =>
            this.mapRequirementEvidenceFile(
              evidence,
              requirement.requirement_id,
              index,
            ),
        );

        return {
          requirement_id: requirement.requirement_id,
          requirement_number: String(requirement.requirement_number),
          display_label: requirement.display_label,
          requirement_text: requirement.requirement_text,
          requires_evidence: requirement.requires_evidence,
          completed: progress?.completed ?? false,
          completed_at: progress?.completed_at ?? null,
          evidence_count: evidences.length,
          evidences,
        };
      },
    );

    const parentIds = new Set(
      requirements
        .map((requirement) => requirement.parent_id)
        .filter((id): id is number => id !== null),
    );
    const leafRequirementIds = requirements
      .filter((requirement) => !parentIds.has(requirement.requirement_id))
      .map((requirement) => requirement.requirement_id);
    const completedCount = leafRequirementIds.filter(
      (requirementId) =>
        progressByRequirement.get(requirementId)?.completed === true,
    ).length;
    const totalRequirements = leafRequirementIds.length;

    const normalizedFiles = record.evidence_files.map((file) => ({
      evidence_file_id: file.evidence_file_id,
      file_url: file.file_url,
      file_name: file.file_name,
      file_type: file.file_type,
      uploaded_at: file.uploaded_at,
    }));
    const legacyFiles = this.buildLegacyHonorFiles(record);
    const generalFiles = this.dedupeFiles([...normalizedFiles, ...legacyFiles]);
    const requirementFiles = this.dedupeFiles(
      requirementsPacket.flatMap((requirement) => requirement.evidences),
    );

    return {
      user_honor_id: record.user_honor_id,
      honor_id: record.honor_id,
      honor_name: record.honors?.name ?? `Honor #${record.honor_id}`,
      validation_status: record.validation_status,
      progress: {
        total_requirements: totalRequirements,
        completed_count: completedCount,
        progress_percentage:
          totalRequirements === 0
            ? 0
            : Math.round((completedCount / totalRequirements) * 10000) / 100,
      },
      general_files: generalFiles,
      requirement_files: requirementFiles,
      requirements: requirementsPacket,
    };
  }

  private buildLegacyHonorFiles(record: {
    certificate?: string | null;
    document?: unknown;
    images?: unknown;
    created_at?: Date | null;
  }): EvidenceFile[] {
    const uploadedAt = record.created_at ?? new Date(0);
    const files: EvidenceFile[] = [];

    if (record.certificate) {
      files.push(
        this.buildSyntheticFile(
          -1,
          record.certificate,
          uploadedAt,
          'certificado',
        ),
      );
    }

    if (typeof record.document === 'string' && record.document.length > 0) {
      files.push(
        this.buildSyntheticFile(-2, record.document, uploadedAt, 'documento'),
      );
    }

    const images = Array.isArray(record.images)
      ? (record.images as unknown[])
      : [];
    images.forEach((image, index) => {
      const url =
        typeof image === 'string'
          ? image
          : ((image as { url?: string }).url ?? '');
      if (url.length === 0) return;
      files.push(
        this.buildSyntheticFile(
          -1000 - index,
          url,
          uploadedAt,
          `imagen-${index + 1}`,
        ),
      );
    });

    return files;
  }

  private mapRequirementEvidenceFile(
    evidence: {
      evidence_id: number;
      url: string;
      filename: string | null;
      mime_type: string | null;
      created_at: Date;
    },
    requirementId: number,
    index: number,
  ): EvidenceFile {
    const fallbackName = `requisito-${requirementId}-evidencia-${index + 1}`;
    const fileName =
      evidence.filename ?? this.fileNameFromUrl(evidence.url) ?? fallbackName;

    return {
      evidence_file_id: -100000 - evidence.evidence_id,
      file_url: evidence.url,
      file_name: fileName,
      file_type: this.inferFileType(fileName, evidence.url, evidence.mime_type),
      uploaded_at: evidence.created_at,
    };
  }

  private buildSyntheticFile(
    evidenceFileId: number,
    url: string,
    uploadedAt: Date,
    fallbackName: string,
  ): EvidenceFile {
    const fileName = this.fileNameFromUrl(url) ?? fallbackName;
    return {
      evidence_file_id: evidenceFileId,
      file_url: url,
      file_name: fileName,
      file_type: this.inferFileType(fileName, url),
      uploaded_at: uploadedAt,
    };
  }

  private fileNameFromUrl(url: string): string | null {
    const rawName = url.split('/').pop()?.split('?')[0] ?? '';
    return rawName.length > 0 ? rawName : null;
  }

  private inferFileType(
    fileName: string,
    url: string,
    explicitType?: string | null,
  ): string {
    if (explicitType) return explicitType;
    const value = `${fileName} ${url}`.toLowerCase();
    if (/\.(jpe?g)(\?|$|\s)/i.test(value)) return 'image/jpeg';
    if (/\.png(\?|$|\s)/i.test(value)) return 'image/png';
    if (/\.gif(\?|$|\s)/i.test(value)) return 'image/gif';
    if (/\.webp(\?|$|\s)/i.test(value)) return 'image/webp';
    if (/\.pdf(\?|$|\s)/i.test(value)) return 'application/pdf';
    return 'application/octet-stream';
  }

  private dedupeFiles(files: EvidenceFile[]): EvidenceFile[] {
    const seen = new Set<string>();
    const deduped: EvidenceFile[] = [];
    for (const file of files) {
      if (seen.has(file.file_url)) continue;
      seen.add(file.file_url);
      deduped.push(file);
    }
    return deduped;
  }

  // ============================================================
  // POST /evidence-review/:type/:id/approve
  // ============================================================

  async approve(
    type: EvidenceType,
    id: number,
    actorId: string,
    dto: ApproveEvidenceDto,
  ): Promise<{ id: number; type: EvidenceType; status: string }> {
    switch (type) {
      case 'class':
        return this.approveClass(id, actorId, dto.comments);
      case 'honor':
        return this.honorValidationWorkflow.approve(id, actorId, dto.comments);
      default:
        throw new AppBadRequestException(
          ErrorCode.EVIDENCE_REVIEW_TYPE_INVALID,
          { type },
        );
    }
  }

  private async approveClass(id: number, actorId: string, comments?: string) {
    const record = await this.prisma.class_section_progress.findUnique({
      where: { section_progress_id: id },
    });

    if (!record) {
      throw new AppNotFoundException(
        ErrorCode.EVIDENCE_REVIEW_CLASS_RECORD_NOT_FOUND,
        { id },
      );
    }

    if (record.status !== CLASS_STATUS_SUBMITTED) {
      throw new AppBadRequestException(
        ErrorCode.EVIDENCE_REVIEW_RECORD_NOT_PENDING,
        { status: record.status },
      );
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.class_section_progress.update({
        where: { section_progress_id: id },
        data: {
          status: CLASS_STATUS_VALIDATED,
          validated_by_id: actorId,
          validated_at: now,
          rejection_reason: null,
        },
      });

      await tx.validation_logs.create({
        data: {
          entity_type: 'class',
          entity_id: String(id),
          user_id: record.submitted_by_id ?? record.user_id,
          action: 'APPROVED',
          performed_by: actorId,
          comment: comments ?? null,
        },
      });

      return result;
    });

    return {
      id: updated.section_progress_id,
      type: 'class' as EvidenceType,
      status: updated.status,
    };
  }

  // ============================================================
  // POST /evidence-review/:type/:id/reject
  // ============================================================

  async reject(
    type: EvidenceType,
    id: number,
    actorId: string,
    dto: RejectEvidenceDto,
  ): Promise<{ id: number; type: EvidenceType; status: string }> {
    switch (type) {
      case 'class':
        return this.rejectClass(id, actorId, dto.reason);
      case 'honor':
        return this.honorValidationWorkflow.reject(id, actorId, dto.reason);
      default:
        throw new AppBadRequestException(
          ErrorCode.EVIDENCE_REVIEW_TYPE_INVALID,
          { type },
        );
    }
  }

  private async rejectClass(id: number, actorId: string, reason: string) {
    const record = await this.prisma.class_section_progress.findUnique({
      where: { section_progress_id: id },
    });

    if (!record) {
      throw new AppNotFoundException(
        ErrorCode.EVIDENCE_REVIEW_CLASS_RECORD_NOT_FOUND,
        { id },
      );
    }

    if (record.status === CLASS_STATUS_REJECTED) {
      throw new AppBadRequestException(
        ErrorCode.EVIDENCE_REVIEW_RECORD_ALREADY_REJECTED,
      );
    }

    if (record.status === CLASS_STATUS_VALIDATED) {
      throw new AppConflictException(
        ErrorCode.EVIDENCE_REVIEW_RECORD_ALREADY_VALIDATED,
      );
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.class_section_progress.update({
        where: { section_progress_id: id },
        data: {
          status: CLASS_STATUS_REJECTED,
          validated_by_id: actorId,
          validated_at: now,
          rejection_reason: reason,
        },
      });

      await tx.validation_logs.create({
        data: {
          entity_type: 'class',
          entity_id: String(id),
          user_id: record.submitted_by_id ?? record.user_id,
          action: 'REJECTED',
          performed_by: actorId,
          comment: reason,
        },
      });

      return result;
    });

    return {
      id: updated.section_progress_id,
      type: 'class' as EvidenceType,
      status: updated.status,
    };
  }

  // ============================================================
  // POST /evidence-review/bulk-approve
  // ============================================================

  async bulkApprove(
    actorId: string,
    dto: BulkApproveEvidenceDto,
  ): Promise<BulkOperationResult> {
    const succeeded: number[] = [];
    const failed: { id: number; reason: string }[] = [];

    for (const id of dto.ids) {
      try {
        await this.approve(dto.type, id, actorId, { comments: dto.comments });
        succeeded.push(id);
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : 'Error desconocido';
        failed.push({ id, reason });
      }
    }

    return { succeeded, failed };
  }

  // ============================================================
  // POST /evidence-review/bulk-reject
  // ============================================================

  async bulkReject(
    actorId: string,
    dto: BulkRejectEvidenceDto,
  ): Promise<BulkOperationResult> {
    const succeeded: number[] = [];
    const failed: { id: number; reason: string }[] = [];

    for (const id of dto.ids) {
      try {
        await this.reject(dto.type, id, actorId, { reason: dto.reason });
        succeeded.push(id);
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : 'Error desconocido';
        failed.push({ id, reason });
      }
    }

    return { succeeded, failed };
  }

  // ============================================================
  // GET /evidence-review/:type/:id/history
  // ============================================================

  async getHistory(type: EvidenceType, id: number): Promise<HistoryEntry[]> {
    const validTypes: EvidenceType[] = ['class', 'honor'];
    if (!validTypes.includes(type)) {
      throw new AppBadRequestException(ErrorCode.EVIDENCE_REVIEW_TYPE_INVALID, {
        type,
      });
    }

    const logs = await this.prisma.validation_logs.findMany({
      where: {
        entity_type: type,
        entity_id: String(id),
      },
      include: {
        performer: {
          select: { name: true, paternal_last_name: true },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    return logs.map((log) => ({
      action: log.action,
      performed_by_name: log.performer ? buildMemberName(log.performer) : null,
      comment: log.comment,
      created_at: log.created_at,
    }));
  }
}

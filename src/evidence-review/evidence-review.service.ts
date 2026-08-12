import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import {
  Prisma,
  evidence_validation_enum,
  honor_validation_status_enum,
} from '@prisma/client';
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
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import { isDeletedAccountSnapshot } from '../common/utils/deleted-account';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { CoordinationService } from '../coordination/coordination.service';

// ─── Status constants ─────────────────────────────────────────────────────────
//
// class_section_progress.status uses
// evidence_validation_enum (PENDING / VALIDATED / REJECTED) after the
// 20260327200000_migrate_evidence_status_to_enum migration.
// users_honors.validation_status now uses honor_validation_status_enum (IN_PROGRESS /
// PENDING_REVIEW / APPROVED / REJECTED) after the 20260328110000_honor_validation_status_enum
// migration.

const CLASS_STATUS_SUBMITTED = evidence_validation_enum.SUBMITTED;
const CLASS_STATUS_VALIDATED = evidence_validation_enum.VALIDATED;
const CLASS_STATUS_REJECTED = evidence_validation_enum.REJECTED;

const HONOR_STATUS_PENDING = honor_validation_status_enum.PENDING_REVIEW;

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
  member_is_deleted: boolean;
  member_id: string;
  entity_name: string;
  section_name: string;
  entity_description: string | null;
  module_name: string | null;
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
  text_response: string | null;
  completed_at: Date | null;
  evidence_count: number;
  evidences: EvidenceFile[];
};

export type HonorReviewPacket = {
  user_honor_id: number;
  honor_id: number;
  honor_name: string;
  validation_status: string;
  completion_mode: string;
  progress: {
    total_requirements: number;
    completed_count: number;
    progress_percentage: number;
  };
  completed_format_file: EvidenceFile | null;
  general_files: EvidenceFile[];
  requirement_files: EvidenceFile[];
  requirements: HonorRequirementReviewItem[];
};

type PendingIdentifierRow = {
  id: number;
  item_type: 'class' | 'honor';
  submitted_at: Date;
  total_count: string | number | bigint;
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
  active: true,
  email: true,
} as const;

@Injectable()
export class EvidenceReviewService {
  private readonly logger = new Logger(EvidenceReviewService.name);
  private static readonly SIGNED_FILE_URL_TTL_SECONDS = 300;

  constructor(
    private readonly prisma: PrismaService,
    private readonly honorValidationWorkflow: HonorValidationWorkflowService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly coordinationService: CoordinationService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  // ============================================================
  // GET /evidence-review/pending
  // ============================================================

  async getPending(
    actorId: string,
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
    const scopedClubSectionIds =
      await this.resolveCoordinatorSectionScope(actorId);
    if (scopedClubSectionIds?.length === 0) {
      return { data: [], total: 0, page, limit };
    }

    if (type === 'class') {
      const where = this.buildClassPendingWhere(scopedClubSectionIds);
      const [total, data] = await Promise.all([
        this.prisma.class_section_progress.count({ where }),
        this.getClassPending(scopedClubSectionIds, {
          skip,
          take: limit,
        }),
      ]);

      return { data, total, page, limit };
    }

    if (type === 'honor') {
      const where = this.buildHonorPendingWhere(scopedClubSectionIds);
      const [total, data] = await Promise.all([
        this.prisma.users_honors.count({ where }),
        this.getHonorPending(scopedClubSectionIds, {
          skip,
          take: limit,
        }),
      ]);

      return { data, total, page, limit };
    }

    if (type !== undefined) {
      return { data: [], total: 0, page, limit };
    }

    const identifiers = await this.getCombinedPendingIdentifiers(
      scopedClubSectionIds,
      skip,
      limit,
    );

    if (identifiers.length === 0) {
      const total = await this.getCombinedPendingCount(scopedClubSectionIds);
      return { data: [], total, page, limit };
    }

    const classIds = identifiers
      .filter((item) => item.item_type === 'class')
      .map((item) => item.id);
    const honorIds = identifiers
      .filter((item) => item.item_type === 'honor')
      .map((item) => item.id);

    const [classItems, honorItems] = await Promise.all([
      classIds.length > 0
        ? this.getClassPending(scopedClubSectionIds, {
            ids: classIds,
          })
        : Promise.resolve([] as EvidenceItem[]),
      honorIds.length > 0
        ? this.getHonorPending(scopedClubSectionIds, {
            ids: honorIds,
          })
        : Promise.resolve([] as EvidenceItem[]),
    ]);

    const byIdentifier = new Map<string, EvidenceItem>();
    for (const item of [...classItems, ...honorItems]) {
      byIdentifier.set(`${item.type}-${item.id}`, item);
    }

    const data = identifiers
      .map((item) => byIdentifier.get(`${item.item_type}-${item.id}`))
      .filter((item): item is EvidenceItem => Boolean(item));

    return {
      data,
      total: Number(identifiers[0].total_count),
      page,
      limit,
    };
  }

  private async getClassPending(
    scopedClubSectionIds?: number[],
    options?: {
      skip?: number;
      take?: number;
      ids?: number[];
    },
  ): Promise<EvidenceItem[]> {
    if (scopedClubSectionIds?.length === 0) return [];
    if (options?.ids?.length === 0) return [];

    const query = {
      where: {
        ...this.buildClassPendingWhere(scopedClubSectionIds),
        ...(options?.ids
          ? {
              section_progress_id: {
                in: options.ids,
              },
            }
          : {}),
      },
      include: {
        users: {
          select: USER_NAME_SELECT,
        },
        classes: {
          select: { name: true, description: true },
        },
        evidence_files: {
          where: { active: true },
          select: { evidence_file_id: true },
        },
      },
      orderBy: { submitted_at: 'asc' },
      ...(options?.skip !== undefined ? { skip: options.skip } : {}),
      ...(options?.take !== undefined ? { take: options.take } : {}),
    } satisfies Prisma.class_section_progressFindManyArgs;

    const records = await this.prisma.class_section_progress.findMany(query);
    const { sectionsById, modulesById } =
      await this.resolveClassCatalogs(records);

    return records.map((r) => {
      const section = sectionsById.get(r.section_id);
      const module = modulesById.get(r.module_id);

      return {
        id: r.section_progress_id,
        type: 'class',
        status: r.status,
        member_name: buildMemberName(r.users),
        member_is_deleted: isDeletedAccountSnapshot(r.users),
        member_id: r.user_id,
        entity_name: r.classes?.name ?? `Clase #${r.class_id}`,
        section_name: section?.name ?? `Sección #${r.section_id}`,
        entity_description: section?.description ?? null,
        module_name: module?.name ?? null,
        file_count: r.evidence_files.length,
        submitted_at: r.submitted_at,
        validated_at: r.validated_at,
        rejection_reason: r.rejection_reason,
      };
    });
  }

  private async getHonorPending(
    scopedClubSectionIds?: number[],
    options?: {
      skip?: number;
      take?: number;
      ids?: number[];
    },
  ): Promise<EvidenceItem[]> {
    if (scopedClubSectionIds?.length === 0) return [];
    if (options?.ids?.length === 0) return [];

    const query = {
      where: {
        ...this.buildHonorPendingWhere(scopedClubSectionIds),
        ...(options?.ids
          ? {
              user_honor_id: {
                in: options.ids,
              },
            }
          : {}),
      },
      include: {
        users: {
          select: USER_NAME_SELECT,
        },
        honors: {
          select: { honor_id: true, name: true, description: true },
        },
        // Prefer normalized evidence_files; fall back to JSON images count below.
        evidence_files: {
          where: { active: true },
          select: { evidence_file_id: true },
        },
      },
      orderBy: { submitted_at: 'asc' },
      ...(options?.skip !== undefined ? { skip: options.skip } : {}),
      ...(options?.take !== undefined ? { take: options.take } : {}),
    } satisfies Prisma.users_honorsFindManyArgs;

    const records = await this.prisma.users_honors.findMany(query);

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
        member_is_deleted: isDeletedAccountSnapshot(r.users),
        member_id: r.user_id,
        entity_name: r.honors?.name ?? `Especialidad #${r.honor_id}`,
        section_name: r.honors?.name ?? `Especialidad #${r.honor_id}`,
        entity_description: r.honors?.description ?? null,
        module_name: null,
        file_count: fileCount,
        submitted_at: r.submitted_at,
        validated_at: r.validated_at,
        rejection_reason: r.rejection_reason,
      };
    });
  }

  private async resolveClassCatalogs(
    records: Array<{ section_id: number; module_id: number }>,
  ): Promise<{
    sectionsById: Map<
      number,
      { section_id: number; name: string; description: string | null }
    >;
    modulesById: Map<number, { module_id: number; name: string }>;
  }> {
    if (records.length === 0) {
      return { sectionsById: new Map(), modulesById: new Map() };
    }

    const sectionIds = [...new Set(records.map((record) => record.section_id))];
    const moduleIds = [...new Set(records.map((record) => record.module_id))];
    const [sections, modules] = await Promise.all([
      this.prisma.class_sections.findMany({
        where: { section_id: { in: sectionIds } },
        select: { section_id: true, name: true, description: true },
      }),
      this.prisma.class_modules.findMany({
        where: { module_id: { in: moduleIds } },
        select: { module_id: true, name: true },
      }),
    ]);

    return {
      sectionsById: new Map(
        sections.map((section) => [section.section_id, section]),
      ),
      modulesById: new Map(modules.map((module) => [module.module_id, module])),
    };
  }

  private buildClassPendingWhere(
    scopedClubSectionIds?: number[],
  ): Prisma.class_section_progressWhereInput {
    return {
      status: CLASS_STATUS_SUBMITTED,
      active: true,
      submitted_at: { not: null },
      ...this.buildUserSectionScopeWhere(scopedClubSectionIds),
    };
  }

  private buildHonorPendingWhere(
    scopedClubSectionIds?: number[],
  ): Prisma.users_honorsWhereInput {
    return {
      validation_status: HONOR_STATUS_PENDING,
      active: true,
      submitted_at: { not: null },
      ...this.buildUserSectionScopeWhere(scopedClubSectionIds),
    };
  }

  private async getCombinedPendingIdentifiers(
    scopedClubSectionIds: number[] | undefined,
    skip: number,
    limit: number,
  ): Promise<PendingIdentifierRow[]> {
    if (scopedClubSectionIds?.length === 0) return [];

    const classScopeFilter = this.buildScopeExistsFilter(
      scopedClubSectionIds,
      'csp',
    );
    const honorScopeFilter = this.buildScopeExistsFilter(
      scopedClubSectionIds,
      'uh',
    );

    const rows = await this.prisma.$queryRawUnsafe<PendingIdentifierRow[]>(`
      SELECT
        ids.id,
        ids.item_type,
        ids.submitted_at,
        COUNT(*) OVER () AS total_count
      FROM (
        SELECT
          csp.section_progress_id AS id,
          'class'::text AS item_type,
          csp.submitted_at AS submitted_at
        FROM class_section_progress csp
        WHERE csp.status = '${CLASS_STATUS_SUBMITTED}'
          AND csp.active = true
          AND csp.submitted_at IS NOT NULL
          ${classScopeFilter}
        UNION ALL
        SELECT
          uh.user_honor_id AS id,
          'honor'::text AS item_type,
          uh.submitted_at AS submitted_at
        FROM users_honors uh
        WHERE uh.validation_status = '${HONOR_STATUS_PENDING}'
          AND uh.active = true
          AND uh.submitted_at IS NOT NULL
          ${honorScopeFilter}
      ) AS ids
      ORDER BY
        ids.submitted_at ASC,
        CASE WHEN ids.item_type = 'class' THEN 0 ELSE 1 END,
        ids.id ASC
      LIMIT ${Math.trunc(limit)}
      OFFSET ${Math.trunc(skip)};
    `);

    return rows;
  }

  private async getCombinedPendingCount(
    scopedClubSectionIds?: number[],
  ): Promise<number> {
    const [classCount, honorCount] = await Promise.all([
      this.prisma.class_section_progress.count({
        where: this.buildClassPendingWhere(scopedClubSectionIds),
      }),
      this.prisma.users_honors.count({
        where: this.buildHonorPendingWhere(scopedClubSectionIds),
      }),
    ]);

    return classCount + honorCount;
  }

  private buildScopeExistsFilter(
    scopedClubSectionIds: number[] | undefined,
    tableAlias: 'csp' | 'uh',
  ): string {
    if (scopedClubSectionIds === undefined) return '';

    const normalizedClubSectionIds = scopedClubSectionIds
      .map((id) => Math.trunc(id))
      .filter((id) => Number.isFinite(id));

    if (normalizedClubSectionIds.length === 0) return '';

    return `
      AND EXISTS (
        SELECT 1
        FROM club_role_assignments cra
        WHERE cra.user_id = ${tableAlias}.user_id
          AND cra.active = true
          AND cra.status = 'active'
          AND cra.club_section_id IN (${normalizedClubSectionIds.join(',')})
      )
    `;
  }

  // ============================================================
  // GET /evidence-review/:type/:id  (detail with files)
  // ============================================================

  async getDetail(
    actorId: string,
    type: EvidenceType,
    id: number,
  ): Promise<EvidenceDetail> {
    const scopedClubSectionIds =
      await this.resolveCoordinatorSectionScope(actorId);

    switch (type) {
      case 'class':
        return this.getClassDetail(id, scopedClubSectionIds);
      case 'honor':
        return this.getHonorDetail(id, scopedClubSectionIds);
      default:
        throw new AppBadRequestException(
          ErrorCode.EVIDENCE_REVIEW_TYPE_INVALID,
          { type },
        );
    }
  }

  private async getClassDetail(
    id: number,
    scopedClubSectionIds?: number[],
  ): Promise<EvidenceDetail> {
    if (scopedClubSectionIds?.length === 0) {
      throw new AppNotFoundException(
        ErrorCode.EVIDENCE_REVIEW_CLASS_RECORD_NOT_FOUND,
        { id },
      );
    }

    const record = await this.prisma.class_section_progress.findFirst({
      where: {
        section_progress_id: id,
        ...this.buildUserSectionScopeWhere(scopedClubSectionIds),
      },
      include: {
        users: {
          select: USER_NAME_SELECT,
        },
        classes: {
          select: { name: true, description: true },
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

    const { sectionsById, modulesById } = await this.resolveClassCatalogs([
      record,
    ]);
    const section = sectionsById.get(record.section_id);
    const module = modulesById.get(record.module_id);

    const files = await Promise.all(
      record.evidence_files.map(async (f) => ({
        evidence_file_id: f.evidence_file_id,
        file_url: await this.resolveEvidenceFileUrl(
          f.evidence_file_id,
          StorageBucketAlias.CLASS_EVIDENCE,
          f.file_url,
        ),
        file_name: f.file_name,
        file_type: f.file_type,
        uploaded_at: f.uploaded_at,
      })),
    );

    return {
      id: record.section_progress_id,
      type: 'class',
      status: record.status,
      member_name: buildMemberName(record.users),
      member_is_deleted: isDeletedAccountSnapshot(record.users),
      member_id: record.user_id,
      entity_name: record.classes?.name ?? `Clase #${record.class_id}`,
      section_name: section?.name ?? `Sección #${record.section_id}`,
      entity_description: section?.description ?? null,
      module_name: module?.name ?? null,
      file_count: record.evidence_files.length,
      submitted_at: record.submitted_at,
      validated_at: record.validated_at,
      rejection_reason: record.rejection_reason,
      files,
      validated_by_name: record.validated_by_user
        ? buildMemberName(record.validated_by_user)
        : null,
    };
  }

  private async getHonorDetail(
    id: number,
    scopedClubSectionIds?: number[],
  ): Promise<EvidenceDetail> {
    if (scopedClubSectionIds?.length === 0) {
      throw new AppNotFoundException(
        ErrorCode.EVIDENCE_REVIEW_USER_HONOR_NOT_FOUND,
        { id },
      );
    }

    const record = await this.prisma.users_honors.findFirst({
      where: {
        user_honor_id: id,
        ...this.buildUserSectionScopeWhere(scopedClubSectionIds),
      },
      include: {
        users: {
          select: USER_NAME_SELECT,
        },
        honors: {
          select: { honor_id: true, name: true, description: true },
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
      ...(honorReviewPacket.completed_format_file
        ? [honorReviewPacket.completed_format_file]
        : []),
      ...honorReviewPacket.general_files,
      ...honorReviewPacket.requirement_files,
    ]);

    return {
      id: record.user_honor_id,
      type: 'honor',
      status: record.validation_status,
      member_name: buildMemberName(record.users),
      member_is_deleted: isDeletedAccountSnapshot(record.users),
      member_id: record.user_id,
      entity_name: record.honors?.name ?? `Especialidad #${record.honor_id}`,
      section_name: record.honors?.name ?? `Especialidad #${record.honor_id}`,
      entity_description: record.honors?.description ?? null,
      module_name: null,
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
    completion_mode?: string | null;
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

    const requirementsPacket: HonorRequirementReviewItem[] = await Promise.all(
      requirements.map(async (requirement) => {
        const progress = progressByRequirement.get(requirement.requirement_id);
        const evidences = await Promise.all(
          (progress?.requirement_evidence ?? []).map((evidence, index) =>
            this.mapRequirementEvidenceFile(
              evidence,
              requirement.requirement_id,
              index,
            ),
          ),
        );

        return {
          requirement_id: requirement.requirement_id,
          requirement_number: String(requirement.requirement_number),
          display_label: requirement.display_label,
          requirement_text: requirement.requirement_text,
          requires_evidence: requirement.requires_evidence,
          completed: progress?.completed ?? false,
          text_response: progress?.text_response ?? null,
          completed_at: progress?.completed_at ?? null,
          evidence_count: evidences.length,
          evidences,
        };
      }),
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

    const normalizedFiles = await Promise.all(
      record.evidence_files.map((file) =>
        this.mapStoredHonorEvidenceFile(file),
      ),
    );
    const completedFormatFile = await this.buildCompletedFormatFile(record);
    const legacyFiles = await this.buildLegacyHonorFiles(record);
    const generalFiles = this.dedupeFiles([...normalizedFiles, ...legacyFiles]);
    const requirementFiles = this.dedupeFiles(
      requirementsPacket.flatMap((requirement) => requirement.evidences),
    );

    return {
      user_honor_id: record.user_honor_id,
      honor_id: record.honor_id,
      honor_name: record.honors?.name ?? `Especialidad #${record.honor_id}`,
      validation_status: record.validation_status,
      completion_mode: record.completion_mode ?? 'UNDECIDED',
      progress: {
        total_requirements: totalRequirements,
        completed_count: completedCount,
        progress_percentage:
          totalRequirements === 0
            ? 0
            : Math.round((completedCount / totalRequirements) * 10000) / 100,
      },
      completed_format_file: completedFormatFile,
      general_files: generalFiles,
      requirement_files: requirementFiles,
      requirements: requirementsPacket,
    };
  }

  private async buildCompletedFormatFile(record: {
    document?: unknown;
    created_at?: Date | null;
  }): Promise<EvidenceFile | null> {
    if (typeof record.document !== 'string' || record.document.length === 0) {
      return null;
    }

    const signedUrl = await this.resolveEvidenceFileUrl(
      -2,
      StorageBucketAlias.USERS_HONORS,
      record.document,
    );

    return this.buildSyntheticFile(
      -2,
      signedUrl,
      record.created_at ?? new Date(0),
      'formato-completado',
      record.document,
    );
  }

  private async buildLegacyHonorFiles(record: {
    certificate?: string | null;
    images?: unknown;
    created_at?: Date | null;
  }): Promise<EvidenceFile[]> {
    const uploadedAt = record.created_at ?? new Date(0);
    const files: EvidenceFile[] = [];

    if (record.certificate) {
      const signedCertificateUrl = await this.resolveEvidenceFileUrl(
        -1,
        StorageBucketAlias.USERS_HONORS_CERT,
        record.certificate,
      );
      files.push(
        this.buildSyntheticFile(
          -1,
          signedCertificateUrl,
          uploadedAt,
          'certificado',
          record.certificate,
        ),
      );
    }

    const images = Array.isArray(record.images)
      ? (record.images as unknown[])
      : [];
    const imageFiles = await Promise.all(
      images.map(async (image, index) => {
        const url =
          typeof image === 'string'
            ? image
            : ((image as { url?: string }).url ?? '');
        if (url.length === 0) return null;
        const signedImageUrl = await this.resolveEvidenceFileUrl(
          -1000 - index,
          StorageBucketAlias.USERS_HONORS,
          url,
        );
        return this.buildSyntheticFile(
          -1000 - index,
          signedImageUrl,
          uploadedAt,
          `imagen-${index + 1}`,
          url,
        );
      }),
    );

    files.push(
      ...imageFiles.filter((file): file is EvidenceFile => file !== null),
    );

    return files;
  }

  private async mapStoredHonorEvidenceFile(file: {
    evidence_file_id: number;
    file_url: string;
    file_name: string;
    file_type: string;
    uploaded_at: Date;
  }): Promise<EvidenceFile> {
    return {
      evidence_file_id: file.evidence_file_id,
      file_url: await this.resolveEvidenceFileUrl(
        file.evidence_file_id,
        StorageBucketAlias.EVIDENCE_FILES,
        file.file_url,
      ),
      file_name: file.file_name,
      file_type: file.file_type,
      uploaded_at: file.uploaded_at,
    };
  }

  private async mapRequirementEvidenceFile(
    evidence: {
      evidence_id: number;
      evidence_type?: string | null;
      url: string;
      filename: string | null;
      mime_type: string | null;
      created_at: Date;
    },
    requirementId: number,
    index: number,
  ): Promise<EvidenceFile> {
    const fallbackName = `requisito-${requirementId}-evidencia-${index + 1}`;
    const fileName =
      evidence.filename ?? this.fileNameFromUrl(evidence.url) ?? fallbackName;
    const fileUrl =
      evidence.evidence_type === 'LINK'
        ? evidence.url
        : await this.resolveEvidenceFileUrl(
            -100000 - evidence.evidence_id,
            StorageBucketAlias.EVIDENCE_FILES,
            evidence.url,
          );

    return {
      evidence_file_id: -100000 - evidence.evidence_id,
      file_url: fileUrl,
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
    originalUrl = url,
  ): EvidenceFile {
    const fileName = this.fileNameFromUrl(originalUrl) ?? fallbackName;
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

  private async resolveEvidenceFileUrl(
    evidenceFileId: number,
    bucketAlias: StorageBucketAlias,
    fileUrl: string,
  ): Promise<string> {
    try {
      return await this.fileStorage.getSignedDownloadUrl(bucketAlias, fileUrl, {
        expiresInSeconds: EvidenceReviewService.SIGNED_FILE_URL_TTL_SECONDS,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to presign evidence URL for evidenceFileId=${evidenceFileId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return fileUrl;
    }
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
    await this.assertEvidenceInScope(actorId, type, id);

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
    await this.assertEvidenceInScope(actorId, type, id);

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

  async getHistory(
    actorId: string,
    type: EvidenceType,
    id: number,
  ): Promise<HistoryEntry[]> {
    const validTypes: EvidenceType[] = ['class', 'honor'];
    if (!validTypes.includes(type)) {
      throw new AppBadRequestException(ErrorCode.EVIDENCE_REVIEW_TYPE_INVALID, {
        type,
      });
    }

    await this.assertEvidenceInScope(actorId, type, id);

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

  private async resolveCoordinatorSectionScope(
    actorId: string,
  ): Promise<number[] | undefined> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(actorId);
    const roleNames = resolved.authorization.grants.global_roles.map((grant) =>
      grant.role_name.toLowerCase(),
    );

    const isAdmin = roleNames.some((roleName) =>
      ['admin', 'assistant-admin', 'super-admin'].includes(roleName),
    );

    if (isAdmin) {
      return undefined;
    }

    const isCoordinator = roleNames.some((roleName) =>
      ['coordinator', 'zone-coordinator', 'general-coordinator'].includes(
        roleName,
      ),
    );

    if (!isCoordinator) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }

    return this.coordinationService.getEffectiveCoordinatorSectionIds(actorId);
  }

  private buildUserSectionScopeWhere(
    scopedClubSectionIds?: number[],
  ):
    | Pick<Prisma.class_section_progressWhereInput, 'users'>
    | Pick<Prisma.users_honorsWhereInput, 'users'> {
    if (scopedClubSectionIds === undefined) return {};

    return {
      users: {
        club_role_assignments: {
          some: {
            club_section_id: { in: scopedClubSectionIds },
            active: true,
            status: 'active',
          },
        },
      },
    };
  }

  private async assertEvidenceInScope(
    actorId: string,
    type: EvidenceType,
    id: number,
  ): Promise<void> {
    const scopedClubSectionIds =
      await this.resolveCoordinatorSectionScope(actorId);

    if (scopedClubSectionIds === undefined) return;

    if (scopedClubSectionIds.length === 0) {
      this.throwEvidenceNotFound(type, id);
    }

    const where = this.buildUserSectionScopeWhere(scopedClubSectionIds);
    const count =
      type === 'class'
        ? await this.prisma.class_section_progress.count({
            where: { section_progress_id: id, ...where },
          })
        : await this.prisma.users_honors.count({
            where: { user_honor_id: id, ...where },
          });

    if (count === 0) {
      this.throwEvidenceNotFound(type, id);
    }
  }

  private throwEvidenceNotFound(type: EvidenceType, id: number): never {
    if (type === 'class') {
      throw new AppNotFoundException(
        ErrorCode.EVIDENCE_REVIEW_CLASS_RECORD_NOT_FOUND,
        { id },
      );
    }

    if (type === 'honor') {
      throw new AppNotFoundException(
        ErrorCode.EVIDENCE_REVIEW_USER_HONOR_NOT_FOUND,
        { id },
      );
    }

    throw new AppBadRequestException(ErrorCode.EVIDENCE_REVIEW_TYPE_INVALID, {
      type,
    });
  }
}

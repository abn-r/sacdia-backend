import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import {
  Prisma,
  evidence_validation_enum,
  honor_validation_status_enum,
} from '@prisma/client';
import { ErrorCode } from '../common/errors/error-codes';
import { assertEnrollmentNotTerminalInTransaction } from '../classes/class-progress-mutable';
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
  instructorUserSelectNoPhoto,
  toInstructorView,
  type InstructorView,
} from '../instructors/instructor-view';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import { isDeletedAccountSnapshot } from '../common/utils/deleted-account';
import { CoordinationService } from '../coordination/coordination.service';
import {
  assertNoPendingInvestitureAuthorization,
  lockInvestitureAuthorizationEnrollment,
} from '../investiture-requests/investiture-request-lock';

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
  /** Signed profile photo URL; null when the member has none or was deleted. */
  member_photo_url: string | null;
  entity_name: string;
  /**
   * Class curriculum section (class evidence) or honor name (honor evidence).
   * NOT the member's club section — see `club_section_name`.
   */
  section_name: string;
  entity_description: string | null;
  module_name: string | null;
  file_count: number;
  submitted_at: Date | null;
  validated_at: Date | null;
  rejection_reason: string | null;
} & MemberClubSection;

/** Club section where the member holds an active assignment (within scope). */
export type MemberClubSection = {
  club_section_id: number | null;
  club_name: string | null;
  /** Club type of the section (e.g. "Conquistadores"). */
  club_section_name: string | null;
};

const NO_CLUB_SECTION: MemberClubSection = {
  club_section_id: null,
  club_name: null,
  club_section_name: null,
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
  /** Solo `honor`. Instructor declarado (sin foto ni email); `null` = sin instructor. */
  instructor?: InstructorView | null;
  /** Solo `honor`. Fecha de finalización declarada por el miembro (yyyy-mm-dd). */
  completed_at?: Date | null;
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

// ─── Honor evidence files ─────────────────────────────────────────────────────
//
// A honor's files come from several stores that can hold the same object:
// `document`, `certificate`, the legacy `images` JSON (still the upload target),
// `evidence_files` (rows copied from `images` by the 20260327100000 migration and
// by certificate bulk imports) and per-requirement `requirement_evidence`.
// The list count and the detail file list must use the same set, deduped by the
// stored reference: signed URLs differ per bucket, so they cannot be the key.

/** Dedupe key of a stored file reference (URL or key), query/fragment ignored. */
function evidenceSourceKey(url: string): string {
  return url.trim().split(/[?#]/)[0];
}

/** URL of one legacy `users_honors.images` element (string or `{ url }`). */
function legacyHonorImageUrl(image: unknown): string {
  if (typeof image === 'string') return image;
  if (image && typeof image === 'object') {
    const url = (image as { url?: unknown }).url;
    return typeof url === 'string' ? url : '';
  }
  return '';
}

/** Stored reference each built EvidenceFile came from (see dedupeFiles). */
const fileSourceKeys = new WeakMap<EvidenceFile, string>();

type HonorFileSources = {
  honor_id: number;
  document?: unknown;
  certificate?: string | null;
  images?: unknown;
  evidence_files: Array<{ file_url: string }>;
  user_honor_requirement_progress: Array<{
    honor_requirements: { honor_id: number } | null;
    requirement_evidence: Array<{ url: string }>;
  }>;
};

/**
 * Number of distinct files the honor detail returns in `files` (completed
 * format + certificate + images + evidence_files + requirement evidence of
 * the honor's active requirements), without presigning anything.
 */
export function countHonorEvidenceFiles(record: HonorFileSources): number {
  const refs: string[] = [];
  if (typeof record.document === 'string' && record.document.length > 0) {
    refs.push(record.document);
  }
  if (record.certificate) refs.push(record.certificate);
  if (Array.isArray(record.images)) {
    for (const image of record.images as unknown[]) {
      const url = legacyHonorImageUrl(image);
      if (url.length > 0) refs.push(url);
    }
  }
  for (const file of record.evidence_files) refs.push(file.file_url);
  for (const progress of record.user_honor_requirement_progress) {
    if (progress.honor_requirements?.honor_id !== record.honor_id) continue;
    for (const evidence of progress.requirement_evidence) {
      refs.push(evidence.url);
    }
  }
  return new Set(refs.map(evidenceSourceKey)).size;
}

// ─── User select shape reused across queries ──────────────────────────────────

const USER_NAME_SELECT = {
  user_id: true,
  name: true,
  paternal_last_name: true,
  active: true,
  email: true,
  user_image: true,
} as const;

@Injectable()
export class EvidenceReviewService {
  private readonly logger = new Logger(EvidenceReviewService.name);
  private static readonly SIGNED_FILE_URL_TTL_SECONDS = 300;

  constructor(
    private readonly prisma: PrismaService,
    private readonly honorValidationWorkflow: HonorValidationWorkflowService,
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

    const [identifiers, total] = await Promise.all([
      this.getCombinedPendingIdentifiers(scopedClubSectionIds, skip, limit),
      this.getCombinedPendingCount(scopedClubSectionIds),
    ]);

    if (identifiers.length === 0) {
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
      total,
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
    const [{ sectionsById, modulesById }, clubSectionsByUser] =
      await Promise.all([
        this.resolveClassCatalogs(records),
        this.resolveMemberClubSections(
          records.map((r) => r.user_id),
          scopedClubSectionIds,
        ),
      ]);

    const photosByUser = await this.resolveMemberPhotoUrls(
      records.map((r) => r.users),
    );

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
        member_photo_url: photosByUser.get(r.user_id) ?? null,
        entity_name: r.classes?.name ?? `Clase #${r.class_id}`,
        section_name: section?.name ?? `Sección #${r.section_id}`,
        entity_description: section?.description ?? null,
        module_name: module?.name ?? null,
        file_count: r.evidence_files.length,
        submitted_at: r.submitted_at,
        validated_at: r.validated_at,
        rejection_reason: r.rejection_reason,
        ...(clubSectionsByUser.get(r.user_id) ?? NO_CLUB_SECTION),
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
        // Same sources as the detail, so file_count matches its `files`.
        evidence_files: {
          where: { active: true },
          select: { file_url: true },
        },
        user_honor_requirement_progress: {
          where: { active: true, honor_requirements: { active: true } },
          select: {
            honor_requirements: { select: { honor_id: true } },
            requirement_evidence: {
              where: { active: true },
              select: { url: true },
            },
          },
        },
      },
      orderBy: { submitted_at: 'asc' },
      ...(options?.skip !== undefined ? { skip: options.skip } : {}),
      ...(options?.take !== undefined ? { take: options.take } : {}),
    } satisfies Prisma.users_honorsFindManyArgs;

    const records = await this.prisma.users_honors.findMany(query);
    const clubSectionsByUser = await this.resolveMemberClubSections(
      records.map((r) => r.user_id),
      scopedClubSectionIds,
    );

    const photosByUser = await this.resolveMemberPhotoUrls(
      records.map((r) => r.users),
    );

    return records.map((r) => {
      const fileCount = countHonorEvidenceFiles(r);

      return {
        id: r.user_honor_id,
        type: 'honor',
        status: r.validation_status,
        member_name: buildMemberName(r.users),
        member_is_deleted: isDeletedAccountSnapshot(r.users),
        member_id: r.user_id,
        member_photo_url: photosByUser.get(r.user_id) ?? null,
        entity_name: r.honors?.name ?? `Especialidad #${r.honor_id}`,
        section_name: r.honors?.name ?? `Especialidad #${r.honor_id}`,
        entity_description: r.honors?.description ?? null,
        module_name: null,
        file_count: fileCount,
        submitted_at: r.submitted_at,
        validated_at: r.validated_at,
        rejection_reason: r.rejection_reason,
        ...(clubSectionsByUser.get(r.user_id) ?? NO_CLUB_SECTION),
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
        ids.submitted_at
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

    const [{ sectionsById, modulesById }, clubSectionsByUser] =
      await Promise.all([
        this.resolveClassCatalogs([record]),
        this.resolveMemberClubSections([record.user_id], scopedClubSectionIds),
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
      member_photo_url: await this.resolveMemberPhotoUrl(record.users),
      entity_name: record.classes?.name ?? `Clase #${record.class_id}`,
      section_name: section?.name ?? `Sección #${record.section_id}`,
      entity_description: section?.description ?? null,
      module_name: module?.name ?? null,
      file_count: record.evidence_files.length,
      submitted_at: record.submitted_at,
      validated_at: record.validated_at,
      rejection_reason: record.rejection_reason,
      ...(clubSectionsByUser.get(record.user_id) ?? NO_CLUB_SECTION),
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
        instructor: { select: instructorUserSelectNoPhoto },
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

    const [honorReviewPacket, clubSectionsByUser] = await Promise.all([
      this.buildHonorReviewPacket(record),
      this.resolveMemberClubSections([record.user_id], scopedClubSectionIds),
    ]);
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
      member_photo_url: await this.resolveMemberPhotoUrl(record.users),
      entity_name: record.honors?.name ?? `Especialidad #${record.honor_id}`,
      section_name: record.honors?.name ?? `Especialidad #${record.honor_id}`,
      entity_description: record.honors?.description ?? null,
      module_name: null,
      file_count: files.length,
      submitted_at: record.submitted_at,
      validated_at: record.validated_at,
      rejection_reason: record.rejection_reason,
      ...(clubSectionsByUser.get(record.user_id) ?? NO_CLUB_SECTION),
      files,
      validated_by_name: record.validator
        ? buildMemberName(record.validator)
        : null,
      honor_review_packet: honorReviewPacket,
      instructor: toInstructorView(record),
      completed_at: record.completed_at,
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
    // Legacy entries first: an `evidence_files` row that duplicates an image
    // was copied from `images`, whose bucket (USERS_HONORS) signs it correctly.
    const generalFiles = this.dedupeFiles([...legacyFiles, ...normalizedFiles]);
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
        const url = legacyHonorImageUrl(image);
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
    return this.withSourceKey(
      {
        evidence_file_id: file.evidence_file_id,
        file_url: await this.resolveEvidenceFileUrl(
          file.evidence_file_id,
          StorageBucketAlias.EVIDENCE_FILES,
          file.file_url,
        ),
        file_name: file.file_name,
        file_type: file.file_type,
        uploaded_at: file.uploaded_at,
      },
      file.file_url,
    );
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

    return this.withSourceKey(
      {
        evidence_file_id: -100000 - evidence.evidence_id,
        file_url: fileUrl,
        file_name: fileName,
        file_type: this.inferFileType(
          fileName,
          evidence.url,
          evidence.mime_type,
        ),
        uploaded_at: evidence.created_at,
      },
      evidence.url,
    );
  }

  private buildSyntheticFile(
    evidenceFileId: number,
    url: string,
    uploadedAt: Date,
    fallbackName: string,
    originalUrl = url,
  ): EvidenceFile {
    const fileName = this.fileNameFromUrl(originalUrl) ?? fallbackName;
    return this.withSourceKey(
      {
        evidence_file_id: evidenceFileId,
        file_url: url,
        file_name: fileName,
        file_type: this.inferFileType(fileName, url),
        uploaded_at: uploadedAt,
      },
      originalUrl,
    );
  }

  private withSourceKey(file: EvidenceFile, storedRef: string): EvidenceFile {
    fileSourceKeys.set(file, evidenceSourceKey(storedRef));
    return file;
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

  /**
   * Signed URL of a member's profile photo (private USER_PROFILES bucket).
   * Deleted accounts and members without a photo resolve to null.
   */
  private async resolveMemberPhotoUrl(
    user: {
      user_id: string;
      user_image: string | null;
      active?: boolean | null;
      email?: string | null;
      name?: string | null;
      paternal_last_name?: string | null;
    } | null,
  ): Promise<string | null> {
    if (!user?.user_image || isDeletedAccountSnapshot(user)) return null;
    try {
      return await this.fileStorage.getSignedDownloadUrl(
        StorageBucketAlias.USER_PROFILES,
        user.user_image,
        { expiresInSeconds: EvidenceReviewService.SIGNED_FILE_URL_TTL_SECONDS },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to presign profile photo for userId=${user.user_id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return user.user_image;
    }
  }

  /** One signed photo URL per distinct member (the queue repeats members). */
  private async resolveMemberPhotoUrls(
    users: Array<Parameters<EvidenceReviewService['resolveMemberPhotoUrl']>[0]>,
  ): Promise<Map<string, string | null>> {
    const unique = new Map<string, (typeof users)[number]>();
    for (const user of users) {
      if (user) unique.set(user.user_id, user);
    }
    const entries = await Promise.all(
      [...unique.entries()].map(
        async ([userId, user]) =>
          [userId, await this.resolveMemberPhotoUrl(user)] as const,
      ),
    );
    return new Map(entries);
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
      const key = fileSourceKeys.get(file) ?? file.file_url;
      if (seen.has(key)) continue;
      seen.add(key);
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
      await this.lockClassProgress(tx, record.enrollment_id);
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
      await this.lockClassProgress(tx, record.enrollment_id);
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
    return this.coordinationService.resolveCoordinatorLikeSectionScope(actorId);
  }

  /**
   * Club section per member, from the same active assignments that put the
   * evidence in the reviewer's scope. Latest assignment wins when a member
   * holds several.
   */
  private async resolveMemberClubSections(
    userIds: string[],
    scopedClubSectionIds?: number[],
  ): Promise<Map<string, MemberClubSection>> {
    const uniqueUserIds = [...new Set(userIds)];
    if (uniqueUserIds.length === 0 || scopedClubSectionIds?.length === 0) {
      return new Map();
    }

    const assignments = await this.prisma.club_role_assignments.findMany({
      where: {
        user_id: { in: uniqueUserIds },
        active: true,
        status: 'active',
        club_section_id:
          scopedClubSectionIds === undefined
            ? { not: null }
            : { in: scopedClubSectionIds },
      },
      orderBy: { start_date: 'desc' },
      select: {
        user_id: true,
        club_section_id: true,
        club_sections: {
          select: {
            club_types: { select: { name: true } },
            clubs: { select: { name: true } },
          },
        },
      },
    });

    const byUser = new Map<string, MemberClubSection>();
    for (const assignment of assignments) {
      if (byUser.has(assignment.user_id)) continue;
      byUser.set(assignment.user_id, {
        club_section_id: assignment.club_section_id,
        club_name: assignment.club_sections?.clubs?.name ?? null,
        club_section_name: assignment.club_sections?.club_types?.name ?? null,
      });
    }
    return byUser;
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

  private async lockClassProgress(
    store: Prisma.TransactionClient,
    enrollmentId: number | null,
  ): Promise<void> {
    if (enrollmentId === null) {
      return;
    }
    await lockInvestitureAuthorizationEnrollment(store, enrollmentId);
    await assertNoPendingInvestitureAuthorization(store, enrollmentId);
    // BC-11 / BCR-2: solo INVESTIDO y EXPIRED; bajo el candado, en la misma
    // transacción que escribe. Los estados del flujo anterior y
    // locked_for_validation no bloquean (igual que en 113d8ba).
    await assertEnrollmentNotTerminalInTransaction(store, enrollmentId);
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

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApproveEvidenceDto } from './dto/approve-evidence.dto';
import { RejectEvidenceDto } from './dto/reject-evidence.dto';
import { BulkApproveEvidenceDto, EvidenceType } from './dto/bulk-approve-evidence.dto';
import { BulkRejectEvidenceDto } from './dto/bulk-reject-evidence.dto';

// ─── Status constants ─────────────────────────────────────────────────────────

const FOLDER_STATUS_PENDING = 'pendiente';
const FOLDER_STATUS_VALIDATED = 'validado';
const FOLDER_STATUS_REJECTED = 'rechazado';

const CLASS_STATUS_PENDING = 'pendiente';
const CLASS_STATUS_VALIDATED = 'validado';
const CLASS_STATUS_REJECTED = 'rechazado';

const HONOR_STATUS_PENDING = 'in_progress';
const HONOR_STATUS_VALIDATED = 'validated';
const HONOR_STATUS_REJECTED = 'rejected';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildMemberName(user: { name?: string | null; paternal_last_name?: string | null } | null): string {
  if (!user) return 'Miembro desconocido';
  return [user.name, user.paternal_last_name].filter(Boolean).join(' ') || 'Miembro desconocido';
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
  private readonly logger = new Logger(EvidenceReviewService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ============================================================
  // GET /evidence-review/pending
  // ============================================================

  async getPending(
    type?: EvidenceType,
    page = 1,
    limit = 20,
  ): Promise<{ data: EvidenceItem[]; total: number; page: number; limit: number }> {
    const skip = (page - 1) * limit;

    const [folderItems, classItems, honorItems] = await Promise.all([
      (!type || type === 'folder') ? this.getFolderPending() : Promise.resolve([]),
      (!type || type === 'class') ? this.getClassPending() : Promise.resolve([]),
      (!type || type === 'honor') ? this.getHonorPending() : Promise.resolve([]),
    ]);

    const all: EvidenceItem[] = [
      ...folderItems,
      ...classItems,
      ...honorItems,
    ].sort((a, b) => {
      const aDate = a.submitted_at?.getTime() ?? 0;
      const bDate = b.submitted_at?.getTime() ?? 0;
      return aDate - bDate;
    });

    const total = all.length;
    const data = all.slice(skip, skip + limit);

    return { data, total, page, limit };
  }

  private async getFolderPending(): Promise<EvidenceItem[]> {
    const records = await this.prisma.folders_section_records.findMany({
      where: {
        status: FOLDER_STATUS_PENDING,
        active: true,
        submitted_at: { not: null },
      },
      include: {
        submitted_by: {
          select: USER_NAME_SELECT,
        },
        folders_sections: {
          select: { name: true },
        },
        evidence_files: {
          where: { active: true },
          select: { evidence_file_id: true },
        },
      },
      orderBy: { submitted_at: 'asc' },
    });

    return records.map((r) => ({
      id: r.folder_section_record_id,
      type: 'folder' as EvidenceType,
      status: r.status ?? FOLDER_STATUS_PENDING,
      member_name: buildMemberName(r.submitted_by),
      member_id: r.submitted_by?.user_id ?? r.submitted_by_id ?? '',
      section_name: r.folders_sections?.name ?? `Sección #${r.section_id}`,
      file_count: r.evidence_files.length,
      submitted_at: r.submitted_at,
      validated_at: r.validated_at,
      rejection_reason: r.rejection_reason ?? null,
    }));
  }

  private async getClassPending(): Promise<EvidenceItem[]> {
    const records = await this.prisma.class_section_progress.findMany({
      where: {
        status: CLASS_STATUS_PENDING,
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
      type: 'class' as EvidenceType,
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
      },
      orderBy: { submitted_at: 'asc' },
    });

    return records.map((r) => ({
      id: r.user_honor_id,
      type: 'honor' as EvidenceType,
      status: r.validation_status,
      member_name: buildMemberName(r.users),
      member_id: r.user_id,
      section_name: r.honors?.name ?? `Honor #${r.honor_id}`,
      file_count: Array.isArray(r.images) ? (r.images as unknown[]).length : 0,
      submitted_at: r.submitted_at,
      validated_at: r.validated_at,
      rejection_reason: r.rejection_reason,
    }));
  }

  // ============================================================
  // GET /evidence-review/:type/:id  (detail with files)
  // ============================================================

  async getDetail(type: EvidenceType, id: number): Promise<EvidenceDetail> {
    switch (type) {
      case 'folder':
        return this.getFolderDetail(id);
      case 'class':
        return this.getClassDetail(id);
      case 'honor':
        return this.getHonorDetail(id);
    }
  }

  private async getFolderDetail(id: number): Promise<EvidenceDetail> {
    const record = await this.prisma.folders_section_records.findUnique({
      where: { folder_section_record_id: id },
      include: {
        submitted_by: {
          select: USER_NAME_SELECT,
        },
        folders_sections: {
          select: { name: true },
        },
        evidence_files: {
          where: { active: true },
          orderBy: { uploaded_at: 'asc' },
        },
        validated_by: {
          select: { name: true, paternal_last_name: true },
        },
      },
    });

    if (!record) {
      throw new NotFoundException(`Registro de carpeta #${id} no encontrado`);
    }

    return {
      id: record.folder_section_record_id,
      type: 'folder',
      status: record.status ?? FOLDER_STATUS_PENDING,
      member_name: buildMemberName(record.submitted_by),
      member_id: record.submitted_by?.user_id ?? record.submitted_by_id ?? '',
      section_name: record.folders_sections?.name ?? `Sección #${record.section_id}`,
      file_count: record.evidence_files.length,
      submitted_at: record.submitted_at,
      validated_at: record.validated_at,
      rejection_reason: record.rejection_reason ?? null,
      files: record.evidence_files.map((f) => ({
        evidence_file_id: f.evidence_file_id,
        file_url: f.file_url,
        file_name: f.file_name,
        file_type: f.file_type,
        uploaded_at: f.uploaded_at,
      })),
      validated_by_name: record.validated_by ? buildMemberName(record.validated_by) : null,
    };
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
      throw new NotFoundException(`Progreso de sección de clase #${id} no encontrado`);
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
      validated_by_name: record.validated_by_user ? buildMemberName(record.validated_by_user) : null,
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
      },
    });

    if (!record) {
      throw new NotFoundException(`Honor de usuario #${id} no encontrado`);
    }

    // Images for honors are stored as JSON array in users_honors.images
    const images = Array.isArray(record.images) ? (record.images as unknown[]) : [];
    const files: EvidenceFile[] = images.map((img, idx) => {
      const url = typeof img === 'string' ? img : (img as { url?: string }).url ?? '';
      return {
        evidence_file_id: idx + 1,
        file_url: url,
        file_name: `imagen-${idx + 1}`,
        file_type: 'image',
        uploaded_at: record.created_at ?? new Date(),
      };
    });

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
      validated_by_name: record.validator ? buildMemberName(record.validator) : null,
    };
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
      case 'folder':
        return this.approveFolder(id, actorId, dto.comments);
      case 'class':
        return this.approveClass(id, actorId, dto.comments);
      case 'honor':
        return this.approveHonor(id, actorId, dto.comments);
    }
  }

  private async approveFolder(id: number, actorId: string, comments?: string) {
    const record = await this.prisma.folders_section_records.findUnique({
      where: { folder_section_record_id: id },
    });

    if (!record) {
      throw new NotFoundException(`Registro de carpeta #${id} no encontrado`);
    }

    if (record.status !== FOLDER_STATUS_PENDING) {
      throw new BadRequestException(
        `Solo se pueden aprobar registros en estado pendiente. Estado actual: ${record.status}`,
      );
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.folders_section_records.update({
        where: { folder_section_record_id: id },
        data: {
          status: FOLDER_STATUS_VALIDATED,
          validated_by_id: actorId,
          validated_at: now,
        },
      });

      await tx.validation_logs.create({
        data: {
          entity_type: 'folder',
          entity_id: String(id),
          user_id: record.submitted_by_id ?? actorId,
          action: 'APPROVED',
          performed_by: actorId,
          comment: comments ?? null,
        },
      });

      return result;
    });

    return { id: updated.folder_section_record_id, type: 'folder' as EvidenceType, status: updated.status ?? FOLDER_STATUS_VALIDATED };
  }

  private async approveClass(id: number, actorId: string, comments?: string) {
    const record = await this.prisma.class_section_progress.findUnique({
      where: { section_progress_id: id },
    });

    if (!record) {
      throw new NotFoundException(`Progreso de sección de clase #${id} no encontrado`);
    }

    if (record.status !== CLASS_STATUS_PENDING) {
      throw new BadRequestException(
        `Solo se pueden aprobar registros en estado pendiente. Estado actual: ${record.status}`,
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

    return { id: updated.section_progress_id, type: 'class' as EvidenceType, status: updated.status };
  }

  private async approveHonor(id: number, actorId: string, comments?: string) {
    const record = await this.prisma.users_honors.findUnique({
      where: { user_honor_id: id },
    });

    if (!record) {
      throw new NotFoundException(`Honor de usuario #${id} no encontrado`);
    }

    if (record.validation_status !== HONOR_STATUS_PENDING) {
      throw new BadRequestException(
        `Solo se pueden aprobar honores en estado in_progress. Estado actual: ${record.validation_status}`,
      );
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.users_honors.update({
        where: { user_honor_id: id },
        data: {
          validation_status: HONOR_STATUS_VALIDATED,
          validate: true,
          validated_by_id: actorId,
          validated_at: now,
          rejection_reason: null,
        },
      });

      await tx.validation_logs.create({
        data: {
          entity_type: 'honor',
          entity_id: String(id),
          user_id: record.user_id,
          action: 'APPROVED',
          performed_by: actorId,
          comment: comments ?? null,
        },
      });

      return result;
    });

    return { id: updated.user_honor_id, type: 'honor' as EvidenceType, status: updated.validation_status };
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
      case 'folder':
        return this.rejectFolder(id, actorId, dto.reason);
      case 'class':
        return this.rejectClass(id, actorId, dto.reason);
      case 'honor':
        return this.rejectHonor(id, actorId, dto.reason);
    }
  }

  private async rejectFolder(id: number, actorId: string, reason: string) {
    const record = await this.prisma.folders_section_records.findUnique({
      where: { folder_section_record_id: id },
    });

    if (!record) {
      throw new NotFoundException(`Registro de carpeta #${id} no encontrado`);
    }

    if (record.status === FOLDER_STATUS_REJECTED) {
      throw new BadRequestException(`El registro ya está rechazado`);
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      // Prisma type includes rejection_reason after schema update
      const result = await tx.folders_section_records.update({
        where: { folder_section_record_id: id },
        data: {
          status: FOLDER_STATUS_REJECTED,
          validated_by_id: actorId,
          validated_at: now,
          rejection_reason: reason,
        } as Prisma.folders_section_recordsUpdateInput,
      });

      await tx.validation_logs.create({
        data: {
          entity_type: 'folder',
          entity_id: String(id),
          user_id: record.submitted_by_id ?? actorId,
          action: 'REJECTED',
          performed_by: actorId,
          comment: reason,
        },
      });

      return result;
    });

    return {
      id: updated.folder_section_record_id,
      type: 'folder' as EvidenceType,
      status: (updated as { status?: string | null }).status ?? FOLDER_STATUS_REJECTED,
    };
  }

  private async rejectClass(id: number, actorId: string, reason: string) {
    const record = await this.prisma.class_section_progress.findUnique({
      where: { section_progress_id: id },
    });

    if (!record) {
      throw new NotFoundException(`Progreso de sección de clase #${id} no encontrado`);
    }

    if (record.status === CLASS_STATUS_REJECTED) {
      throw new BadRequestException(`El registro ya está rechazado`);
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

    return { id: updated.section_progress_id, type: 'class' as EvidenceType, status: updated.status };
  }

  private async rejectHonor(id: number, actorId: string, reason: string) {
    const record = await this.prisma.users_honors.findUnique({
      where: { user_honor_id: id },
    });

    if (!record) {
      throw new NotFoundException(`Honor de usuario #${id} no encontrado`);
    }

    if (record.validation_status === HONOR_STATUS_REJECTED) {
      throw new BadRequestException(`El honor ya está rechazado`);
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.users_honors.update({
        where: { user_honor_id: id },
        data: {
          validation_status: HONOR_STATUS_REJECTED,
          validated_by_id: actorId,
          validated_at: now,
          rejection_reason: reason,
        },
      });

      await tx.validation_logs.create({
        data: {
          entity_type: 'honor',
          entity_id: String(id),
          user_id: record.user_id,
          action: 'REJECTED',
          performed_by: actorId,
          comment: reason,
        },
      });

      return result;
    });

    return { id: updated.user_honor_id, type: 'honor' as EvidenceType, status: updated.validation_status };
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
        const reason = error instanceof Error ? error.message : 'Error desconocido';
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
        const reason = error instanceof Error ? error.message : 'Error desconocido';
        failed.push({ id, reason });
      }
    }

    return { succeeded, failed };
  }

  // ============================================================
  // GET /evidence-review/:type/:id/history
  // ============================================================

  async getHistory(type: EvidenceType, id: number): Promise<HistoryEntry[]> {
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

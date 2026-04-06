import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import {
  UpdateRequirementProgressDto,
  BulkUpdateRequirementProgressDto,
} from './dto';

@Injectable()
export class HonorRequirementsService {
  private static readonly MAX_EVIDENCE_PER_TYPE = 3;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorageService: FileStorageService,
  ) {}

  // ========================================
  // CATALOG: Honor Requirements
  // ========================================

  async getRequirements(honorId: number) {
    const honor = await this.prisma.honors.findUnique({
      where: { honor_id: honorId },
      select: { honor_id: true },
    });

    if (!honor) {
      throw new NotFoundException(`Honor with ID ${honorId} not found`);
    }

    const allRequirements = await this.prisma.honor_requirements.findMany({
      where: { honor_id: honorId, active: true },
      orderBy: { requirement_number: 'asc' },
    });

    const topLevel = allRequirements.filter((r) => r.parent_id === null);
    const childrenByParent = new Map<number, typeof allRequirements>();
    for (const req of allRequirements) {
      if (req.parent_id !== null) {
        const siblings = childrenByParent.get(req.parent_id) ?? [];
        siblings.push(req);
        childrenByParent.set(req.parent_id, siblings);
      }
    }

    return topLevel.map((req) => ({
      ...req,
      children: childrenByParent.get(req.requirement_id) ?? [],
    }));
  }

  // ========================================
  // USER: Progress Tracking
  // ========================================

  async getUserProgress(userId: string, honorId: number) {
    const userHonor = await this.prisma.users_honors.findFirst({
      where: { user_id: userId, honor_id: honorId, active: true },
      select: { user_honor_id: true },
    });

    if (!userHonor) {
      throw new NotFoundException(
        `User ${userId} is not enrolled in honor ${honorId}`,
      );
    }

    const requirements = await this.prisma.honor_requirements.findMany({
      where: { honor_id: honorId, active: true },
      orderBy: { requirement_number: 'asc' },
    });

    const progressRows =
      await this.prisma.user_honor_requirement_progress.findMany({
        where: { user_honor_id: userHonor.user_honor_id, active: true },
        include: {
          requirement_evidence: {
            where: { active: true },
            orderBy: { created_at: 'asc' },
          },
        },
      });

    const progressByRequirement = new Map(
      progressRows.map((p) => [p.requirement_id, p]),
    );

    const mergeRequirement = (req: (typeof requirements)[0]) => {
      const progress = progressByRequirement.get(req.requirement_id);
      return {
        requirement_id: req.requirement_id,
        requirement_number: req.requirement_number,
        display_label: req.display_label,
        requirement_text: req.requirement_text,
        reference_text: req.reference_text,
        has_sub_items: req.has_sub_items,
        is_choice_group: req.is_choice_group,
        choice_min: req.choice_min,
        requires_evidence: req.requires_evidence,
        needs_review: req.needs_review,
        completed: progress?.completed ?? false,
        text_response: progress?.text_response ?? null,
        notes: progress?.notes ?? null,
        completed_at: progress?.completed_at ?? null,
        evidences: (progress?.requirement_evidence ?? []).map((e) => ({
          evidence_id: e.evidence_id,
          evidence_type: e.evidence_type,
          url: e.url,
          filename: e.filename,
          mime_type: e.mime_type,
          file_size: e.file_size,
        })),
      };
    };

    const topLevel = requirements.filter((r) => r.parent_id === null);
    const childrenByParent = new Map<number, typeof requirements>();
    for (const req of requirements) {
      if (req.parent_id !== null) {
        const siblings = childrenByParent.get(req.parent_id) ?? [];
        siblings.push(req);
        childrenByParent.set(req.parent_id, siblings);
      }
    }

    const mergedTree = topLevel.map((req) => ({
      ...mergeRequirement(req),
      children: (childrenByParent.get(req.requirement_id) ?? []).map(
        mergeRequirement,
      ),
    }));

    const leafRequirements = requirements.filter(
      (r) => !childrenByParent.has(r.requirement_id),
    );
    const totalRequirements = leafRequirements.length;
    const completedCount = leafRequirements.filter(
      (r) => progressByRequirement.get(r.requirement_id)?.completed,
    ).length;
    const progressPercentage =
      totalRequirements === 0
        ? 0
        : Math.round((completedCount / totalRequirements) * 10000) / 100;

    return {
      user_honor_id: userHonor.user_honor_id,
      honor_id: honorId,
      total_requirements: totalRequirements,
      completed_count: completedCount,
      progress_percentage: progressPercentage,
      requirements: mergedTree,
    };
  }

  async updateProgress(
    userId: string,
    honorId: number,
    dto: UpdateRequirementProgressDto,
  ) {
    const requirement = await this.prisma.honor_requirements.findUnique({
      where: { requirement_id: dto.requirementId },
      select: {
        requirement_id: true,
        honor_id: true,
        requires_evidence: true,
        has_sub_items: true,
      },
    });

    if (!requirement || requirement.honor_id !== honorId) {
      throw new BadRequestException(
        `Requirement ${dto.requirementId} does not belong to honor ${honorId}`,
      );
    }

    const userHonor = await this.prisma.users_honors.findFirst({
      where: { user_id: userId, honor_id: honorId, active: true },
      select: { user_honor_id: true },
    });

    if (!userHonor) {
      throw new NotFoundException(
        `User ${userId} is not enrolled in honor ${honorId}`,
      );
    }

    if (dto.completed && requirement.requires_evidence) {
      const existingProgress =
        await this.prisma.user_honor_requirement_progress.findUnique({
          where: {
            user_honor_id_requirement_id: {
              user_honor_id: userHonor.user_honor_id,
              requirement_id: dto.requirementId,
            },
          },
          include: {
            requirement_evidence: { where: { active: true } },
          },
        });
      const hasEvidence =
        (existingProgress?.requirement_evidence?.length ?? 0) > 0;
      if (!hasEvidence) {
        throw new BadRequestException(
          'Este requisito requiere al menos una evidencia para marcarse como completado',
        );
      }
    }

    return this.prisma.user_honor_requirement_progress.upsert({
      where: {
        user_honor_id_requirement_id: {
          user_honor_id: userHonor.user_honor_id,
          requirement_id: dto.requirementId,
        },
      },
      update: {
        completed: dto.completed,
        ...(dto.textResponse !== undefined && { text_response: dto.textResponse }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        completed_at: dto.completed ? new Date() : null,
        modified_at: new Date(),
      },
      create: {
        user_honor_id: userHonor.user_honor_id,
        requirement_id: dto.requirementId,
        completed: dto.completed,
        text_response: dto.textResponse ?? null,
        notes: dto.notes ?? null,
        completed_at: dto.completed ? new Date() : null,
      },
    });
  }

  async bulkUpdateProgress(
    userId: string,
    honorId: number,
    dto: BulkUpdateRequirementProgressDto,
  ) {
    const requirementIds = dto.requirements.map((r) => r.requirementId);

    const requirements = await this.prisma.honor_requirements.findMany({
      where: {
        requirement_id: { in: requirementIds },
        active: true,
      },
      select: { requirement_id: true, honor_id: true },
    });

    const validIds = new Set(
      requirements
        .filter((r) => r.honor_id === honorId)
        .map((r) => r.requirement_id),
    );

    const invalidIds = requirementIds.filter((id) => !validIds.has(id));
    if (invalidIds.length > 0) {
      throw new BadRequestException(
        `Requirements do not belong to honor ${honorId}: ${invalidIds.join(', ')}`,
      );
    }

    const userHonor = await this.prisma.users_honors.findFirst({
      where: {
        user_id: userId,
        honor_id: honorId,
        active: true,
      },
      select: { user_honor_id: true },
    });

    if (!userHonor) {
      throw new NotFoundException(
        `User ${userId} is not enrolled in honor ${honorId}`,
      );
    }

    await this.prisma.$transaction(
      dto.requirements.map((item) =>
        this.prisma.user_honor_requirement_progress.upsert({
          where: {
            user_honor_id_requirement_id: {
              user_honor_id: userHonor.user_honor_id,
              requirement_id: item.requirementId,
            },
          },
          update: {
            completed: item.completed,
            ...(item.notes !== undefined && { notes: item.notes }),
            completed_at: item.completed ? new Date() : null,
            modified_at: new Date(),
          },
          create: {
            user_honor_id: userHonor.user_honor_id,
            requirement_id: item.requirementId,
            completed: item.completed,
            notes: item.notes ?? null,
            completed_at: item.completed ? new Date() : null,
          },
        }),
      ),
    );

    return this.getUserProgress(userId, honorId);
  }

  // ========================================
  // USER: Evidence CRUD
  // ========================================

  async uploadEvidence(
    userId: string,
    honorId: number,
    requirementId: number,
    file: Express.Multer.File,
    evidenceType: 'IMAGE' | 'FILE',
  ) {
    const { progressId } = await this.getOrCreateProgress(
      userId,
      honorId,
      requirementId,
    );

    const existingCount = await this.prisma.requirement_evidence.count({
      where: {
        progress_id: progressId,
        evidence_type: evidenceType,
        active: true,
      },
    });
    if (existingCount >= HonorRequirementsService.MAX_EVIDENCE_PER_TYPE) {
      throw new BadRequestException(
        `Máximo ${HonorRequirementsService.MAX_EVIDENCE_PER_TYPE} evidencias de tipo ${evidenceType} por requisito`,
      );
    }

    const r2Key = `requirement_evidence/${userId}/${honorId}/${requirementId}/${Date.now()}-${file.originalname}`;
    const { url } = await this.fileStorageService.upload(
      StorageBucketAlias.EVIDENCE_FILES,
      r2Key,
      file.buffer,
      { contentType: file.mimetype, overwrite: false },
    );

    return this.prisma.requirement_evidence.create({
      data: {
        progress_id: progressId,
        evidence_type: evidenceType,
        url,
        filename: file.originalname,
        mime_type: file.mimetype,
        file_size: file.size,
      },
    });
  }

  async addEvidenceLink(
    userId: string,
    honorId: number,
    requirementId: number,
    url: string,
  ) {
    const { progressId } = await this.getOrCreateProgress(
      userId,
      honorId,
      requirementId,
    );

    const existingCount = await this.prisma.requirement_evidence.count({
      where: { progress_id: progressId, evidence_type: 'LINK', active: true },
    });
    if (existingCount >= HonorRequirementsService.MAX_EVIDENCE_PER_TYPE) {
      throw new BadRequestException(
        `Máximo ${HonorRequirementsService.MAX_EVIDENCE_PER_TYPE} enlaces por requisito`,
      );
    }

    return this.prisma.requirement_evidence.create({
      data: { progress_id: progressId, evidence_type: 'LINK', url },
    });
  }

  async getEvidences(
    userId: string,
    honorId: number,
    requirementId: number,
  ) {
    const { progressId } = await this.getOrCreateProgress(
      userId,
      honorId,
      requirementId,
    );

    const evidences = await this.prisma.requirement_evidence.findMany({
      where: { progress_id: progressId, active: true },
      orderBy: { created_at: 'asc' },
    });

    return Promise.all(
      evidences.map(async (e) => ({
        ...e,
        url:
          e.evidence_type === 'LINK'
            ? e.url
            : await this.fileStorageService.getSignedDownloadUrl(
                StorageBucketAlias.EVIDENCE_FILES,
                e.url,
                { expiresInSeconds: 300 },
              ),
      })),
    );
  }

  async deleteEvidence(
    userId: string,
    honorId: number,
    requirementId: number,
    evidenceId: number,
  ) {
    const { progressId } = await this.getOrCreateProgress(
      userId,
      honorId,
      requirementId,
    );

    const evidence = await this.prisma.requirement_evidence.findFirst({
      where: { evidence_id: evidenceId, progress_id: progressId, active: true },
    });
    if (!evidence) {
      throw new NotFoundException(`Evidence ${evidenceId} not found`);
    }

    return this.prisma.requirement_evidence.update({
      where: { evidence_id: evidenceId },
      data: { active: false, modified_at: new Date() },
    });
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  private async getOrCreateProgress(
    userId: string,
    honorId: number,
    requirementId: number,
  ) {
    const requirement = await this.prisma.honor_requirements.findUnique({
      where: { requirement_id: requirementId },
      select: { requirement_id: true, honor_id: true },
    });
    if (!requirement || requirement.honor_id !== honorId) {
      throw new BadRequestException(
        `Requirement ${requirementId} does not belong to honor ${honorId}`,
      );
    }

    const userHonor = await this.prisma.users_honors.findFirst({
      where: { user_id: userId, honor_id: honorId, active: true },
      select: { user_honor_id: true },
    });
    if (!userHonor) {
      throw new NotFoundException(
        `User ${userId} is not enrolled in honor ${honorId}`,
      );
    }

    const progress =
      await this.prisma.user_honor_requirement_progress.upsert({
        where: {
          user_honor_id_requirement_id: {
            user_honor_id: userHonor.user_honor_id,
            requirement_id: requirementId,
          },
        },
        update: {},
        create: {
          user_honor_id: userHonor.user_honor_id,
          requirement_id: requirementId,
        },
      });

    return { progressId: progress.progress_id };
  }
}

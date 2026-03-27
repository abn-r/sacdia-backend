import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  UpdateRequirementProgressDto,
  BulkUpdateRequirementProgressDto,
} from './dto';

@Injectable()
export class HonorRequirementsService {
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.honor_requirements.findMany({
      where: { honor_id: honorId, active: true },
      orderBy: { requirement_number: 'asc' },
    });
  }

  // ========================================
  // USER: Progress Tracking
  // ========================================

  async getUserProgress(userId: string, honorId: number) {
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

    const requirements = await this.prisma.honor_requirements.findMany({
      where: { honor_id: honorId, active: true },
      orderBy: { requirement_number: 'asc' },
    });

    const progressRows =
      await this.prisma.user_honor_requirement_progress.findMany({
        where: {
          user_honor_id: userHonor.user_honor_id,
          active: true,
        },
      });

    const progressByRequirement = new Map(
      progressRows.map((p) => [p.requirement_id, p]),
    );

    const merged = requirements.map((req) => {
      const progress = progressByRequirement.get(req.requirement_id);
      return {
        requirement_id: req.requirement_id,
        requirement_number: req.requirement_number,
        requirement_text: req.requirement_text,
        has_sub_items: req.has_sub_items,
        needs_review: req.needs_review,
        completed: progress?.completed ?? false,
        notes: progress?.notes ?? null,
        completed_at: progress?.completed_at ?? null,
      };
    });

    const totalRequirements = requirements.length;
    const completedCount = merged.filter((r) => r.completed).length;
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
      requirements: merged,
    };
  }

  async updateProgress(
    userId: string,
    honorId: number,
    dto: UpdateRequirementProgressDto,
  ) {
    const requirement = await this.prisma.honor_requirements.findUnique({
      where: { requirement_id: dto.requirementId },
      select: { requirement_id: true, honor_id: true },
    });

    if (!requirement || requirement.honor_id !== honorId) {
      throw new BadRequestException(
        `Requirement ${dto.requirementId} does not belong to honor ${honorId}`,
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

    return this.prisma.user_honor_requirement_progress.upsert({
      where: {
        user_honor_id_requirement_id: {
          user_honor_id: userHonor.user_honor_id,
          requirement_id: dto.requirementId,
        },
      },
      update: {
        completed: dto.completed,
        ...(dto.notes !== undefined && { notes: dto.notes }),
        completed_at: dto.completed ? new Date() : null,
        modified_at: new Date(),
      },
      create: {
        user_honor_id: userHonor.user_honor_id,
        requirement_id: dto.requirementId,
        completed: dto.completed,
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
}

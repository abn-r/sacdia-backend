import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AchievementsService } from '../achievements.service';
import {
  CreateAchievementDto,
  UpdateAchievementDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from '../dto';
import {
  ACHIEVEMENTS_QUEUE,
  RETROACTIVE_BATCH_SIZE,
  RETROACTIVE_BATCH_DELAY_MS,
} from '../achievements.constants';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../../common/services/file-storage.service';
import type { FileStorageService } from '../../common/services/file-storage.service';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ImageMimeType = 'image/png' | 'image/svg+xml' | 'image/webp';

const ALLOWED_IMAGE_MIME_TYPES: ImageMimeType[] = [
  'image/png',
  'image/svg+xml',
  'image/webp',
];

const MIME_TO_EXT: Record<ImageMimeType, string> = {
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

const MAX_BADGE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AdminAchievementsService {
  private readonly logger = new Logger(AdminAchievementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly achievementsService: AchievementsService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
    @Optional()
    @InjectQueue(ACHIEVEMENTS_QUEUE)
    private readonly achievementsQueue: Queue | undefined,
  ) {}

  // ===========================================================================
  // CATEGORY CRUD
  // ===========================================================================

  async getCategories() {
    return this.prisma.achievement_categories.findMany({
      orderBy: [{ display_order: 'asc' }, { achievement_category_id: 'asc' }],
    });
  }

  async getCategoryById(categoryId: number) {
    const category = await this.prisma.achievement_categories.findUnique({
      where: { achievement_category_id: categoryId },
    });

    if (!category) {
      throw new AppNotFoundException(ErrorCode.ACHIEVEMENT_CATEGORY_NOT_FOUND);
    }

    return category;
  }

  async createCategory(dto: CreateCategoryDto) {
    return this.prisma.achievement_categories.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        icon: dto.icon ?? null,
        display_order: dto.display_order ?? 0,
        active: dto.active ?? true,
      },
    });
  }

  async updateCategory(categoryId: number, dto: UpdateCategoryDto) {
    await this.getCategoryById(categoryId);

    return this.prisma.achievement_categories.update({
      where: { achievement_category_id: categoryId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.display_order !== undefined && {
          display_order: dto.display_order,
        }),
        ...(dto.active !== undefined && { active: dto.active }),
        modified_at: new Date(),
      },
    });
  }

  async deleteCategory(categoryId: number) {
    await this.getCategoryById(categoryId);

    // Guard: refuse soft-delete if there are active achievements in this category
    const activeCount = await this.prisma.achievements.count({
      where: { category_id: categoryId, active: true },
    });

    if (activeCount > 0) {
      throw new AppConflictException(ErrorCode.ACHIEVEMENT_CATEGORY_HAS_ACTIVE);
    }

    return this.prisma.achievement_categories.update({
      where: { achievement_category_id: categoryId },
      data: { active: false, modified_at: new Date() },
    });
  }

  // ===========================================================================
  // ACHIEVEMENT CRUD
  // ===========================================================================

  async getAchievements(filters?: {
    type?: string;
    categoryId?: number;
    active?: boolean;
    page?: number;
    limit?: number;
  }) {
    return this.achievementsService.findAllAchievements({
      type: filters?.type as NonNullable<
        Parameters<typeof this.achievementsService.findAllAchievements>[0]
      >['type'],
      categoryId: filters?.categoryId,
      active: filters?.active,
      page: filters?.page,
      limit: filters?.limit,
    });
  }

  async getAchievementById(achievementId: number) {
    const result =
      await this.achievementsService.getAchievementDetail(achievementId);

    if (!result) {
      throw new AppNotFoundException(ErrorCode.ACHIEVEMENT_NOT_FOUND);
    }

    return result.achievement;
  }

  async createAchievement(dto: CreateAchievementDto) {
    // Validate category exists
    await this.getCategoryById(dto.category_id);

    // Validate criteria using the appropriate handler
    this.achievementsService.validateCriteria(dto.type, dto.criteria);

    // Validate prerequisite exists and check for circular dependency
    if (dto.prerequisite_id != null) {
      await this._validatePrerequisite(dto.prerequisite_id, null);
    }

    return this.prisma.achievements.create({
      data: {
        name: dto.name,
        description: dto.description,
        category_id: dto.category_id,
        type: dto.type,
        scope: dto.scope,
        tier: dto.tier,
        points: dto.points ?? 0,
        criteria: dto.criteria as Prisma.InputJsonValue,
        secret: dto.secret ?? false,
        repeatable: dto.repeatable ?? false,
        max_repeats: dto.max_repeats ?? null,
        club_type_id: dto.club_type_id ?? null,
        prerequisite_id: dto.prerequisite_id ?? null,
        badge_image_key: dto.badge_image_key ?? null,
        active: dto.active ?? true,
      },
      include: { category: true },
    });
  }

  async updateAchievement(achievementId: number, dto: UpdateAchievementDto) {
    await this.getAchievementById(achievementId);

    // Re-validate criteria if type or criteria are being changed
    if (dto.type !== undefined && dto.criteria !== undefined) {
      this.achievementsService.validateCriteria(dto.type, dto.criteria);
    }

    // Validate category if being changed
    if (dto.category_id !== undefined) {
      await this.getCategoryById(dto.category_id);
    }

    // Validate prerequisite and circular dependency check
    if (dto.prerequisite_id !== undefined && dto.prerequisite_id !== null) {
      await this._validatePrerequisite(dto.prerequisite_id, achievementId);
    }

    return this.prisma.achievements.update({
      where: { achievement_id: achievementId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.category_id !== undefined && { category_id: dto.category_id }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.scope !== undefined && { scope: dto.scope }),
        ...(dto.tier !== undefined && { tier: dto.tier }),
        ...(dto.points !== undefined && { points: dto.points }),
        ...(dto.criteria !== undefined && {
          criteria: dto.criteria as Prisma.InputJsonValue,
        }),
        ...(dto.secret !== undefined && { secret: dto.secret }),
        ...(dto.repeatable !== undefined && { repeatable: dto.repeatable }),
        ...(dto.max_repeats !== undefined && { max_repeats: dto.max_repeats }),
        ...(dto.club_type_id !== undefined && {
          club_type_id: dto.club_type_id,
        }),
        ...(dto.prerequisite_id !== undefined && {
          prerequisite_id: dto.prerequisite_id,
        }),
        ...(dto.badge_image_key !== undefined && {
          badge_image_key: dto.badge_image_key,
        }),
        ...(dto.active !== undefined && { active: dto.active }),
        modified_at: new Date(),
      } as Prisma.achievementsUncheckedUpdateInput,
      include: { category: true },
    });
  }

  async deleteAchievement(achievementId: number) {
    await this.getAchievementById(achievementId);

    return this.prisma.achievements.update({
      where: { achievement_id: achievementId },
      data: { active: false, modified_at: new Date() },
    });
  }

  // ===========================================================================
  // BADGE IMAGE UPLOAD
  // ===========================================================================

  async uploadBadgeImage(
    achievementId: number,
    file: Express.Multer.File,
  ): Promise<{ badge_image_key: string; badge_image_url: string }> {
    const achievement = await this.getAchievementById(achievementId);

    // Validate MIME type
    const mimeType = file.mimetype as ImageMimeType;
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(mimeType)) {
      throw new AppBadRequestException(
        ErrorCode.ACHIEVEMENT_BADGE_INVALID_TYPE,
      );
    }

    // Validate file size
    if (file.size > MAX_BADGE_SIZE_BYTES) {
      throw new AppBadRequestException(ErrorCode.ACHIEVEMENT_BADGE_TOO_LARGE);
    }

    const ext = MIME_TO_EXT[mimeType];
    const tier = achievement.tier ?? 'BRONZE';
    const key = `achievements/badges/${achievementId}_${tier.toLowerCase()}.${ext}`;

    const result = await this.fileStorage.upload(
      StorageBucketAlias.ACHIEVEMENTS_BADGES,
      key,
      file.buffer,
      { contentType: file.mimetype, overwrite: true },
    );

    // Persist the key in the achievement record
    await this.prisma.achievements.update({
      where: { achievement_id: achievementId },
      data: { badge_image_key: result.key, modified_at: new Date() },
    });

    return {
      badge_image_key: result.key,
      badge_image_url: result.url,
    };
  }

  // ===========================================================================
  // RETROACTIVE EVALUATION
  // ===========================================================================

  async triggerRetroactiveEvaluation(
    achievementId: number,
  ): Promise<{ users_queued: number }> {
    const achievement = await this.getAchievementById(achievementId);

    if (!achievement.active) {
      throw new AppBadRequestException(ErrorCode.ACHIEVEMENT_INACTIVE);
    }

    // Fetch all users who don't already have this achievement completed
    // so we enqueue only those who could still earn it
    const usersWithProgress = await this.prisma.user_achievements.findMany({
      where: { achievement_id: achievementId, completed: true },
      select: { user_id: true },
    });

    const excludedUserIds = new Set(usersWithProgress.map((ua) => ua.user_id));

    // Get all active users
    const allUsers = await this.prisma.users.findMany({
      where: { active: true },
      select: { user_id: true },
    });

    const candidates = allUsers.filter(
      (u) => !excludedUserIds.has(u.user_id) || achievement.repeatable,
    );

    if (!this.achievementsQueue) {
      this.logger.warn(
        'AdminAchievementsService: cannot enqueue retroactive evaluation — no queue available (Redis not configured)',
      );
      return { users_queued: 0 };
    }

    // Rate-limited batching: use addBulk per batch and sleep between batches
    // to avoid overwhelming Redis and the worker pool.
    let queued = 0;

    for (let i = 0; i < candidates.length; i += RETROACTIVE_BATCH_SIZE) {
      const batch = candidates.slice(i, i + RETROACTIVE_BATCH_SIZE);

      try {
        await this.achievementsQueue.addBulk(
          batch.map((u) => ({
            name: 'retroactive-evaluate' as const,
            data: {
              userId: u.user_id,
              achievementId,
              skipNotification: true,
            },
            opts: {
              attempts: 3,
              backoff: { type: 'exponential' as const, delay: 2000 },
              removeOnComplete: { count: 100 },
              removeOnFail: { count: 50 },
            },
          })),
        );
        queued += batch.length;
      } catch (err) {
        this.logger.warn(
          `Failed to enqueue retroactive batch [${i}..${i + batch.length - 1}] for achievement ${achievementId}: ${(err as Error).message}`,
        );
      }

      // Throttle: wait between batches (skip delay after the last batch)
      if (i + RETROACTIVE_BATCH_SIZE < candidates.length) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, RETROACTIVE_BATCH_DELAY_MS),
        );
      }
    }

    return { users_queued: queued };
  }

  // ===========================================================================
  // STATS
  // ===========================================================================

  async getStats() {
    const [
      totalAchievements,
      activeAchievements,
      totalCategories,
      totalUserAchievements,
      completedUserAchievements,
    ] = await Promise.all([
      this.prisma.achievements.count(),
      this.prisma.achievements.count({ where: { active: true } }),
      this.prisma.achievement_categories.count({ where: { active: true } }),
      this.prisma.user_achievements.count(),
      this.prisma.user_achievements.count({ where: { completed: true } }),
    ]);

    const completionRate =
      totalUserAchievements > 0
        ? Math.round((completedUserAchievements / totalUserAchievements) * 100)
        : 0;

    // Most unlocked achievements (top 5)
    const mostUnlocked = await this.prisma.user_achievements.groupBy({
      by: ['achievement_id'],
      where: { completed: true },
      _count: { achievement_id: true },
      orderBy: { _count: { achievement_id: 'desc' } },
      take: 5,
    });

    const mostUnlockedWithNames = await Promise.all(
      mostUnlocked.map(async (item) => {
        const achievement = await this.prisma.achievements.findUnique({
          where: { achievement_id: item.achievement_id },
          select: { achievement_id: true, name: true, tier: true },
        });
        return {
          achievement_id: item.achievement_id,
          name: achievement?.name ?? 'Unknown',
          tier: achievement?.tier ?? null,
          unlock_count: item._count.achievement_id,
        };
      }),
    );

    // Least unlocked active achievements (bottom 5 — must have at least 1 completion)
    const leastUnlocked = await this.prisma.user_achievements.groupBy({
      by: ['achievement_id'],
      where: { completed: true },
      _count: { achievement_id: true },
      orderBy: { _count: { achievement_id: 'asc' } },
      take: 5,
    });

    const leastUnlockedWithNames = await Promise.all(
      leastUnlocked.map(async (item) => {
        const achievement = await this.prisma.achievements.findUnique({
          where: { achievement_id: item.achievement_id },
          select: { achievement_id: true, name: true, tier: true },
        });
        return {
          achievement_id: item.achievement_id,
          name: achievement?.name ?? 'Unknown',
          tier: achievement?.tier ?? null,
          unlock_count: item._count.achievement_id,
        };
      }),
    );

    // Unlocks grouped by tier — join through achievements table via raw query
    // Prisma groupBy cannot traverse relations, so we use $queryRaw.
    const unlocksByTierRaw = await this.prisma.$queryRaw<
      { tier: string; count: bigint }[]
    >`
      SELECT a.tier, COUNT(ua.user_achievement_id) AS count
      FROM user_achievements ua
      INNER JOIN achievements a ON a.achievement_id = ua.achievement_id
      WHERE ua.completed = true
      GROUP BY a.tier
      ORDER BY count DESC
    `;

    const unlocksByTier = unlocksByTierRaw.map((row) => ({
      tier: row.tier,
      count: Number(row.count),
    }));

    // Unlocks grouped by category
    const unlocksByCategoryRaw = await this.prisma.$queryRaw<
      { category_name: string; count: bigint }[]
    >`
      SELECT ac.name AS category_name, COUNT(ua.user_achievement_id) AS count
      FROM user_achievements ua
      INNER JOIN achievements a ON a.achievement_id = ua.achievement_id
      INNER JOIN achievement_categories ac ON ac.achievement_category_id = a.category_id
      WHERE ua.completed = true
      GROUP BY ac.name
      ORDER BY count DESC
    `;

    const unlocksByCategory = unlocksByCategoryRaw.map((row) => ({
      category_name: row.category_name,
      count: Number(row.count),
    }));

    return {
      total_achievements: totalAchievements,
      active_achievements: activeAchievements,
      total_categories: totalCategories,
      total_unlocks: completedUserAchievements,
      completion_rate: completionRate,
      most_unlocked: mostUnlockedWithNames,
      least_unlocked: leastUnlockedWithNames,
      unlocks_by_tier: unlocksByTier,
      unlocks_by_category: unlocksByCategory,
    };
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Validates that:
   * 1. The prerequisite achievement exists and is active.
   * 2. There is no circular dependency (A -> B -> A).
   *
   * @param prerequisiteId - The proposed prerequisite achievement ID.
   * @param currentId - The ID of the achievement being created/updated (null on create).
   */
  private async _validatePrerequisite(
    prerequisiteId: number,
    currentId: number | null,
  ): Promise<void> {
    const prereq = await this.prisma.achievements.findUnique({
      where: { achievement_id: prerequisiteId },
      select: { achievement_id: true, active: true, prerequisite_id: true },
    });

    if (!prereq || !prereq.active) {
      throw new AppNotFoundException(
        ErrorCode.ACHIEVEMENT_PREREQUISITE_NOT_FOUND,
      );
    }

    // Circular dependency detection — walk the prerequisite chain
    if (currentId !== null) {
      const visited = new Set<number>();
      let cursor: number | null = prerequisiteId;

      while (cursor !== null) {
        if (cursor === currentId) {
          throw new AppBadRequestException(
            ErrorCode.ACHIEVEMENT_CIRCULAR_PREREQUISITE,
          );
        }

        if (visited.has(cursor)) break; // cycle not involving currentId, safe to stop
        visited.add(cursor);

        const node = await this.prisma.achievements.findUnique({
          where: { achievement_id: cursor },
          select: { prerequisite_id: true },
        });
        cursor = node?.prerequisite_id ?? null;
      }
    }
  }
}

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { achievement_type, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HandlerRegistry } from './handlers/handler.registry';
import { EmitEventDto } from './dto/emit-event.dto';
import { ACHIEVEMENTS_QUEUE } from './achievements.constants';
import { EvaluateJobData } from './achievements.processor';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';

/**
 * Default BullMQ job options — up to 3 attempts with exponential backoff.
 * Achievement evaluation is best-effort: we never throw to the caller.
 */
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 2000,
  },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
};

@Injectable()
export class AchievementsService {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly handlerRegistry: HandlerRegistry,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
    @Optional()
    @InjectQueue(ACHIEVEMENTS_QUEUE)
    private readonly queue: Queue | undefined,
  ) {
    if (queue) {
      this.logger.log('AchievementsService: async queue mode (BullMQ)');
    } else {
      this.logger.log('AchievementsService: synchronous mode (no Redis configured)');
    }
  }

  // ---------------------------------------------------------------------------
  // emitEvent
  // ---------------------------------------------------------------------------

  /**
   * Persist an achievement event and enqueue evaluation.
   * Fire-and-forget: errors are logged but never thrown to the caller.
   */
  async emitEvent(dto: EmitEventDto): Promise<{ eventLogId: number; queued: boolean }> {
    // Always persist the event — this is the source of truth
    const eventLog = await this.prisma.achievement_event_log.create({
      data: {
        user_id: dto.userId,
        event_type: dto.eventType,
        event_payload: dto.payload as Prisma.InputJsonValue,
        processed: false,
      },
    });

    if (!this.queue) {
      this.logger.warn(
        `AchievementsService: no queue available — event ${eventLog.event_id} persisted but not enqueued`,
      );
      return { eventLogId: eventLog.event_id, queued: false };
    }

    const jobData: EvaluateJobData = {
      userId: dto.userId,
      eventType: dto.eventType,
      payload: dto.payload,
      eventLogId: eventLog.event_id,
    };

    try {
      await this.queue.add('evaluate', jobData, DEFAULT_JOB_OPTIONS);
      return { eventLogId: eventLog.event_id, queued: true };
    } catch (err) {
      this.logger.warn(
        `Failed to enqueue achievement evaluation for event ${eventLog.event_id}: ${(err as Error).message}`,
      );
      return { eventLogId: eventLog.event_id, queued: false };
    }
  }

  // ---------------------------------------------------------------------------
  // findAllAchievements
  // ---------------------------------------------------------------------------

  /**
   * Paginated catalog of achievements with optional filters.
   */
  async findAllAchievements(filters?: {
    type?: achievement_type;
    categoryId?: number;
    active?: boolean;
    page?: number;
    limit?: number;
  }) {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (filters?.type) where.type = filters.type;
    if (filters?.categoryId) where.category_id = filters.categoryId;
    if (filters?.active !== undefined) where.active = filters.active;

    const [data, total] = await Promise.all([
      this.prisma.achievements.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ category_id: 'asc' }, { achievement_id: 'asc' }],
        include: {
          category: true,
        },
      }),
      this.prisma.achievements.count({ where }),
    ]);

    const mappedData = data.map((item) => ({
      ...item,
      badge_image_url: item.badge_image_key
        ? this.fileStorage.resolvePublicUrl(
            StorageBucketAlias.ACHIEVEMENTS_BADGES,
            item.badge_image_key,
          )
        : null,
    }));

    return {
      data: mappedData,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ---------------------------------------------------------------------------
  // getUserAchievements
  // ---------------------------------------------------------------------------

  /**
   * Full achievement catalog with user progress overlaid, grouped by category.
   *
   * Returns ALL active achievements (not just ones the user has touched) so the
   * mobile app can render locked/in-progress/unlocked states for every logro.
   * Secret achievements not yet completed are masked (name/description = "???").
   *
   * Response shape per category item:
   * ```json
   * {
   *   "category_id": 1,
   *   "name": "General",
   *   "icon": null,
   *   "display_order": 0,
   *   "achievements": [
   *     {
   *       "achievement": { ...achievement fields },
   *       "user_achievement": { ...progress fields } | null
   *     }
   *   ]
   * }
   * ```
   */
  async getUserAchievements(userId: string) {
    // Fetch full catalog + user progress in parallel
    const [allAchievements, userAchievements] = await Promise.all([
      this.prisma.achievements.findMany({
        where: { active: true },
        include: { category: true },
        orderBy: [{ category_id: 'asc' }, { achievement_id: 'asc' }],
      }),
      this.prisma.user_achievements.findMany({
        where: { user_id: userId, active: true },
      }),
    ]);

    // Build a fast lookup: achievementId → user_achievement row
    const progressMap = new Map(
      userAchievements.map((ua) => [ua.achievement_id, ua]),
    );

    const completedCount = userAchievements.filter((ua) => ua.completed).length;
    const totalPoints = userAchievements
      .filter((ua) => ua.completed)
      .reduce((sum, ua) => {
        const achievement = allAchievements.find(
          (a) => a.achievement_id === ua.achievement_id,
        );
        return sum + (achievement?.points ?? 0);
      }, 0);
    const completionPercentage =
      allAchievements.length > 0
        ? Math.round((completedCount / allAchievements.length) * 100)
        : 0;

    // Group full catalog by category, merging user progress
    type CategoryEntry = {
      category_id: number;
      name: string;
      icon: string | null;
      display_order: number;
      achievements: {
        achievement: (typeof allAchievements)[number];
        user_achievement: (typeof userAchievements)[number] | null;
      }[];
    };

    const categoryMap = new Map<number, CategoryEntry>();

    for (const achievement of allAchievements) {
      const cat = achievement.category;
      if (!categoryMap.has(cat.achievement_category_id)) {
        categoryMap.set(cat.achievement_category_id, {
          category_id: cat.achievement_category_id,
          name: cat.name,
          icon: cat.icon,
          display_order: cat.display_order ?? 0,
          achievements: [],
        });
      }

      const userProgress = progressMap.get(achievement.achievement_id) ?? null;
      const isCompleted = userProgress?.completed === true;

      // Mask secret achievements not yet completed
      const masked = achievement.secret && !isCompleted
        ? { ...achievement, name: '???', description: '???', badge_image_key: null }
        : achievement;

      // Append badge_image_url derived from the (possibly masked) badge_image_key
      const maskedWithUrl = {
        ...masked,
        badge_image_url: masked.badge_image_key
          ? this.fileStorage.resolvePublicUrl(
              StorageBucketAlias.ACHIEVEMENTS_BADGES,
              masked.badge_image_key,
            )
          : null,
      };

      categoryMap.get(cat.achievement_category_id)!.achievements.push({
        achievement: maskedWithUrl,
        user_achievement: userProgress,
      });
    }

    const categories = Array.from(categoryMap.values()).sort(
      (a, b) => a.display_order - b.display_order || a.category_id - b.category_id,
    );

    return {
      summary: {
        total_completed: completedCount,
        total_points: totalPoints,
        completion_percentage: completionPercentage,
      },
      categories,
    };
  }

  // ---------------------------------------------------------------------------
  // getAchievementDetail
  // ---------------------------------------------------------------------------

  /**
   * Single achievement detail with optional user progress overlay.
   */
  async getAchievementDetail(achievementId: number, userId?: string) {
    const achievement = await this.prisma.achievements.findUnique({
      where: { achievement_id: achievementId },
      include: { category: true },
    });

    if (!achievement) return null;

    const achievementWithUrl = {
      ...achievement,
      badge_image_url: achievement.badge_image_key
        ? this.fileStorage.resolvePublicUrl(
            StorageBucketAlias.ACHIEVEMENTS_BADGES,
            achievement.badge_image_key,
          )
        : null,
    };

    if (!userId) {
      return { achievement: achievementWithUrl, userProgress: null };
    }

    const userProgress = await this.prisma.user_achievements.findFirst({
      where: { user_id: userId, achievement_id: achievementId },
    });

    return { achievement: achievementWithUrl, userProgress: userProgress ?? null };
  }

  // ---------------------------------------------------------------------------
  // findActiveCategories
  // ---------------------------------------------------------------------------

  /**
   * Returns all active achievement categories ordered by display_order then ID.
   */
  async findActiveCategories() {
    return this.prisma.achievement_categories.findMany({
      where: { active: true },
      orderBy: [{ display_order: 'asc' }, { achievement_category_id: 'asc' }],
    });
  }

  // ---------------------------------------------------------------------------
  // getCompletedAchievementIds
  // ---------------------------------------------------------------------------

  /**
   * Returns the set of achievement IDs the user has completed.
   * Used for secret-achievement masking in catalog endpoints.
   */
  async getCompletedAchievementIds(userId: string): Promise<Set<number>> {
    const rows = await this.prisma.user_achievements.findMany({
      where: { user_id: userId, completed: true },
      select: { achievement_id: true },
    });
    return new Set(rows.map((r) => r.achievement_id));
  }

  // ---------------------------------------------------------------------------
  // validateCriteria
  // ---------------------------------------------------------------------------

  /**
   * Delegate criteria validation to the appropriate handler.
   */
  validateCriteria(type: achievement_type, criteria: unknown) {
    const handler = this.handlerRegistry.getHandler(type);
    return handler.validateCriteria(criteria);
  }

  // ---------------------------------------------------------------------------
  // enqueueRetroactiveEvaluation
  // ---------------------------------------------------------------------------

  /**
   * Enqueue a retroactive evaluation for a specific user+achievement pair.
   * Useful for bulk backfill after adding new achievements.
   */
  async enqueueRetroactiveEvaluation(
    userId: string,
    achievementId: number,
    skipNotification = false,
  ): Promise<{ queued: boolean }> {
    if (!this.queue) {
      this.logger.warn(
        'AchievementsService: cannot enqueue retroactive evaluation — no queue available',
      );
      return { queued: false };
    }

    try {
      await this.queue.add(
        'retroactive-evaluate',
        { userId, achievementId, skipNotification },
        DEFAULT_JOB_OPTIONS,
      );
      return { queued: true };
    } catch (err) {
      this.logger.warn(
        `Failed to enqueue retroactive evaluation for user=${userId} achievement=${achievementId}: ${(err as Error).message}`,
      );
      return { queued: false };
    }
  }
}

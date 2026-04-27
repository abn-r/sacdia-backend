import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Job } from 'bullmq';
import { achievements } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { HandlerRegistry } from './handlers/handler.registry';
import { ACHIEVEMENTS_QUEUE } from './achievements.constants';

// ---------------------------------------------------------------------------
// Job data types
// ---------------------------------------------------------------------------

export interface EvaluateJobData {
  userId: string;
  eventType: string;
  payload: Record<string, unknown>;
  eventLogId?: number;
}

export interface RetroactiveEvaluateJobData {
  userId: string;
  achievementId: number;
  skipNotification?: boolean;
}

export type AchievementJobType = 'evaluate' | 'retroactive-evaluate';

@Processor(ACHIEVEMENTS_QUEUE)
export class AchievementsProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(AchievementsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly handlerRegistry: HandlerRegistry,
    private readonly notificationsService: NotificationsService,
  ) {
    super();
  }

  /**
   * Attach error/failed listeners after all modules initialize.
   * Must be onApplicationBootstrap — worker is not available earlier.
   */
  onApplicationBootstrap() {
    this.worker.on('error', (err: Error) => {
      this.logger.error(`BullMQ worker error: ${err.message}`, err.stack);
    });

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      this.logger.error(
        `Job ${job?.id ?? 'unknown'} (${job?.name ?? 'unknown'}) failed: ${err.message}`,
      );
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, {
          tags: {
            bullmq: true,
            queue: job?.queueName ?? 'unknown',
            job_name: job?.name ?? 'unknown',
          },
          extra: {
            job_id: job?.id,
            attempts: job?.attemptsMade,
            failed_reason: job?.failedReason,
          },
        });
      }
    });
  }

  async process(
    job: Job<
      EvaluateJobData | RetroactiveEvaluateJobData,
      unknown,
      AchievementJobType
    >,
  ) {
    switch (job.name as AchievementJobType) {
      case 'evaluate':
        return this.handleEvaluate(job as Job<EvaluateJobData>);
      case 'retroactive-evaluate':
        return this.handleRetroactiveEvaluate(
          job as Job<RetroactiveEvaluateJobData>,
        );
      default:
        this.logger.warn(`Unknown achievement job type: ${job.name}`);
    }
  }

  // ---------------------------------------------------------------------------
  // evaluate
  // ---------------------------------------------------------------------------

  private async handleEvaluate(job: Job<EvaluateJobData>) {
    const { userId, eventType, payload, eventLogId } = job.data;

    this.logger.debug(
      `Processing evaluate job for user=${userId} event=${eventType}`,
    );

    // Find active achievements that match this event type
    const matchingAchievements = await this.findMatchingAchievements(eventType);

    if (matchingAchievements.length === 0) {
      this.logger.debug(`No achievements match event=${eventType}`);
      await this.markEventProcessed(eventLogId);
      return { processed: 0 };
    }

    let processedCount = 0;

    for (const achievement of matchingAchievements) {
      try {
        await this.processAchievementForUser(userId, achievement, {
          eventType,
          payload,
        });
        processedCount++;
      } catch (err) {
        this.logger.error(
          `Failed to process achievement ${achievement.achievement_id} for user ${userId}: ${(err as Error).message}`,
        );
      }
    }

    await this.markEventProcessed(eventLogId);

    return { processed: processedCount };
  }

  // ---------------------------------------------------------------------------
  // retroactive-evaluate
  // ---------------------------------------------------------------------------

  private async handleRetroactiveEvaluate(
    job: Job<RetroactiveEvaluateJobData>,
  ) {
    const { userId, achievementId, skipNotification } = job.data;

    this.logger.debug(
      `Processing retroactive-evaluate job for user=${userId} achievement=${achievementId}`,
    );

    const achievement = await this.prisma.achievements.findUnique({
      where: { achievement_id: achievementId },
    });

    if (!achievement || !achievement.active) {
      this.logger.warn(`Achievement ${achievementId} not found or inactive`);
      return { skipped: true, reason: 'achievement-not-found' };
    }

    const handler = this.handlerRegistry.getHandler(achievement.type);
    const progressResult = await handler.calculateProgress(userId, achievement);

    const isComplete = progressResult.current >= progressResult.target;

    // Upsert user_achievement
    const existingRecord = await this.prisma.user_achievements.findFirst({
      where: { user_id: userId, achievement_id: achievementId },
    });

    if (existingRecord) {
      await this.prisma.user_achievements.update({
        where: { user_achievement_id: existingRecord.user_achievement_id },
        data: {
          progress_value: progressResult.current,
          progress_target: progressResult.target,
          progress_metadata: (progressResult.metadata as object) ?? undefined,
          completed: isComplete,
          completed_at:
            isComplete && !existingRecord.completed
              ? new Date()
              : existingRecord.completed_at,
          times_completed:
            isComplete && !existingRecord.completed
              ? existingRecord.times_completed + 1
              : existingRecord.times_completed,
        },
      });
    } else {
      await this.prisma.user_achievements.create({
        data: {
          user_id: userId,
          achievement_id: achievementId,
          progress_value: progressResult.current,
          progress_target: progressResult.target,
          progress_metadata: (progressResult.metadata as object) ?? undefined,
          completed: isComplete,
          completed_at: isComplete ? new Date() : null,
          times_completed: isComplete ? 1 : 0,
        },
      });
    }

    // Send notification for newly completed achievements (unless skip requested)
    if (isComplete && !existingRecord?.completed && !skipNotification) {
      await this.notificationsService.notifySafe(
        userId,
        '¡Logro desbloqueado!',
        `Completaste: ${achievement.name}`,
        { achievement_id: String(achievementId), type: 'achievement_unlocked' },
        'achievements:retroactive',
      );
    }

    return {
      userId,
      achievementId,
      completed: isComplete,
      progress: progressResult,
    };
  }

  // ---------------------------------------------------------------------------
  // Core processing helper
  // ---------------------------------------------------------------------------

  private async processAchievementForUser(
    userId: string,
    achievement: achievements,
    event: { eventType: string; payload: Record<string, unknown> },
  ): Promise<void> {
    // Check prerequisite completion
    if (achievement.prerequisite_id) {
      const prerequisiteDone = await this.prisma.user_achievements.findFirst({
        where: {
          user_id: userId,
          achievement_id: achievement.prerequisite_id,
          completed: true,
        },
      });
      if (!prerequisiteDone) {
        this.logger.debug(
          `Skipping achievement ${achievement.achievement_id} — prerequisite ${achievement.prerequisite_id} not met`,
        );
        return;
      }
    }

    const handler = this.handlerRegistry.getHandler(achievement.type);

    // Load or determine existing state
    const existingRecord = await this.prisma.user_achievements.findFirst({
      where: { user_id: userId, achievement_id: achievement.achievement_id },
    });

    // Skip if already completed and not repeatable
    if (existingRecord?.completed && !achievement.repeatable) {
      return;
    }

    // Skip if max repeats reached
    if (
      achievement.repeatable &&
      achievement.max_repeats !== null &&
      achievement.max_repeats !== undefined &&
      existingRecord &&
      existingRecord.times_completed >= achievement.max_repeats
    ) {
      return;
    }

    const evalResult = await handler.evaluate(userId, achievement, event);

    const isNowComplete = evalResult.matched;

    if (existingRecord) {
      const wasAlreadyComplete = existingRecord.completed;

      await this.prisma.user_achievements.update({
        where: { user_achievement_id: existingRecord.user_achievement_id },
        data: {
          progress_value: evalResult.currentProgress,
          progress_target: evalResult.targetProgress,
          progress_metadata: (evalResult.metadata as object) ?? undefined,
          completed: isNowComplete,
          completed_at:
            isNowComplete && !wasAlreadyComplete
              ? new Date()
              : existingRecord.completed_at,
          times_completed:
            isNowComplete && !wasAlreadyComplete
              ? existingRecord.times_completed + 1
              : existingRecord.times_completed,
        },
      });

      if (isNowComplete && !wasAlreadyComplete) {
        await this.sendAchievementNotification(userId, achievement);
      }
    } else {
      await this.prisma.user_achievements.create({
        data: {
          user_id: userId,
          achievement_id: achievement.achievement_id,
          progress_value: evalResult.currentProgress,
          progress_target: evalResult.targetProgress,
          progress_metadata: (evalResult.metadata as object) ?? undefined,
          completed: isNowComplete,
          completed_at: isNowComplete ? new Date() : null,
          times_completed: isNowComplete ? 1 : 0,
        },
      });

      if (isNowComplete) {
        await this.sendAchievementNotification(userId, achievement);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Match achievements to event type
  // ---------------------------------------------------------------------------

  /**
   * Find active achievements that could be triggered by this event type.
   *
   * Prisma JSON path filtering supports top-level scalar fields directly.
   * For COMPOUND achievements, we need a raw query because the event is
   * nested inside an array.
   */
  private async findMatchingAchievements(
    eventType: string,
  ): Promise<achievements[]> {
    // Direct match: THRESHOLD / STREAK / MILESTONE / COLLECTION where criteria.event === eventType
    const directMatches = await this.prisma.achievements.findMany({
      where: {
        active: true,
        criteria: {
          path: ['event'],
          equals: eventType,
        },
      },
    });

    // COMPOUND match: any condition inside the conditions array references this event
    const compoundMatches = await this.prisma.$queryRaw<achievements[]>`
      SELECT *
      FROM achievements
      WHERE active = true
        AND type = 'COMPOUND'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(criteria->'conditions') AS cond
          WHERE cond->>'event' = ${eventType}
        )
    `;

    // Deduplicate (an achievement cannot be both direct AND compound)
    const seen = new Set<number>();
    const results: achievements[] = [];

    for (const a of [...directMatches, ...compoundMatches]) {
      if (!seen.has(a.achievement_id)) {
        seen.add(a.achievement_id);
        results.push(a);
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async markEventProcessed(
    eventLogId: number | undefined,
  ): Promise<void> {
    if (!eventLogId) return;
    await this.prisma.achievement_event_log
      .update({
        where: { event_id: eventLogId },
        data: { processed: true },
      })
      .catch((err: Error) => {
        this.logger.warn(
          `Failed to mark event ${eventLogId} as processed: ${err.message}`,
        );
      });
  }

  private async sendAchievementNotification(
    userId: string,
    achievement: achievements,
  ): Promise<void> {
    await this.notificationsService.notifySafe(
      userId,
      '¡Logro desbloqueado!',
      `Completaste: ${achievement.name}`,
      {
        achievement_id: String(achievement.achievement_id),
        type: 'achievement_unlocked',
        tier: achievement.tier,
        points: String(achievement.points),
      },
      'achievements:unlock',
    );
  }
}

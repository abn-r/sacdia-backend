import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ACHIEVEMENTS_QUEUE } from './achievements.constants';
import { HandlerRegistry } from './handlers/handler.registry';
import { ThresholdHandler } from './handlers/threshold.handler';
import { StreakHandler } from './handlers/streak.handler';
import { CompoundHandler } from './handlers/compound.handler';
import { MilestoneHandler } from './handlers/milestone.handler';
import { CollectionHandler } from './handlers/collection.handler';
import { AchievementsProcessor } from './achievements.processor';
import { AchievementsService } from './achievements.service';
import { AchievementsController } from './achievements.controller';
import { AdminAchievementsController } from './admin/admin-achievements.controller';
import { AdminAchievementsService } from './admin/admin-achievements.service';

function isRedisConfigured(): boolean {
  const rawUrl = process.env.REDIS_URL?.trim();
  if (!rawUrl) return false;
  const placeholders = ['YOUR_PASSWORD', 'YOUR_REGION', 'YOUR_PORT'];
  if (placeholders.some((p) => rawUrl.includes(p))) return false;
  try {
    new URL(rawUrl);
    return true;
  } catch {
    return false;
  }
}

const queueImports = isRedisConfigured()
  ? [BullModule.registerQueue({ name: ACHIEVEMENTS_QUEUE })]
  : [];

/**
 * Each handler self-registers with HandlerRegistry via OnModuleInit.
 * The processor is only added when Redis is configured.
 *
 * Controller order matters:
 * - AchievementsController must be listed before AdminAchievementsController
 *   (or vice versa — they have distinct prefixes so order is irrelevant here,
 *   but listing public first is conventional).
 */
@Module({
  imports: [PrismaModule, NotificationsModule, ...queueImports],
  controllers: [AchievementsController, AdminAchievementsController],
  providers: [
    // Registry — must be provided before handlers so DI resolves correctly
    HandlerRegistry,

    // Handlers — each calls registry.register() in onModuleInit()
    ThresholdHandler,
    StreakHandler,
    CompoundHandler,
    MilestoneHandler,
    CollectionHandler,

    // Core service
    AchievementsService,

    // Admin service
    AdminAchievementsService,

    // Processor — only when Redis is available
    ...(isRedisConfigured() ? [AchievementsProcessor] : []),
  ],
  exports: [AchievementsService, HandlerRegistry],
})
export class AchievementsModule {}

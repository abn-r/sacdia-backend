/**
 * Standalone BullMQ queue-registration module for master honor recalculation jobs.
 *
 * This avoids importing BullMQ registration directly in every module that needs
 * to enqueue master-honor recalculation jobs (currently admin + worker module).
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MASTER_HONORS_QUEUE } from './master-honors.constants';
import { isPlaceholderUrl } from '../config/bullmq.config';

function isRedisConfigured(): boolean {
  const rawUrl = process.env.REDIS_URL?.trim();
  if (!rawUrl || isPlaceholderUrl(rawUrl)) {
    return false;
  }

  try {
    new URL(rawUrl);
    return true;
  } catch {
    return false;
  }
}

const redisConfigured = isRedisConfigured();

@Module({
  imports: redisConfigured
    ? [BullModule.registerQueue({ name: MASTER_HONORS_QUEUE })]
    : [],
  exports: redisConfigured ? [BullModule] : [],
})
export class MasterHonorsQueueModule {}

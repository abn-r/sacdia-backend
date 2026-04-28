/**
 * Standalone BullMQ queue-registration module for the background-jobs queue.
 *
 * Extracted into its own module so feature modules (monthly-reports, finances,
 * annual-folders, data-export) can import it to gain access to the
 * @InjectQueue(BACKGROUND_JOBS_QUEUE) provider without pulling in the full
 * BackgroundJobsModule — which would create a circular DI dependency because
 * BackgroundJobsModule itself imports those feature modules.
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BACKGROUND_JOBS_QUEUE } from './background-jobs.types';
import { isPlaceholderUrl } from '../config/bullmq.config';

function isRedisConfigured(): boolean {
  const rawUrl = process.env.REDIS_URL?.trim();
  if (!rawUrl || isPlaceholderUrl(rawUrl)) return false;
  try {
    new URL(rawUrl);
    return true;
  } catch {
    return false;
  }
}

const redisAvailable = isRedisConfigured();

@Module({
  imports: [
    ...(redisAvailable
      ? [BullModule.registerQueue({ name: BACKGROUND_JOBS_QUEUE })]
      : []),
  ],
  exports: [BullModule],
})
export class BackgroundJobsQueueModule {}

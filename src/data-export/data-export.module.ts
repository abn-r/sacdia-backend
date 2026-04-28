import { Module } from '@nestjs/common';
import { DataExportController } from './data-export.controller';
import { DataExportService } from './data-export.service';
import { DataExportProcessor } from './data-export.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';
import { BackgroundJobsQueueModule } from '../background-jobs/background-jobs-queue.module';
import { isPlaceholderUrl } from '../config/bullmq.config';

/**
 * DataExportModule — enqueue site for DATA_EXPORT_GENERATE jobs.
 * Jobs are now published to the consolidated background-jobs queue via
 * BackgroundJobsQueueModule. The legacy DataExportProcessor is kept during the
 * transition to process any jobs still on the old data-exports queue; it will
 * be removed once the queue is fully drained.
 */
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

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    BackgroundJobsQueueModule,
  ],
  controllers: [DataExportController],
  providers: [
    DataExportService,
    ...(isRedisConfigured() ? [DataExportProcessor] : []),
  ],
  exports: [DataExportService],
})
export class DataExportModule {}

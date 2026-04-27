import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DataExportController } from './data-export.controller';
import { DataExportService } from './data-export.service';
import {
  DataExportProcessor,
  DATA_EXPORTS_QUEUE,
} from './data-export.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';
import { isPlaceholderUrl } from '../config/bullmq.config';

/**
 * Mirrors the pattern used by NotificationsModule:
 * BullMQ queue registration and processor provider are guarded by Redis availability.
 * When Redis is not configured the module still starts — export requests will fail
 * gracefully at enqueue time (service throws InternalServerException).
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
    ...(isRedisConfigured()
      ? [BullModule.registerQueue({ name: DATA_EXPORTS_QUEUE })]
      : []),
  ],
  controllers: [DataExportController],
  providers: [
    DataExportService,
    ...(isRedisConfigured() ? [DataExportProcessor] : []),
  ],
  exports: [DataExportService],
})
export class DataExportModule {}

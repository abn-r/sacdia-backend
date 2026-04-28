import { Module } from '@nestjs/common';
import { DataExportController } from './data-export.controller';
import { DataExportService } from './data-export.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';
import { BackgroundJobsQueueModule } from '../background-jobs/background-jobs-queue.module';

/**
 * DataExportModule — enqueue site for DATA_EXPORT_GENERATE jobs.
 * Jobs are published to the consolidated background-jobs queue via
 * BackgroundJobsQueueModule and processed by BackgroundJobsProcessor.
 */
@Module({
  imports: [
    PrismaModule,
    CommonModule,
    BackgroundJobsQueueModule,
  ],
  controllers: [DataExportController],
  providers: [DataExportService],
  exports: [DataExportService],
})
export class DataExportModule {}

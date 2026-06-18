import { Module } from '@nestjs/common';
import { EvidenceReviewController } from './evidence-review.controller';
import { EvidenceReviewService } from './evidence-review.service';
import { PrismaModule } from '../prisma/prisma.module';
import { HonorsModule } from '../honors/honors.module';
import { CommonModule } from '../common/common.module';
import { CoordinationModule } from '../coordination/coordination.module';

@Module({
  imports: [PrismaModule, CommonModule, HonorsModule, CoordinationModule],
  controllers: [EvidenceReviewController],
  providers: [EvidenceReviewService],
  exports: [EvidenceReviewService],
})
export class EvidenceReviewModule {}

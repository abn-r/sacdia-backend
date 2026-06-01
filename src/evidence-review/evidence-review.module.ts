import { Module } from '@nestjs/common';
import { EvidenceReviewController } from './evidence-review.controller';
import { EvidenceReviewService } from './evidence-review.service';
import { PrismaModule } from '../prisma/prisma.module';
import { HonorsModule } from '../honors/honors.module';

@Module({
  imports: [PrismaModule, HonorsModule],
  controllers: [EvidenceReviewController],
  providers: [EvidenceReviewService],
  exports: [EvidenceReviewService],
})
export class EvidenceReviewModule {}

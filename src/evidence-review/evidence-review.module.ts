import { Module } from '@nestjs/common';
import { EvidenceReviewController } from './evidence-review.controller';
import { EvidenceReviewService } from './evidence-review.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EvidenceReviewController],
  providers: [EvidenceReviewService],
  exports: [EvidenceReviewService],
})
export class EvidenceReviewModule {}

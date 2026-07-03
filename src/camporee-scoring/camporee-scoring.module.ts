import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CamporeeScoringController } from './camporee-scoring.controller';
import { CamporeeScoringService } from './camporee-scoring.service';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [CamporeeScoringController],
  providers: [CamporeeScoringService],
  exports: [CamporeeScoringService],
})
export class CamporeeScoringModule {}

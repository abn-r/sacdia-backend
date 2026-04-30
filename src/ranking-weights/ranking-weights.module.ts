import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RankingWeightsController } from './ranking-weights.controller';
import { RankingWeightsService } from './ranking-weights.service';

@Module({
  imports: [PrismaModule],
  controllers: [RankingWeightsController],
  providers: [RankingWeightsService],
  exports: [RankingWeightsService],
})
export class RankingWeightsModule {}

import { Module } from '@nestjs/common';
import { UnitsController } from './units.controller';
import { UnitsService } from './units.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ScoringCategoriesModule } from '../scoring-categories/scoring-categories.module';

@Module({
  imports: [PrismaModule, ScoringCategoriesModule],
  controllers: [UnitsController],
  providers: [UnitsService],
  exports: [UnitsService],
})
export class UnitsModule {}

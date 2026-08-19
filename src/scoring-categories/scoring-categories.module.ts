import { Module } from '@nestjs/common';
import { ScoringCategoriesController } from './scoring-categories.controller';
import { ScoringCategoriesService } from './scoring-categories.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogsModule } from '../catalogs/catalogs.module';

@Module({
  imports: [PrismaModule, CatalogsModule],
  controllers: [ScoringCategoriesController],
  providers: [ScoringCategoriesService],
  exports: [ScoringCategoriesService],
})
export class ScoringCategoriesModule {}

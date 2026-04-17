import { Module } from '@nestjs/common';
import { ClassesController, UserClassesController } from './classes.controller';
import { ClassesService } from './classes.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AchievementsModule } from '../achievements/achievements.module';

@Module({
  imports: [PrismaModule, AchievementsModule],
  controllers: [ClassesController, UserClassesController],
  providers: [ClassesService],
  exports: [ClassesService],
})
export class ClassesModule {}

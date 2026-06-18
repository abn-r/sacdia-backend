import { Module } from '@nestjs/common';
import { ClassesController, UserClassesController } from './classes.controller';
import { ClassCounselorAssignmentsController } from './class-counselor-assignments.controller';
import { ClassesService } from './classes.service';
import { ClassCounselorAssignmentsService } from './class-counselor-assignments.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AchievementsModule } from '../achievements/achievements.module';

@Module({
  imports: [PrismaModule, AchievementsModule],
  controllers: [
    ClassesController,
    UserClassesController,
    ClassCounselorAssignmentsController,
  ],
  providers: [ClassesService, ClassCounselorAssignmentsService],
  exports: [ClassesService, ClassCounselorAssignmentsService],
})
export class ClassesModule {}

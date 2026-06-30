import { Module } from '@nestjs/common';
import { ClubEnrollmentValidationController } from './club-enrollment-validation.controller';
import { ClubEnrollmentsController } from './club-enrollments.controller';
import { ClubEnrollmentsService } from './club-enrollments.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogsModule } from '../catalogs/catalogs.module';

@Module({
  imports: [PrismaModule, CatalogsModule],
  controllers: [ClubEnrollmentsController, ClubEnrollmentValidationController],
  providers: [ClubEnrollmentsService],
  exports: [ClubEnrollmentsService],
})
export class ClubEnrollmentsModule {}

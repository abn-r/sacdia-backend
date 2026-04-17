import { Module } from '@nestjs/common';
import { ClubEnrollmentsController } from './club-enrollments.controller';
import { ClubEnrollmentsService } from './club-enrollments.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogsModule } from '../catalogs/catalogs.module';

@Module({
  imports: [PrismaModule, CatalogsModule],
  controllers: [ClubEnrollmentsController],
  providers: [ClubEnrollmentsService],
  exports: [ClubEnrollmentsService],
})
export class ClubEnrollmentsModule {}

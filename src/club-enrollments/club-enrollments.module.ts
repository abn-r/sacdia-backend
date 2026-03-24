import { Module } from '@nestjs/common';
import { ClubEnrollmentsController } from './club-enrollments.controller';
import { ClubEnrollmentsService } from './club-enrollments.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ClubEnrollmentsController],
  providers: [ClubEnrollmentsService],
  exports: [ClubEnrollmentsService],
})
export class ClubEnrollmentsModule {}

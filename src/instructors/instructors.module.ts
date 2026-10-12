import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InstructorCandidatesController } from './instructor-candidates.controller';
import { InstructorsService } from './instructors.service';

/**
 * Instructor opcional de una especialidad. Lo comparten la carga por
 * certificado y "Mis especialidades". `FILE_STORAGE_SERVICE` lo provee el
 * `CommonModule` global.
 */
@Module({
  imports: [PrismaModule],
  controllers: [InstructorCandidatesController],
  providers: [InstructorsService],
  exports: [InstructorsService],
})
export class InstructorsModule {}

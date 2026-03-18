import { Module } from '@nestjs/common';
import { CamporeesController } from './camporees.controller';
import { CamporeesService } from './camporees.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ClubRolesGuard } from '../common/guards';

@Module({
  imports: [PrismaModule],
  controllers: [CamporeesController],
  providers: [CamporeesService, ClubRolesGuard],
  exports: [CamporeesService],
})
export class CamporeesModule {}

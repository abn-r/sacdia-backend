import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CamporeeVenuesController } from './camporee-venues.controller';
import { CamporeeVenuesService } from './camporee-venues.service';

@Module({
  imports: [PrismaModule],
  controllers: [CamporeeVenuesController],
  providers: [CamporeeVenuesService],
  exports: [CamporeeVenuesService],
})
export class CamporeeVenuesModule {}

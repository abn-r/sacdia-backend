import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CamporeeEventsController } from './camporee-events.controller';
import { CamporeeEventsService } from './camporee-events.service';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [CamporeeEventsController],
  providers: [CamporeeEventsService],
  exports: [CamporeeEventsService],
})
export class CamporeeEventsModule {}

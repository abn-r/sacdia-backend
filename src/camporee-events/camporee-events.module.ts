import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CamporeeEventsController } from './camporee-events.controller';
import { CamporeeEventsService } from './camporee-events.service';

@Module({
  imports: [PrismaModule],
  controllers: [CamporeeEventsController],
  providers: [CamporeeEventsService],
  exports: [CamporeeEventsService],
})
export class CamporeeEventsModule {}

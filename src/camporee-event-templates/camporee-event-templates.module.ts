import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CamporeeEventTemplatesController } from './camporee-event-templates.controller';
import { CamporeeEventTemplatesService } from './camporee-event-templates.service';

@Module({
  imports: [PrismaModule],
  controllers: [CamporeeEventTemplatesController],
  providers: [CamporeeEventTemplatesService],
  exports: [CamporeeEventTemplatesService],
})
export class CamporeeEventTemplatesModule {}

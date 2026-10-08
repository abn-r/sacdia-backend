import { Module } from '@nestjs/common';
import { InvestitureController } from './investiture.controller';
import { InvestitureService } from './investiture.service';
import { LegacyInvestitureRetiredController } from './legacy-investiture-retired.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [InvestitureController, LegacyInvestitureRetiredController],
  providers: [InvestitureService],
  exports: [InvestitureService],
})
export class InvestitureModule {}

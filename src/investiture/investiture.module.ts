import { Module } from '@nestjs/common';
import { InvestitureController } from './investiture.controller';
import { InvestitureService } from './investiture.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [InvestitureController],
  providers: [InvestitureService],
  exports: [InvestitureService],
})
export class InvestitureModule {}

import { Module } from '@nestjs/common';
import { CertificationsController } from './certifications.controller';
import { CertificationsService } from './certifications.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CertificationsController],
  providers: [CertificationsService],
  exports: [CertificationsService],
})
export class CertificationsModule {}

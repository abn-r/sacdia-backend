import { Module } from '@nestjs/common';
import {
  CertificationsController,
  UserCertificationsController,
} from './certifications.controller';
import { CertificationsService } from './certifications.service';
import { AdminCertificationsController } from './controllers/admin-certifications.controller';
import { CertificationDefinitionsService } from './definitions/certification-definitions.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [
    CertificationsController,
    UserCertificationsController,
    AdminCertificationsController,
  ],
  providers: [CertificationsService, CertificationDefinitionsService],
  exports: [CertificationsService, CertificationDefinitionsService],
})
export class CertificationsModule {}

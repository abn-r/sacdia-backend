import { Module } from '@nestjs/common';
import {
  CertificationsController,
  UserCertificationsController,
} from './certifications.controller';
import { CertificationsService } from './certifications.service';
import { AdminCertificationsController } from './controllers/admin-certifications.controller';
import { UserCertificationRequirementsController } from './controllers/user-certification-requirements.controller';
import { CertificationDefinitionsService } from './definitions/certification-definitions.service';
import { CertificationEligibilityService } from './eligibility/certification-eligibility.service';
import { CertificationRequirementsService } from './requirements/certification-requirements.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [
    CertificationsController,
    UserCertificationsController,
    AdminCertificationsController,
    UserCertificationRequirementsController,
  ],
  providers: [
    CertificationsService,
    CertificationDefinitionsService,
    CertificationEligibilityService,
    CertificationRequirementsService,
  ],
  exports: [
    CertificationsService,
    CertificationDefinitionsService,
    CertificationEligibilityService,
    CertificationRequirementsService,
  ],
})
export class CertificationsModule {}

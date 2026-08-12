import { Module } from '@nestjs/common';
import {
  CertificationsController,
  UserCertificationsController,
} from './certifications.controller';
import { CertificationsService } from './certifications.service';
import { AdminCertificationsController } from './controllers/admin-certifications.controller';
import { UserCertificationRequirementsController } from './controllers/user-certification-requirements.controller';
import { CertificationReviewController } from './controllers/certification-review.controller';
import { CertificationCloseoutController } from './controllers/certification-closeout.controller';
import { CertificationDefinitionsService } from './definitions/certification-definitions.service';
import { CertificationEligibilityService } from './eligibility/certification-eligibility.service';
import { CertificationRequirementsService } from './requirements/certification-requirements.service';
import { CertificationEvidenceService } from './evidence/certification-evidence.service';
import { CertificationReviewService } from './review/certification-review.service';
import { CertificationCloseoutService } from './closeout/certification-closeout.service';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Dependencias de infraestructura:
 * - PrismaService — provisto globalmente por PrismaModule (@Global)
 * - FILE_STORAGE_SERVICE — provisto globalmente por CommonModule (@Global)
 */
@Module({
  imports: [PrismaModule],
  controllers: [
    CertificationsController,
    UserCertificationsController,
    AdminCertificationsController,
    UserCertificationRequirementsController,
    CertificationReviewController,
    CertificationCloseoutController,
  ],
  providers: [
    CertificationsService,
    CertificationDefinitionsService,
    CertificationEligibilityService,
    CertificationRequirementsService,
    CertificationEvidenceService,
    CertificationReviewService,
    CertificationCloseoutService,
  ],
  exports: [
    CertificationsService,
    CertificationDefinitionsService,
    CertificationEligibilityService,
    CertificationRequirementsService,
    CertificationEvidenceService,
    CertificationReviewService,
    CertificationCloseoutService,
  ],
})
export class CertificationsModule {}

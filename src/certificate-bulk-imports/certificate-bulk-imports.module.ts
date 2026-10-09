import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { CertificateBulkImportsService } from './certificate-bulk-imports.service';
import { CertificateBulkImportsController } from './certificate-bulk-imports.controller';
import { AdminCertificateBulkImportsController } from './admin-certificate-bulk-imports.controller';
import { CertificateBulkImportApplicationService } from './certificate-bulk-imports-application.service';
import { AdminCertificateBulkImportsService } from './admin-certificate-bulk-imports.service';
import { CertificateImportYearResolver } from './certificate-import-year-resolver.service';
import { CertificateImportFilesService } from './certificate-import-files.service';
import { InstitutionalCertificateRequestsService } from './institutional-certificate-requests.service';
import { InstitutionalCertificateRequestsController } from './institutional-certificate-requests.controller';
import { AdminInstitutionalCertificateRequestsController } from './admin-institutional-certificate-requests.controller';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import { CERTIFICATE_OCR_PROVIDER } from './ocr/certificate-ocr.provider';
import { selectCertificateOcrProvider } from './ocr/certificate-ocr-mode';
import {
  GOOGLE_VISION_CLIENT_FACTORY,
  googleVisionClientFactoryProvider,
  type GoogleVisionClientFactory,
} from './ocr/google-vision-certificate-ocr.provider';
import {
  CertificateOcrQueueModule,
  isCertificateOcrQueueConfigured,
} from './ocr/certificate-ocr-queue.module';
import { CertificateOcrProcessor } from './ocr/certificate-ocr.processor';

@Module({
  imports: [PrismaModule, CertificateOcrQueueModule],
  controllers: [
    CertificateBulkImportsController,
    AdminCertificateBulkImportsController,
    InstitutionalCertificateRequestsController,
    AdminInstitutionalCertificateRequestsController,
  ],
  providers: [
    CertificateBulkImportsService,
    CertificateBulkImportApplicationService,
    AdminCertificateBulkImportsService,
    CertificateImportYearResolver,
    CertificateImportFilesService,
    InstitutionalCertificateRequestsService,
    googleVisionClientFactoryProvider,
    {
      provide: CERTIFICATE_OCR_PROVIDER,
      useFactory: (
        config: ConfigService,
        storage: FileStorageService,
        visionClientFactory: GoogleVisionClientFactory,
      ) =>
        selectCertificateOcrProvider({
          config,
          storage,
          visionClientFactory,
        }),
      inject: [
        ConfigService,
        FILE_STORAGE_SERVICE,
        GOOGLE_VISION_CLIENT_FACTORY,
      ],
    },
    ...(isCertificateOcrQueueConfigured() ? [CertificateOcrProcessor] : []),
  ],
  exports: [
    CertificateBulkImportsService,
    CertificateBulkImportApplicationService,
  ],
})
export class CertificateBulkImportsModule {}

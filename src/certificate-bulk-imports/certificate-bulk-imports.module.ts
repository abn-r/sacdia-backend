import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CertificateBulkImportsService } from './certificate-bulk-imports.service';
import { CertificateBulkImportsController } from './certificate-bulk-imports.controller';
import { AdminCertificateBulkImportsController } from './admin-certificate-bulk-imports.controller';
import { CertificateBulkImportApplicationService } from './certificate-bulk-imports-application.service';
import { AdminCertificateBulkImportsService } from './admin-certificate-bulk-imports.service';
import { CERTIFICATE_OCR_PROVIDER } from './ocr/certificate-ocr.provider';
import { NoopCertificateOcrProvider } from './ocr/noop-certificate-ocr.provider';

@Module({
  imports: [PrismaModule],
  controllers: [
    CertificateBulkImportsController,
    AdminCertificateBulkImportsController,
  ],
  providers: [
    CertificateBulkImportsService,
    CertificateBulkImportApplicationService,
    AdminCertificateBulkImportsService,
    {
      provide: CERTIFICATE_OCR_PROVIDER,
      useClass: NoopCertificateOcrProvider,
    },
  ],
  exports: [
    CertificateBulkImportsService,
    CertificateBulkImportApplicationService,
  ],
})
export class CertificateBulkImportsModule {}

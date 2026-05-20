import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CertificateBulkImportsService } from './certificate-bulk-imports.service';
import { CertificateBulkImportsController } from './certificate-bulk-imports.controller';
import { CERTIFICATE_OCR_PROVIDER } from './ocr/certificate-ocr.provider';
import { NoopCertificateOcrProvider } from './ocr/noop-certificate-ocr.provider';

@Module({
  imports: [PrismaModule],
  controllers: [CertificateBulkImportsController],
  providers: [
    CertificateBulkImportsService,
    {
      provide: CERTIFICATE_OCR_PROVIDER,
      useClass: NoopCertificateOcrProvider,
    },
  ],
  exports: [CertificateBulkImportsService],
})
export class CertificateBulkImportsModule {}

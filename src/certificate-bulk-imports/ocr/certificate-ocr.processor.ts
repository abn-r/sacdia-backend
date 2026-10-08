import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  BadRequestException,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { CertificateBulkImportsService } from '../certificate-bulk-imports.service';
import {
  CERTIFICATE_OCR_QUEUE,
  CertificateOcrJobPayload,
} from './certificate-ocr.queue';

@Processor(CERTIFICATE_OCR_QUEUE, { concurrency: 1 })
export class CertificateOcrProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(CertificateOcrProcessor.name);

  constructor(private readonly imports: CertificateBulkImportsService) {
    super();
  }

  onApplicationBootstrap() {
    this.worker.on('error', (err: Error) => {
      this.logger.error(`certificate OCR worker error: ${err.message}`);
    });
  }

  async process(job: Job<CertificateOcrJobPayload>): Promise<void> {
    const userId = job.data?.userId;
    const batchId = job.data?.batchId;
    if (!userId || !batchId) {
      this.logger.error(`certificate OCR job ${job.id} missing ids`);
      return;
    }
    const started = Date.now();
    try {
      await this.imports.runQueuedOcr(userId, batchId);
    } catch (error) {
      const code = certificateOcrErrorCode(error);
      if (TERMINAL_OCR_CODES.has(code)) throw new UnrecoverableError(code);
      throw error;
    }
    this.logger.log(
      `certificate OCR job ${job.id} finished in ${Date.now() - started}ms`,
    );
  }
}

const TERMINAL_OCR_CODES = new Set([
  'CERTIFICATE_IMPORT_OCR_FAILED',
  'CERTIFICATE_IMPORT_OCR_QUOTA',
  'CERTIFICATE_IMPORT_OCR_UNSUPPORTED_TYPE',
  'CERTIFICATE_IMPORT_OCR_FILE_TOO_LARGE',
  'CERTIFICATE_IMPORT_PDF_TOO_MANY_PAGES',
  'CERTIFICATE_IMPORT_PDF_INVALID',
  'CERTIFICATE_IMPORT_PDF_ENCRYPTED',
]);

function certificateOcrErrorCode(error: unknown): string {
  if (error instanceof BadRequestException) {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    if (response && typeof response === 'object' && 'message' in response) {
      const message = response.message;
      if (typeof message === 'string') return message;
    }
  }
  return error instanceof Error ? error.message : '';
}

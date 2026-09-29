import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job } from 'bullmq';
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
    await this.imports.runQueuedOcr(userId, batchId);
    this.logger.log(
      `certificate OCR job ${job.id} finished in ${Date.now() - started}ms`,
    );
  }
}

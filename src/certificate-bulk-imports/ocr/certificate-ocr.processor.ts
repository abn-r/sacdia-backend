import { Processor, WorkerHost } from '@nestjs/bullmq';
import { attachBullmqWorkerErrorLogging } from '../../config/bullmq-worker-logging';
import { buildBullmqWorkerOptions } from '../../config/bullmq-workers.config';
import { HttpException, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { CertificateBulkImportsService } from '../certificate-bulk-imports.service';
import {
  CERTIFICATE_OCR_QUEUE,
  CertificateOcrJobPayload,
} from './certificate-ocr.queue';

@Processor(
  CERTIFICATE_OCR_QUEUE,
  buildBullmqWorkerOptions('certificate-import-ocr', { concurrency: 1 }),
)
export class CertificateOcrProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(CertificateOcrProcessor.name);

  constructor(private readonly imports: CertificateBulkImportsService) {
    super();
  }

  onApplicationBootstrap() {
    attachBullmqWorkerErrorLogging(
      this.worker,
      this.logger,
      CERTIFICATE_OCR_QUEUE,
    );
    this.worker.on('failed', (job, err) => {
      void this.recordTerminalFailure(job, err);
    });
  }

  /**
   * Persists the cause when a job fails for good (UnrecoverableError, or the
   * last attempt of a retryable error) so the batch can expose `ocr_error_code`.
   * Intermediate attempts that will be retried record nothing. Best effort: a
   * failure here must never affect the queue.
   */
  async recordTerminalFailure(
    job: Job<CertificateOcrJobPayload> | undefined,
    error: Error,
  ): Promise<void> {
    const userId = job?.data?.userId;
    const batchId = job?.data?.batchId;
    if (!job || !userId || !batchId) return;
    const exhausted =
      error instanceof UnrecoverableError ||
      job.attemptsMade >= (job.opts?.attempts ?? 1);
    if (!exhausted) return;
    try {
      await this.imports.recordOcrFailure(
        userId,
        batchId,
        certificateOcrErrorCode(error),
      );
    } catch {
      this.logger.error(`certificate OCR job ${job.id} failure not recorded`);
    }
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

/**
 * Retry policy for a failed OCR job (attempts: 2, fixed backoff).
 *
 * A code is TERMINAL when repeating the same job cannot change the outcome:
 * the input (file bytes, type, size, page count, stored reference, batch
 * state) is what fails, or the vendor answered with a definitive refusal.
 * Retrying those only delays the user-visible failure by one backoff.
 *
 * A failure is RETRYABLE only when it is transient:
 *  - CERTIFICATE_IMPORT_OCR_UNAVAILABLE (vendor/proxy down, 429/5xx, timeout,
 *    PDF validation queue full)
 *  - CERTIFICATE_IMPORT_STORAGE_UNAVAILABLE (object storage outage)
 *  - any error that is not an HttpException (database, Redis, network, bugs)
 *  - any HttpException code not listed here (unknown stays retryable)
 */
const TERMINAL_OCR_CODES = new Set([
  // Vendor / proxy definitive answers.
  'CERTIFICATE_IMPORT_OCR_FAILED',
  'CERTIFICATE_IMPORT_OCR_QUOTA',
  'CERTIFICATE_IMPORT_OCR_UNSUPPORTED_TYPE',
  'CERTIFICATE_IMPORT_OCR_FILE_TOO_LARGE',
  // PDF validation outcomes.
  'CERTIFICATE_IMPORT_PDF_TOO_MANY_PAGES',
  'CERTIFICATE_IMPORT_PDF_INVALID',
  'CERTIFICATE_IMPORT_PDF_ENCRYPTED',
  // Sealed object read: stored object is absent, oversized or not what the
  // row declared (provider readSealed / assertCertificateImportObject).
  'CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED',
  'CERTIFICATE_IMPORT_FILE_CONTENT_MISMATCH',
  'CERTIFICATE_IMPORT_FILE_TOO_LARGE',
  // Batch preconditions in runQueuedOcr / loadReadableOcrBatch.
  'CERTIFICATE_IMPORT_FILE_URL_INVALID',
  'CERTIFICATE_IMPORT_CANNOT_PROCESS_OCR',
  'CERTIFICATE_IMPORT_BATCH_NOT_FOUND',
]);

function certificateOcrErrorCode(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    if (response && typeof response === 'object') {
      // AppException payloads carry `code`; Nest exceptions carry `message`.
      if ('code' in response && typeof response.code === 'string') {
        return response.code;
      }
      if ('message' in response && typeof response.message === 'string') {
        return response.message;
      }
    }
  }
  return error instanceof Error ? error.message : '';
}

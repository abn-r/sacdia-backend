import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { AppBadRequestException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { CertificateOcrProcessor } from './certificate-ocr.processor';

describe('CertificateOcrProcessor', () => {
  it('runs the queued read with the batch ids and nothing else', async () => {
    const runQueuedOcr = jest.fn().mockResolvedValue({ batch_id: 'batch-1' });
    const processor = new CertificateOcrProcessor({ runQueuedOcr } as never);

    await processor.process({
      id: 'job-1',
      data: { userId: 'user-1', batchId: 'batch-1' },
    } as never);

    expect(runQueuedOcr).toHaveBeenCalledWith('user-1', 'batch-1');
  });

  it('does not call the vendor path when the job has no ids', async () => {
    const runQueuedOcr = jest.fn();
    const processor = new CertificateOcrProcessor({ runQueuedOcr } as never);

    await processor.process({ id: 'job-2', data: {} } as never);

    expect(runQueuedOcr).not.toHaveBeenCalled();
  });

  it.each([
    'CERTIFICATE_IMPORT_OCR_FAILED',
    'CERTIFICATE_IMPORT_OCR_QUOTA',
    'CERTIFICATE_IMPORT_OCR_UNSUPPORTED_TYPE',
    'CERTIFICATE_IMPORT_OCR_FILE_TOO_LARGE',
    'CERTIFICATE_IMPORT_PDF_TOO_MANY_PAGES',
    'CERTIFICATE_IMPORT_PDF_INVALID',
    'CERTIFICATE_IMPORT_PDF_ENCRYPTED',
    'CERTIFICATE_IMPORT_FILE_CONTENT_MISMATCH',
    'CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED',
    'CERTIFICATE_IMPORT_FILE_TOO_LARGE',
    'CERTIFICATE_IMPORT_CANNOT_PROCESS_OCR',
  ])('does not spend the next attempt on terminal %s', async (code) => {
    const runQueuedOcr = jest
      .fn()
      .mockRejectedValue(new BadRequestException(code));
    const processor = new CertificateOcrProcessor({ runQueuedOcr } as never);

    await expect(
      processor.process({
        id: 'job-3',
        data: { userId: 'user-1', batchId: 'batch-1' },
      } as never),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it.each([
    [
      'batch not found',
      () => new NotFoundException('CERTIFICATE_IMPORT_BATCH_NOT_FOUND'),
    ],
    [
      'invalid stored file reference',
      () =>
        new AppBadRequestException(
          ErrorCode.CERTIFICATE_IMPORT_FILE_URL_INVALID,
        ),
    ],
  ])('does not spend the next attempt on terminal %s', async (_, make) => {
    const runQueuedOcr = jest.fn().mockRejectedValue(make());
    const processor = new CertificateOcrProcessor({ runQueuedOcr } as never);

    await expect(
      processor.process({
        id: 'job-3b',
        data: { userId: 'user-1', batchId: 'batch-1' },
      } as never),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it.each([
    'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
    'CERTIFICATE_IMPORT_STORAGE_UNAVAILABLE',
  ])('leaves transient %s retryable', async (code) => {
    const error = new BadRequestException(code);
    const runQueuedOcr = jest.fn().mockRejectedValue(error);
    const processor = new CertificateOcrProcessor({ runQueuedOcr } as never);

    await expect(
      processor.process({
        id: 'job-4',
        data: { userId: 'user-1', batchId: 'batch-1' },
      } as never),
    ).rejects.toBe(error);
  });

  it.each([
    ['a database error', new Error('Connection terminated unexpectedly')],
    ['an unknown code', new BadRequestException('SOMETHING_NEW')],
  ])('leaves %s retryable', async (_, error) => {
    const runQueuedOcr = jest.fn().mockRejectedValue(error);
    const processor = new CertificateOcrProcessor({ runQueuedOcr } as never);

    await expect(
      processor.process({
        id: 'job-5',
        data: { userId: 'user-1', batchId: 'batch-1' },
      } as never),
    ).rejects.toBe(error);
  });
});

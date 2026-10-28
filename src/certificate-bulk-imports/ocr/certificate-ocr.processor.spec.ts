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

  describe('terminal failure event', () => {
    const job = (overrides: Record<string, unknown> = {}) =>
      ({
        id: 'job-9',
        data: { userId: 'user-1', batchId: 'batch-1' },
        attemptsMade: 2,
        opts: { attempts: 2 },
        ...overrides,
      }) as never;
    const build = () => {
      const recordOcrFailure = jest.fn().mockResolvedValue(undefined);
      return {
        recordOcrFailure,
        processor: new CertificateOcrProcessor({ recordOcrFailure } as never),
      };
    };

    it('records the code of an UnrecoverableError on the first attempt', async () => {
      const { processor, recordOcrFailure } = build();

      await processor.recordTerminalFailure(
        job({ attemptsMade: 1 }),
        new UnrecoverableError('CERTIFICATE_IMPORT_PDF_ENCRYPTED'),
      );

      expect(recordOcrFailure).toHaveBeenCalledWith(
        'user-1',
        'batch-1',
        'CERTIFICATE_IMPORT_PDF_ENCRYPTED',
      );
    });

    it('records the code of a retryable error only on its last attempt', async () => {
      const { processor, recordOcrFailure } = build();
      const error = new BadRequestException(
        'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
      );

      await processor.recordTerminalFailure(job({ attemptsMade: 1 }), error);
      expect(recordOcrFailure).not.toHaveBeenCalled();

      await processor.recordTerminalFailure(job({ attemptsMade: 2 }), error);
      expect(recordOcrFailure).toHaveBeenCalledWith(
        'user-1',
        'batch-1',
        'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
      );
    });

    it('passes AppException codes through', async () => {
      const { processor, recordOcrFailure } = build();

      await processor.recordTerminalFailure(
        job(),
        new AppBadRequestException(
          ErrorCode.CERTIFICATE_IMPORT_FILE_URL_INVALID,
        ),
      );

      expect(recordOcrFailure.mock.calls[0][2]).toBe(
        'CERTIFICATE_IMPORT_FILE_URL_INVALID',
      );
    });

    it('does nothing without ids and never throws if recording fails', async () => {
      const { processor, recordOcrFailure } = build();
      await processor.recordTerminalFailure(job({ data: {} }), new Error('x'));
      await processor.recordTerminalFailure(undefined, new Error('x'));
      expect(recordOcrFailure).not.toHaveBeenCalled();

      recordOcrFailure.mockRejectedValue(new Error('db down'));
      await expect(
        processor.recordTerminalFailure(job(), new Error('x')),
      ).resolves.toBeUndefined();
    });
  });

  describe('beforeApplicationShutdown', () => {
    const withWorker = (close: jest.Mock) => {
      const processor = new CertificateOcrProcessor({} as never);
      Object.defineProperty(processor, 'worker', { get: () => ({ close }) });
      return processor;
    };

    it('drains the worker before the DB and Vision client close', async () => {
      const close = jest.fn().mockResolvedValue(undefined);
      await withWorker(close).beforeApplicationShutdown();
      expect(close).toHaveBeenCalledWith();
    });

    it('never throws if the worker fails to close', async () => {
      const close = jest.fn().mockRejectedValue(new Error('redis down'));
      await expect(
        withWorker(close).beforeApplicationShutdown(),
      ).resolves.toBeUndefined();
    });
  });
});

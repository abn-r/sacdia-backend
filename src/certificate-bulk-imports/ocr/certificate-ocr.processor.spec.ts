import { BadRequestException } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
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

  it('leaves an unavailable read retryable', async () => {
    const runQueuedOcr = jest
      .fn()
      .mockRejectedValue(
        new BadRequestException('CERTIFICATE_IMPORT_OCR_UNAVAILABLE'),
      );
    const processor = new CertificateOcrProcessor({ runQueuedOcr } as never);

    await expect(
      processor.process({
        id: 'job-4',
        data: { userId: 'user-1', batchId: 'batch-1' },
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

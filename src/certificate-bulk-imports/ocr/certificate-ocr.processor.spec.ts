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
});

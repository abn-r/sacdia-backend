import * as emailQueue from './email.queue';
import { EmailQueueProducer } from './email.queue';

describe('email queue worker options', () => {
  it('limits the worker to 90 jobs every 24 hours', () => {
    const workerOptions = (
      emailQueue as typeof emailQueue & {
        EMAIL_WORKER_OPTIONS?: {
          limiter?: {
            max: number;
            duration: number;
          };
        };
      }
    ).EMAIL_WORKER_OPTIONS;

    expect(workerOptions?.limiter).toEqual({
      max: 90,
      duration: 24 * 60 * 60 * 1000,
    });
  });
});

describe('BCR33-N4 email queue producer attempts', () => {
  const add = jest.fn();
  const producer = new EmailQueueProducer({ add } as never);

  beforeEach(() => add.mockReset());

  it('keeps attempts: 5 with exponential backoff by default', async () => {
    await producer.enqueue(emailQueue.EMAIL_JOB_CRON_ALERT, {} as never);

    expect(add).toHaveBeenCalledWith(
      emailQueue.EMAIL_JOB_CRON_ALERT,
      {},
      expect.objectContaining({
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
      }),
    );
  });

  it('honours a single-attempt override without touching other options', async () => {
    await producer.enqueue(
      emailQueue.EMAIL_JOB_INVESTITURE_NOTICE,
      { dispatchId: 'd' },
      { required: true, jobId: 'investiture-mail-d', attempts: 1 },
    );

    expect(add).toHaveBeenCalledWith(
      emailQueue.EMAIL_JOB_INVESTITURE_NOTICE,
      { dispatchId: 'd' },
      expect.objectContaining({
        attempts: 1,
        jobId: 'investiture-mail-d',
        removeOnComplete: true,
        removeOnFail: false,
      }),
    );
  });
});

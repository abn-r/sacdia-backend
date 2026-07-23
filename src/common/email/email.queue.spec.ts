import * as emailQueue from './email.queue';

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

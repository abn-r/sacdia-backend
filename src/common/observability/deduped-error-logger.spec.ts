import { DedupedErrorLogger, redisErrorHint } from './deduped-error-logger';

describe('DedupedErrorLogger', () => {
  let nowMs: number;
  let logger: { error: jest.Mock };
  let deduped: DedupedErrorLogger;

  beforeEach(() => {
    nowMs = 0;
    logger = { error: jest.fn() };
    deduped = new DedupedErrorLogger(logger, {
      initialWindowMs: 30_000,
      maxWindowMs: 120_000,
      now: () => nowMs,
    });
  });

  const quota = () =>
    new Error('ERR max requests limit exceeded. Limit: 500000, Usage: 500002');

  it('logs the first occurrence immediately with the stack', () => {
    const error = quota();

    expect(deduped.log('worker', error)).toBe(true);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('worker: ERR max requests limit exceeded'),
      error.stack,
    );
  });

  it('collapses a 100 ms flood into a single line per window', () => {
    for (let i = 0; i < 250; i += 1) {
      nowMs = i * 100; // 25 s of errors every 100 ms
      deduped.log('worker', quota());
    }

    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('reports the suppressed count when the window elapses, then widens it', () => {
    deduped.log('worker', quota());
    for (let i = 1; i <= 299; i += 1) {
      nowMs = i * 100;
      deduped.log('worker', quota());
    }
    nowMs = 30_000;
    deduped.log('worker', quota());

    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenLastCalledWith(
      expect.stringContaining('(299 identical errors suppressed)'),
    );

    // Window doubled to 60 s: nothing at +59 s, a line at +60 s.
    nowMs = 30_000 + 59_000;
    deduped.log('worker', quota());
    expect(logger.error).toHaveBeenCalledTimes(2);
    nowMs = 30_000 + 60_000;
    deduped.log('worker', quota());
    expect(logger.error).toHaveBeenCalledTimes(3);
  });

  it('caps the window at maxWindowMs', () => {
    let calls = 0;
    // Keep the error alive every 10 s for 20 minutes.
    for (nowMs = 0; nowMs <= 20 * 60_000; nowMs += 10_000) {
      if (deduped.log('worker', quota())) calls += 1;
    }

    // 0, 30, 90, 210, 330, 450, ... (120 s cap) - far below 120 raw errors.
    expect(calls).toBeGreaterThan(5);
    expect(calls).toBeLessThan(15);
  });

  it('treats numbers in the message as the same signature', () => {
    deduped.log('worker', new Error('Usage: 500002'));
    nowMs = 1_000;
    deduped.log('worker', new Error('Usage: 500417'));

    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('tracks different errors and different contexts independently', () => {
    deduped.log('worker-a', new Error('ECONNREFUSED'));
    deduped.log('worker-b', new Error('ECONNREFUSED'));
    deduped.log('worker-a', new Error('ETIMEDOUT'));

    expect(logger.error).toHaveBeenCalledTimes(3);
  });

  it('starts over after the error has been quiet for two windows', () => {
    deduped.log('worker', quota());
    nowMs = 61_000;
    deduped.log('worker', quota());

    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenLastCalledWith(
      expect.not.stringContaining('suppressed'),
      expect.anything(),
    );
  });

  it('bounds the number of tracked signatures', () => {
    const small = new DedupedErrorLogger(logger, {
      maxSignatures: 2,
      now: () => nowMs,
    });

    small.log('w', new Error('a'));
    small.log('w', new Error('b'));
    small.log('w', new Error('c')); // evicts "a"
    small.log('w', new Error('a')); // logged again, not suppressed

    expect(logger.error).toHaveBeenCalledTimes(4);
  });

  it('accepts non-Error values and appends the hint', () => {
    deduped.log('worker', 'boom', 'check Redis');

    expect(logger.error).toHaveBeenCalledWith(
      'worker: boom - check Redis',
      undefined,
    );
  });
});

describe('redisErrorHint', () => {
  it('flags the Upstash quota error only', () => {
    expect(
      redisErrorHint(new Error('ERR max requests limit exceeded. Limit: 5')),
    ).toContain('BULLMQ_WORKER_DRAIN_DELAY_SECONDS');
    expect(redisErrorHint(new Error('connect ECONNREFUSED'))).toBeUndefined();
  });
});

import { runWithManualCronContext } from './cron-run-context';
import { cronRunLockKey } from './cron-run-lock.service';
import { buildCronRunLockHarness } from './cron-run-lock.testing';

describe('CronRunLock', () => {
  const JOB = 'some-job';
  let h: ReturnType<typeof buildCronRunLockHarness>;

  beforeEach(() => {
    h = buildCronRunLockHarness();
  });

  it('uses one key per job, shared by scheduled and manual runs', () => {
    expect(cronRunLockKey(JOB)).toBe('cron-run:some-job');
  });

  it('runs the work and releases the lock afterwards', async () => {
    const fn = jest.fn().mockResolvedValue('done');

    const result = await h.runLock.runExclusive(JOB, 1000, fn);

    expect(result).toEqual({ ran: true, value: 'done' });
    expect(await h.isRunLockFree(JOB)).toBe(true);
  });

  it('skips (and records the skipped run) when the lock is held', async () => {
    await h.holdRunLock(JOB);
    const fn = jest.fn();

    const result = await h.runLock.runExclusive(JOB, 1000, fn);

    expect(result).toEqual({ ran: false });
    expect(fn).not.toHaveBeenCalled();
    expect(h.cronLogger.trackSkipped).toHaveBeenCalledWith(
      JOB,
      'run_lock_held',
    );
  });

  it('only logs a skipped tick of a job that writes no cron_run_log rows', async () => {
    await h.holdRunLock(JOB);

    await h.runLock.runExclusive(JOB, 1000, jest.fn(), { logsRuns: false });

    expect(h.cronLogger.trackSkipped).not.toHaveBeenCalled();
  });

  it('still records the skipped row of a manual run for a job that writes none', async () => {
    await h.holdRunLock(JOB);
    const context = { triggeredBy: 'admin-1', outcomes: [] };

    await runWithManualCronContext(context, () =>
      h.runLock.runExclusive(JOB, 1000, jest.fn(), { logsRuns: false }),
    );

    expect(h.cronLogger.trackSkipped).toHaveBeenCalledTimes(1);
    expect(context.outcomes).toHaveLength(1);
  });

  it('does not fail the tick when the skipped row cannot be written', async () => {
    await h.holdRunLock(JOB);
    h.cronLogger.trackSkipped.mockRejectedValueOnce(new Error('db down'));

    await expect(h.runLock.runExclusive(JOB, 1000, jest.fn())).resolves.toEqual(
      { ran: false },
    );
  });

  it('releases the lock when the work throws, and rethrows', async () => {
    await expect(
      h.runLock.runExclusive(JOB, 1000, () =>
        Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom');

    expect(await h.isRunLockFree(JOB)).toBe(true);
  });

  it('two concurrent calls never both run', async () => {
    let release!: () => void;
    const first = h.runLock.runExclusive(
      JOB,
      1000,
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    await new Promise((resolve) => setImmediate(resolve));

    const second = await h.runLock.runExclusive(JOB, 1000, jest.fn());
    release();

    expect(second).toEqual({ ran: false });
    await expect(first).resolves.toEqual({ ran: true, value: undefined });
  });

  it('does not re-take the lock inside a manual run that already holds it', async () => {
    const context = { triggeredBy: 'admin-1', outcomes: [] };
    const inner = jest.fn().mockResolvedValue('inner');

    const result = await runWithManualCronContext(context, () =>
      h.runLock.runExclusive(JOB, 1000, () =>
        // what the handler does when the endpoint invokes it
        h.runLock.runExclusive(JOB, 1000, inner),
      ),
    );

    expect(inner).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ran: true,
      value: { ran: true, value: 'inner' },
    });
    expect(await h.isRunLockFree(JOB)).toBe(true);
  });

  it('a tick does not inherit the hold of a manual run of the same job', async () => {
    let release!: () => void;
    const context = { triggeredBy: 'admin-1', outcomes: [] };
    const manual = runWithManualCronContext(context, () =>
      h.runLock.runExclusive(
        JOB,
        1000,
        () => new Promise<void>((resolve) => (release = resolve)),
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));

    const tickFn = jest.fn();
    const tick = await h.runLock.runExclusive(JOB, 1000, tickFn);
    release();
    await manual;

    expect(tick).toEqual({ ran: false });
    expect(tickFn).not.toHaveBeenCalled();
  });

  it('a stale holder cannot free the lock of the run that replaced it', async () => {
    const first = await h.lockService.tryAcquireOwned(cronRunLockKey(JOB), 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await h.holdRunLock(JOB);

    await h.lockService.releaseOwned(first!);

    expect(
      await h.lockService.tryAcquireOwned(cronRunLockKey(JOB), 1000),
    ).toBeNull();
    await h.lockService.releaseOwned(second);
  });
});

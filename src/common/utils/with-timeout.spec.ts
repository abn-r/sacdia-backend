import { withTimeout } from './with-timeout';

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves with the promise value when it settles first', async () => {
    await expect(
      withTimeout(Promise.resolve('ok'), 1_000, 'timed out'),
    ).resolves.toBe('ok');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects with the original error when the promise fails first', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('boom')), 1_000, 'timed out'),
    ).rejects.toThrow('boom');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects with the timeout message when the promise never settles', async () => {
    const pending = withTimeout(
      new Promise<never>(() => {}),
      1_000,
      'timed out',
    );
    const assertion = expect(pending).rejects.toThrow('timed out');

    await jest.advanceTimersByTimeAsync(1_000);

    await assertion;
  });

  it('does not leak an unhandled rejection when the promise fails after the timeout', async () => {
    let rejectLate!: (error: Error) => void;
    const late = new Promise<never>((_, reject) => {
      rejectLate = reject;
    });
    const pending = withTimeout(late, 1_000, 'timed out');
    const assertion = expect(pending).rejects.toThrow('timed out');

    await jest.advanceTimersByTimeAsync(1_000);
    await assertion;
    rejectLate(new Error('late failure'));
    await Promise.resolve();
  });
});

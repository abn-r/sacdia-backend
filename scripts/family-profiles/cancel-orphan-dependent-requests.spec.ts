import {
  parseCleanupArgs,
  runCleanup,
  type CleanupStore,
  type OrphanRequestRow,
} from './cancel-orphan-dependent-requests';

const ROW: OrphanRequestRow = {
  kind: 'pending',
  assignmentId: 'as-1',
  userId: 'u-1',
  clubSectionId: 163,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  purgedAt: new Date('2026-10-27T00:00:00.000Z'),
};

function createStore(): jest.Mocked<CleanupStore> {
  return {
    listOrphanRequests: jest.fn().mockResolvedValue([ROW]),
    cancelForDependent: jest
      .fn()
      .mockResolvedValue({ cancelled: ['as-1'], ended: ['as-9'] }),
  };
}

describe('cancel-orphan-dependent-requests', () => {
  it('parses the flags and rejects unknown ones', () => {
    expect(parseCleanupArgs([])).toEqual({ dryRun: false, apply: false });
    expect(parseCleanupArgs(['--dry-run'])).toEqual({
      dryRun: true,
      apply: false,
    });
    expect(parseCleanupArgs(['--apply'])).toEqual({
      dryRun: false,
      apply: true,
    });
    expect(() => parseCleanupArgs(['--nope'])).toThrow('Unknown argument');
  });

  it('does nothing without a mode flag', async () => {
    const store = createStore();
    const result = await runCleanup({ dryRun: false, apply: false }, store);
    expect(result.mode).toBe('noop');
    expect(store.listOrphanRequests).not.toHaveBeenCalled();
  });

  it('dry-run prints each row and writes nothing', async () => {
    const store = createStore();
    const log = jest.fn();
    const result = await runCleanup({ dryRun: true, apply: false }, store, log);
    expect(result).toEqual({
      mode: 'dry-run',
      rows: [ROW],
      cancelled: 0,
      ended: 0,
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('would cancel'));
    expect(store.cancelForDependent).not.toHaveBeenCalled();
  });

  it('--apply cancels once per dependent', async () => {
    const store = createStore();
    store.listOrphanRequests.mockResolvedValue([
      ROW,
      { ...ROW, assignmentId: 'as-2' },
    ]);
    const now = new Date('2026-11-10T00:00:00.000Z');
    const result = await runCleanup(
      { dryRun: false, apply: true },
      store,
      jest.fn(),
      now,
    );
    expect(result.mode).toBe('apply');
    expect(store.cancelForDependent).toHaveBeenCalledTimes(1);
    expect(store.cancelForDependent).toHaveBeenCalledWith('u-1', now);
    expect(result.cancelled).toBe(1);
    expect(result.ended).toBe(1);
  });

  it('plans pending requests and live assignments, in dry-run and apply', async () => {
    const store = createStore();
    const live: OrphanRequestRow = {
      ...ROW,
      kind: 'live',
      assignmentId: 'as-9',
      userId: 'u-2',
    };
    store.listOrphanRequests.mockResolvedValue([ROW, live]);
    const log = jest.fn();

    const dry = await runCleanup({ dryRun: true, apply: false }, store, log);
    expect(dry.rows).toEqual([ROW, live]);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^would cancel: kind=pending assignment=as-1/),
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^would end: kind=live assignment=as-9/),
    );
    expect(store.cancelForDependent).not.toHaveBeenCalled();

    const applied = await runCleanup(
      { dryRun: false, apply: true },
      store,
      jest.fn(),
    );
    expect(store.cancelForDependent).toHaveBeenCalledTimes(2);
    expect(applied.cancelled).toBe(2);
    expect(applied.ended).toBe(2);
  });
});

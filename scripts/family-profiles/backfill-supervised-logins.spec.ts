import {
  parseBackfillArgs,
  planBackfill,
  runBackfill,
  type AccountHolderRow,
  type BackfillStore,
} from './backfill-supervised-logins';

const NOW = new Date('2026-10-20T15:00:00.000Z');

const holder = (
  userId: string,
  birthday: string,
  hasGuardianship = false,
  policy: AccountHolderRow['policy'] = null,
): AccountHolderRow => ({
  userId,
  birthday: new Date(`${birthday}T00:00:00.000Z`),
  policy,
  hasGuardianship,
});

function createStore(holders: AccountHolderRow[]): jest.Mocked<BackfillStore> {
  return {
    listAccountHoldersWithoutRow: jest.fn().mockResolvedValue(holders),
    insertRows: jest.fn().mockImplementation(async (rows) => rows.length),
  };
}

describe('backfill-supervised-logins', () => {
  describe('parseBackfillArgs', () => {
    it('defaults to dry-run', () => {
      expect(parseBackfillArgs([])).toEqual({ apply: false });
    });
    it('parses --apply and rejects unknown flags', () => {
      expect(parseBackfillArgs(['--apply'])).toEqual({ apply: true });
      expect(() => parseBackfillArgs(['--wipe'])).toThrow('Unknown argument');
    });
  });

  describe('planBackfill', () => {
    it('plans only account holders aged 13-17 and starts the clock for those without a guardianship', async () => {
      const store = createStore([
        holder('teen-no-guardian', '2011-03-01'), // 15
        holder('teen-guarded', '2010-05-05', true), // 16
        holder('adult', '2000-01-01'), // 26
        holder('child', '2018-01-01'), // 8
        holder('turns-18-today', '2008-10-20'), // 18 exactly
        holder('turns-13-today', '2013-10-20'), // 13 exactly
      ]);
      const planned = await planBackfill(store, NOW);
      expect(planned).toEqual([
        { userId: 'teen-no-guardian', pendingSince: NOW },
        { userId: 'teen-guarded', pendingSince: null },
        { userId: 'turns-13-today', pendingSince: NOW },
      ]);
    });

    it('follows the country policy (majority 16)', async () => {
      const policy = {
        minSelfLoginAge: 13,
        ageOfMajority: 16,
        timeZone: 'America/Mexico_City',
      };
      const planned = await planBackfill(
        createStore([
          holder('is-adult-here', '2010-05-05', false, policy), // 16
          holder('minor-here', '2012-05-05', false, policy), // 14
        ]),
        NOW,
      );
      expect(planned.map((row) => row.userId)).toEqual(['minor-here']);
    });

    it('de-duplicates a user listed twice', async () => {
      const planned = await planBackfill(
        createStore([holder('dup', '2011-03-01'), holder('dup', '2011-03-01')]),
        NOW,
      );
      expect(planned).toHaveLength(1);
    });
  });

  describe('runBackfill', () => {
    it('is a dry-run without --apply: reads, plans, writes nothing', async () => {
      const store = createStore([holder('teen', '2011-03-01')]);
      const result = await runBackfill({ apply: false }, store, NOW);
      expect(result.mode).toBe('dry-run');
      expect(result.planned).toHaveLength(1);
      expect(result.written).toBe(0);
      expect(store.insertRows).not.toHaveBeenCalled();
    });

    it('writes the planned rows with --apply', async () => {
      const store = createStore([holder('teen', '2011-03-01')]);
      const result = await runBackfill({ apply: true }, store, NOW);
      expect(result).toMatchObject({ mode: 'apply', written: 1 });
      expect(store.insertRows).toHaveBeenCalledWith([
        { userId: 'teen', pendingSince: NOW },
      ]);
    });

    it('is idempotent: a second run finds no holder without a row and writes nothing', async () => {
      const store = createStore([]);
      const result = await runBackfill({ apply: true }, store, NOW);
      expect(result).toMatchObject({ mode: 'apply', planned: [], written: 0 });
      expect(store.insertRows).not.toHaveBeenCalled();
    });
  });
});

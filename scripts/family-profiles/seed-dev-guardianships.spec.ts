import {
  parseSeedArgs,
  planSeed,
  runSeed,
  type SeedStore,
} from './seed-dev-guardianships';

function createStore(): jest.Mocked<SeedStore> {
  return {
    listDependentsWithoutGuardianship: jest
      .fn()
      .mockResolvedValue(['dep-1', 'dep-2']),
    insertGuardianship: jest.fn().mockResolvedValue(undefined),
  };
}

describe('seed-dev-guardianships', () => {
  describe('parseSeedArgs', () => {
    it('defaults to no mode and no apply', () => {
      expect(parseSeedArgs([])).toEqual({
        placeholders: false,
        apply: false,
      });
    });

    it('parses the documented flags', () => {
      expect(parseSeedArgs(['--placeholders', '--apply'])).toEqual({
        placeholders: true,
        apply: true,
      });
    });

    it('rejects the removed --from-legal-reps flag', () => {
      expect(() => parseSeedArgs(['--from-legal-reps'])).toThrow(
        'Unknown argument',
      );
    });

    it('rejects unknown flags', () => {
      expect(() => parseSeedArgs(['--wipe'])).toThrow('Unknown argument');
    });
  });

  describe('no writes without a flag', () => {
    it('does not even read the store when no mode flag is given', async () => {
      const store = createStore();
      const result = await runSeed({ placeholders: false, apply: true }, store);
      expect(result).toEqual({ mode: 'noop', planned: [], written: 0 });
      expect(store.listDependentsWithoutGuardianship).not.toHaveBeenCalled();
      expect(store.insertGuardianship).not.toHaveBeenCalled();
    });

    it('is a dry-run with a mode flag but without --apply', async () => {
      const store = createStore();
      const result = await runSeed({ placeholders: true, apply: false }, store);
      expect(result.mode).toBe('dry-run');
      expect(result.planned.length).toBeGreaterThan(0);
      expect(result.written).toBe(0);
      expect(store.insertGuardianship).not.toHaveBeenCalled();
    });

    it('writes every planned row only with a mode flag and --apply', async () => {
      const store = createStore();
      const result = await runSeed({ placeholders: true, apply: true }, store);
      expect(result.mode).toBe('apply');
      expect(result.written).toBe(2);
      expect(store.insertGuardianship).toHaveBeenCalledTimes(2);
    });
  });

  describe('planSeed', () => {
    it('--placeholders creates test_placeholder rows flagged as test data', async () => {
      const planned = await planSeed(
        { placeholders: true, apply: false },
        createStore(),
      );
      expect(planned).toHaveLength(2);
      for (const row of planned) {
        expect(row.isTestData).toBe(true);
        expect(row.verificationMethod).toBe('test_placeholder');
        expect(row.guardianUserId).toBeNull();
        expect(row.externalName).toBeTruthy();
        expect(row.verifiedAt).toBeInstanceOf(Date);
      }
    });
  });
});

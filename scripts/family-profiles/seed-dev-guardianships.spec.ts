import {
  parseSeedArgs,
  planSeed,
  runSeed,
  type LegalRepresentativeRow,
  type SeedStore,
} from './seed-dev-guardianships';

const LEGAL_REP_WITH_ACCOUNT: LegalRepresentativeRow = {
  userId: 'u-minor-1',
  representativeUserId: 'u-parent-1',
  name: null,
  paternalLastName: null,
  maternalLastName: null,
  phone: null,
  relationshipTypeId: 'rel-1',
};

const LEGAL_REP_EXTERNAL: LegalRepresentativeRow = {
  userId: 'u-minor-2',
  representativeUserId: null,
  name: 'Maria',
  paternalLastName: 'Perez',
  maternalLastName: null,
  phone: '5512345678',
  relationshipTypeId: null,
};

function createStore(): jest.Mocked<SeedStore> {
  return {
    listDependentsWithoutGuardianship: jest
      .fn()
      .mockResolvedValue(['dep-1', 'dep-2']),
    listLegalRepresentativesWithoutGuardianship: jest
      .fn()
      .mockResolvedValue([LEGAL_REP_WITH_ACCOUNT, LEGAL_REP_EXTERNAL]),
    insertGuardianship: jest.fn().mockResolvedValue(undefined),
  };
}

describe('seed-dev-guardianships', () => {
  describe('parseSeedArgs', () => {
    it('defaults to no mode and no apply', () => {
      expect(parseSeedArgs([])).toEqual({
        placeholders: false,
        fromLegalReps: false,
        apply: false,
      });
    });

    it('parses the documented flags', () => {
      expect(
        parseSeedArgs(['--placeholders', '--from-legal-reps', '--apply']),
      ).toEqual({ placeholders: true, fromLegalReps: true, apply: true });
    });

    it('rejects unknown flags', () => {
      expect(() => parseSeedArgs(['--wipe'])).toThrow('Unknown argument');
    });
  });

  describe('no writes without a flag', () => {
    it('does not even read the store when no mode flag is given', async () => {
      const store = createStore();
      const result = await runSeed(
        { placeholders: false, fromLegalReps: false, apply: true },
        store,
      );
      expect(result).toEqual({ mode: 'noop', planned: [], written: 0 });
      expect(store.listDependentsWithoutGuardianship).not.toHaveBeenCalled();
      expect(
        store.listLegalRepresentativesWithoutGuardianship,
      ).not.toHaveBeenCalled();
      expect(store.insertGuardianship).not.toHaveBeenCalled();
    });

    it('is a dry-run with a mode flag but without --apply', async () => {
      const store = createStore();
      const result = await runSeed(
        { placeholders: true, fromLegalReps: true, apply: false },
        store,
      );
      expect(result.mode).toBe('dry-run');
      expect(result.planned.length).toBeGreaterThan(0);
      expect(result.written).toBe(0);
      expect(store.insertGuardianship).not.toHaveBeenCalled();
    });

    it('writes every planned row only with a mode flag and --apply', async () => {
      const store = createStore();
      const result = await runSeed(
        { placeholders: true, fromLegalReps: false, apply: true },
        store,
      );
      expect(result.mode).toBe('apply');
      expect(result.written).toBe(2);
      expect(store.insertGuardianship).toHaveBeenCalledTimes(2);
    });
  });

  describe('planSeed', () => {
    it('--placeholders creates test_placeholder rows flagged as test data', async () => {
      const planned = await planSeed(
        { placeholders: true, fromLegalReps: false, apply: false },
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

    it('--from-legal-reps creates pending legacy_import rows', async () => {
      const planned = await planSeed(
        { placeholders: false, fromLegalReps: true, apply: false },
        createStore(),
      );
      expect(planned).toEqual([
        expect.objectContaining({
          dependentUserId: 'u-minor-1',
          guardianUserId: 'u-parent-1',
          relationshipTypeId: 'rel-1',
          consentStatus: 'pending',
          verificationMethod: 'legacy_import',
          verifiedAt: null,
          externalName: null,
          isTestData: false,
        }),
        expect.objectContaining({
          dependentUserId: 'u-minor-2',
          guardianUserId: null,
          consentStatus: 'pending',
          verificationMethod: 'legacy_import',
          externalName: 'Maria Perez',
          externalPhone: '5512345678',
          isTestData: false,
        }),
      ]);
    });

    it('skips legal reps that violate the holder or not-self checks', async () => {
      const store = createStore();
      store.listLegalRepresentativesWithoutGuardianship.mockResolvedValue([
        { ...LEGAL_REP_WITH_ACCOUNT, representativeUserId: 'u-minor-1' },
        { ...LEGAL_REP_EXTERNAL, name: null, paternalLastName: null },
      ]);
      const planned = await planSeed(
        { placeholders: false, fromLegalReps: true, apply: false },
        store,
      );
      expect(planned).toEqual([]);
    });

    it('does not plan a placeholder for a dependent already covered by a legal rep', async () => {
      const store = createStore();
      store.listDependentsWithoutGuardianship.mockResolvedValue([
        'u-minor-1',
        'dep-9',
      ]);
      const planned = await planSeed(
        { placeholders: true, fromLegalReps: true, apply: false },
        store,
      );
      const placeholders = planned.filter((row) => row.isTestData);
      expect(placeholders.map((row) => row.dependentUserId)).toEqual(['dep-9']);
    });
  });
});

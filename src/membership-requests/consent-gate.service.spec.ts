import { ConsentGateService } from './consent-gate.service';
import { ErrorCode } from '../common/errors/error-codes';

describe('ConsentGateService', () => {
  const gate = new ConsentGateService();
  const userId = '20a9a762-a4fa-49dd-93a6-3851e27f8b69';

  const makeDb = () => ({
    dependent_profiles: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    guardianships: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  });
  type Db = ReturnType<typeof makeDb>;
  const asDb = (db: Db) => db as never;

  describe('assertApprovable', () => {
    it('lets a non-dependent through without reading guardianships', async () => {
      const db = makeDb();
      db.dependent_profiles.findUnique.mockResolvedValue(null);

      await expect(
        gate.assertApprovable(asDb(db), userId),
      ).resolves.toBeUndefined();
      expect(db.guardianships.findFirst).not.toHaveBeenCalled();
      expect(db.$executeRaw).not.toHaveBeenCalled();
    });

    it('takes the per-dependent advisory lock BEFORE reading the consent (S2: serialized with verify/revoke)', async () => {
      const db = makeDb();
      const order: string[] = [];
      db.dependent_profiles.findUnique.mockResolvedValue({ user_id: userId });
      db.$executeRaw.mockImplementation((sql: TemplateStringsArray, key) => {
        order.push(`lock:${sql.join('?')}:${String(key)}`);
        return Promise.resolve(1);
      });
      db.guardianships.findFirst.mockImplementation(() => {
        order.push('read');
        return Promise.resolve({ guardianship_id: 'g1' });
      });

      await gate.assertApprovable(asDb(db), userId);

      expect(order).toEqual([
        `lock:SELECT pg_advisory_xact_lock(hashtext(?)):guardianships:dependent:${userId}`,
        'read',
      ]);
    });

    it('lets a dependent with a verified, non-test row through (custodian rows count too)', async () => {
      const db = makeDb();
      db.dependent_profiles.findUnique.mockResolvedValue({ user_id: userId });
      db.guardianships.findFirst.mockResolvedValue({ guardianship_id: 'g1' });

      await expect(
        gate.assertApprovable(asDb(db), userId),
      ).resolves.toBeUndefined();
      // No is_custodian filter: custody verified by another club member counts.
      expect(db.guardianships.findFirst).toHaveBeenCalledWith({
        where: {
          dependent_user_id: userId,
          consent_status: 'verified',
          is_test_data: false,
        },
        select: { guardianship_id: true },
      });
    });

    it('blocks a dependent without a verified row (pending, revoked or test-only) with 409', async () => {
      const db = makeDb();
      db.dependent_profiles.findUnique.mockResolvedValue({ user_id: userId });
      db.guardianships.findFirst.mockResolvedValue(null);

      await expect(
        gate.assertApprovable(asDb(db), userId),
      ).rejects.toMatchObject({
        code: ErrorCode.MR_CONSENT_NOT_VERIFIED,
        status: 409,
      });
    });
  });

  describe('loadDependentConsent', () => {
    it('returns an empty map without querying for no ids', async () => {
      const db = makeDb();

      await expect(gate.loadDependentConsent(asDb(db), [])).resolves.toEqual(
        new Map(),
      );
      expect(db.dependent_profiles.findMany).not.toHaveBeenCalled();
    });

    it('omits non-dependents and skips the guardianship query when there are none', async () => {
      const db = makeDb();
      db.dependent_profiles.findMany.mockResolvedValue([]);

      const states = await gate.loadDependentConsent(asDb(db), [userId]);

      expect(states.size).toBe(0);
      expect(db.guardianships.findMany).not.toHaveBeenCalled();
    });

    it('reports null while pending and the latest verified_at once verified', async () => {
      const db = makeDb();
      db.dependent_profiles.findMany.mockResolvedValue([
        { user_id: 'dep-pending' },
        { user_id: 'dep-verified' },
      ]);
      db.guardianships.findMany.mockResolvedValue([
        {
          dependent_user_id: 'dep-verified',
          verified_at: new Date('2026-10-01T00:00:00Z'),
        },
        {
          dependent_user_id: 'dep-verified',
          verified_at: new Date('2026-10-10T00:00:00Z'),
        },
      ]);

      const states = await gate.loadDependentConsent(asDb(db), [
        'dep-pending',
        'dep-verified',
        userId,
      ]);

      expect(states.get('dep-pending')).toEqual({ verifiedAt: null });
      expect(states.get('dep-verified')).toEqual({
        verifiedAt: new Date('2026-10-10T00:00:00Z'),
      });
      expect(states.has(userId)).toBe(false);
    });
  });
  describe('loadConsentBlocks', () => {
    const dependentA = 'aaaaaaaa-0000-4000-8000-00000000000a';
    const dependentB = 'bbbbbbbb-0000-4000-8000-00000000000b';
    const adult = 'cccccccc-0000-4000-8000-00000000000c';

    const row = (overrides: Record<string, unknown> = {}) => ({
      guardianship_id: 'g-1',
      dependent_user_id: dependentA,
      is_primary: true,
      is_custodian: false,
      consent_status: 'pending',
      external_name: null,
      relationship_type: { name: 'Madre' },
      guardian: { name: 'María', paternal_last_name: 'Pérez' },
      custodian_club: null,
      consent_evidences: [] as Array<{ evidence_id: string }>,
      ...overrides,
    });

    it('answers with null for adults and reads nothing more when nobody is a dependent', async () => {
      const db = makeDb();
      db.dependent_profiles.findMany.mockResolvedValue([]);

      const blocks = await gate.loadConsentBlocks(asDb(db), [adult]);

      expect(blocks.size).toBe(0);
      expect(db.guardianships.findMany).not.toHaveBeenCalled();
    });

    it('does not query at all for an empty page', async () => {
      const db = makeDb();

      expect((await gate.loadConsentBlocks(asDb(db), [])).size).toBe(0);
      expect(db.dependent_profiles.findMany).not.toHaveBeenCalled();
      expect(db.guardianships.findMany).not.toHaveBeenCalled();
    });

    it('builds the block of every dependent from TWO queries, however many requests', async () => {
      const db = makeDb();
      db.dependent_profiles.findMany.mockResolvedValue([
        { user_id: dependentA },
        { user_id: dependentB },
      ]);
      db.guardianships.findMany.mockResolvedValue([
        row({ consent_evidences: [{ evidence_id: 'e-1' }] }),
        row({
          guardianship_id: 'g-2',
          dependent_user_id: dependentB,
          consent_status: 'verified',
          guardian: { name: 'Luis', paternal_last_name: 'Gómez' },
          relationship_type: { name: 'Padre' },
        }),
      ]);

      const blocks = await gate.loadConsentBlocks(asDb(db), [
        adult,
        dependentA,
        dependentB,
      ]);

      expect(db.dependent_profiles.findMany).toHaveBeenCalledTimes(1);
      expect(db.guardianships.findMany).toHaveBeenCalledTimes(1);
      expect(blocks.has(adult)).toBe(false);
      expect(blocks.get(dependentA)).toEqual({
        required: true,
        dependent: true,
        guardianship_id: 'g-1',
        status: 'pending',
        evidence_uploaded: true,
        guardians: [
          {
            display_name: 'María Pérez',
            relationship_type_name: 'Madre',
            is_primary: true,
          },
        ],
      });
      expect(blocks.get(dependentB)).toMatchObject({
        guardianship_id: 'g-2',
        status: 'verified',
        evidence_uploaded: false,
      });
    });

    it('ignores seeded test data and revoked rows in the query', async () => {
      const db = makeDb();
      db.dependent_profiles.findMany.mockResolvedValue([
        { user_id: dependentA },
      ]);
      db.guardianships.findMany.mockResolvedValue([]);

      await gate.loadConsentBlocks(asDb(db), [dependentA]);

      expect(db.guardianships.findMany.mock.calls[0][0].where).toEqual({
        dependent_user_id: { in: [dependentA] },
        is_test_data: false,
        consent_status: { not: 'revoked' },
      });
    });

    it('a dependent with no real guardianship row is pending with no row to verify', async () => {
      const db = makeDb();
      db.dependent_profiles.findMany.mockResolvedValue([
        { user_id: dependentA },
      ]);
      db.guardianships.findMany.mockResolvedValue([]);

      const blocks = await gate.loadConsentBlocks(asDb(db), [dependentA]);

      expect(blocks.get(dependentA)).toEqual({
        required: true,
        dependent: true,
        guardianship_id: null,
        status: 'pending',
        evidence_uploaded: false,
        guardians: [],
      });
    });

    it('lists the primary first and names club custody and external holders', async () => {
      const db = makeDb();
      db.dependent_profiles.findMany.mockResolvedValue([
        { user_id: dependentA },
      ]);
      db.guardianships.findMany.mockResolvedValue([
        row({
          guardianship_id: 'g-secondary',
          is_primary: false,
          guardian: { name: 'Ana', paternal_last_name: 'Ruiz' },
          relationship_type: { name: 'Tía' },
        }),
        row({
          guardianship_id: 'g-custody',
          is_primary: true,
          is_custodian: true,
          guardian: null,
          relationship_type: null,
          custodian_club: { name: 'Club Central' },
        }),
        row({
          guardianship_id: 'g-external',
          is_primary: false,
          guardian: null,
          external_name: 'Abuela Rosa',
          relationship_type: null,
        }),
      ]);

      const block = (await gate.loadConsentBlocks(asDb(db), [dependentA])).get(
        dependentA,
      );

      expect(block?.guardianship_id).toBe('g-custody');
      expect(block?.guardians).toEqual([
        {
          display_name: 'Club Central',
          relationship_type_name: null,
          is_primary: true,
        },
        {
          display_name: 'Ana Ruiz',
          relationship_type_name: 'Tía',
          is_primary: false,
        },
        {
          display_name: 'Abuela Rosa',
          relationship_type_name: null,
          is_primary: false,
        },
      ]);
    });
  });
});

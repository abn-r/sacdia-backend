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
});

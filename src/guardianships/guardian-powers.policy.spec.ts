import { ErrorCode } from '../common/errors/error-codes';
import { GuardianPowersPolicy } from './guardian-powers.policy';

const G = 'gggggggg-0000-4000-8000-000000000001';
const D = 'dddddddd-0000-4000-8000-000000000001';

function setup(row: unknown) {
  const prisma: any = {
    guardianships: { findFirst: jest.fn().mockResolvedValue(row) },
  };
  return { policy: new GuardianPowersPolicy(prisma), prisma };
}

const row = (overrides: Record<string, unknown> = {}) => ({
  guardianship_id: 'gs-1',
  dependent_user_id: D,
  guardian_user_id: G,
  consent_status: 'verified',
  ...overrides,
});

describe('GuardianPowersPolicy.assertVerifiedGuardian', () => {
  it('returns the row of an active, verified, non-custodian guardian', async () => {
    const { policy } = setup(row());
    await expect(policy.assertVerifiedGuardian(G, D)).resolves.toEqual({
      guardianship_id: 'gs-1',
      dependent_user_id: D,
      guardian_user_id: G,
    });
  });

  it('queries only real, non-test, non-custodian, non-revoked rows of a visible dependent', async () => {
    const { policy, prisma } = setup(row());
    await policy.assertVerifiedGuardian(G, D);
    expect(prisma.guardianships.findFirst.mock.calls[0][0].where).toEqual({
      dependent_user_id: D,
      guardian_user_id: G,
      is_custodian: false,
      is_test_data: false,
      consent_status: { not: 'revoked' },
      dependent: {
        dependent_profile: { is: { frozen_at: null, purged_at: null } },
      },
    });
  });

  it('a stranger, a custodian, a revoked or a frozen-dependent guardian is a plain 404', async () => {
    const { policy } = setup(null);
    await expect(policy.assertVerifiedGuardian(G, D)).rejects.toMatchObject({
      code: ErrorCode.GUARDIANSHIP_NOT_FOUND,
      status: 404,
    });
  });

  it('a PENDING guardian gets 403 GUARDIANSHIP_CONSENT_NOT_VERIFIED for control powers', async () => {
    const { policy } = setup(row({ consent_status: 'pending' }));
    await expect(policy.assertVerifiedGuardian(G, D)).rejects.toMatchObject({
      code: ErrorCode.GUARDIANSHIP_CONSENT_NOT_VERIFIED,
      status: 403,
    });
  });

  it('a PENDING guardian gets 409 for the summary (R4)', async () => {
    const { policy } = setup(row({ consent_status: 'pending' }));
    await expect(
      policy.assertVerifiedGuardian(G, D, { pending: 'conflict' }),
    ).rejects.toMatchObject({
      code: ErrorCode.GUARDIANSHIP_CONSENT_NOT_VERIFIED,
      status: 409,
    });
  });

  it('an external named guardian without a user is never a holder of powers', async () => {
    const { policy } = setup(row({ guardian_user_id: null }));
    await expect(policy.assertVerifiedGuardian(G, D)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('uses the given transaction client when passed', async () => {
    const { policy, prisma } = setup(null);
    const tx: any = {
      guardianships: { findFirst: jest.fn().mockResolvedValue(row()) },
    };
    await policy.assertVerifiedGuardian(G, D, { db: tx });
    expect(tx.guardianships.findFirst).toHaveBeenCalled();
    expect(prisma.guardianships.findFirst).not.toHaveBeenCalled();
  });
});

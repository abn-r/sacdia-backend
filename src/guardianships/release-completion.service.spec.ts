import { ReleaseCompletionService } from './release-completion.service';

const NOW = new Date('2026-11-20T12:00:00.000Z');

function setup(
  profile: Record<string, unknown> | null,
  email: string | null,
  updated = 1,
) {
  const audit = { recordEventOrThrow: jest.fn().mockResolvedValue(undefined) };
  const tx = {
    dependent_profiles: {
      findUnique: jest.fn().mockResolvedValue(profile),
      updateMany: jest.fn().mockResolvedValue({ count: updated }),
    },
    users: { findUnique: jest.fn().mockResolvedValue({ email }) },
  };
  const service = new ReleaseCompletionService(audit as never);
  return { service, tx, audit };
}

const accepted = {
  purged_at: null,
  frozen_at: null,
  frozen_reason: null,
  release_accepted_at: new Date('2026-11-10T00:00:00.000Z'),
  release_completed_at: null,
};

describe('ReleaseCompletionService.tryComplete', () => {
  it('completes when accepted AND an email is on file (unverified is enough, R5)', async () => {
    const { service, tx, audit } = setup(accepted, 'a@b.c');
    await expect(service.tryComplete(tx as never, 'u1', NOW)).resolves.toEqual({
      completed: true,
      thawed: false,
    });
    expect(tx.dependent_profiles.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { release_completed_at: NOW },
      }),
    );
    expect(audit.recordEventOrThrow).toHaveBeenCalledTimes(1);
    expect(audit.recordEventOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'family.release.completed' }),
      tx,
    );
  });

  it('does not complete without an email (accepted only)', async () => {
    const { service, tx } = setup(accepted, null);
    await expect(service.tryComplete(tx as never, 'u1', NOW)).resolves.toEqual({
      completed: false,
      thawed: false,
    });
    expect(tx.dependent_profiles.updateMany).not.toHaveBeenCalled();
  });

  it('does not complete without acceptance, when purged or already completed', async () => {
    for (const profile of [
      { ...accepted, release_accepted_at: null },
      { ...accepted, purged_at: new Date() },
      { ...accepted, release_completed_at: new Date() },
      null,
    ]) {
      const { service, tx } = setup(profile, 'a@b.c');
      const result = await service.tryComplete(tx as never, 'u1', NOW);
      expect(result.completed).toBe(false);
      expect(tx.dependent_profiles.updateMany).not.toHaveBeenCalled();
    }
  });

  it('THAW (R1): a majority-release freeze is cleared on completion, with the thawed audit', async () => {
    const { service, tx, audit } = setup(
      {
        ...accepted,
        frozen_at: new Date('2026-11-05T00:00:00.000Z'),
        frozen_reason: 'majority_release',
      },
      'a@b.c',
    );
    await expect(service.tryComplete(tx as never, 'u1', NOW)).resolves.toEqual({
      completed: true,
      thawed: true,
    });
    expect(tx.dependent_profiles.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          release_completed_at: NOW,
          frozen_at: null,
          purge_after: null,
          frozen_reason: null,
        },
      }),
    );
    expect(audit.recordEventOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'family.release.thawed' }),
      tx,
    );
  });

  it('THAW: a teen paused as pending_guardian that reached majority also thaws on completion', async () => {
    const { service, tx } = setup(
      {
        ...accepted,
        frozen_at: new Date('2026-11-05T00:00:00.000Z'),
        frozen_reason: 'pending_guardian',
      },
      'a@b.c',
    );
    await expect(service.tryComplete(tx as never, 'u1', NOW)).resolves.toEqual({
      completed: true,
      thawed: true,
    });
    expect(tx.dependent_profiles.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { frozen_at: null },
            {
              frozen_reason: { in: ['majority_release', 'pending_guardian'] },
            },
          ],
        }),
      }),
    );
  });

  it('accepted but frozen WITHOUT email stays frozen-with-acceptance (no completion)', async () => {
    const { service, tx } = setup(
      {
        ...accepted,
        frozen_at: new Date(),
        frozen_reason: 'majority_release',
      },
      null,
    );
    const result = await service.tryComplete(tx as never, 'u1', NOW);
    expect(result).toEqual({ completed: false, thawed: false });
    expect(tx.dependent_profiles.updateMany).not.toHaveBeenCalled();
  });

  it('never thaws a LEGACY freeze (frozen_reason NULL)', async () => {
    const { service, tx } = setup(
      { ...accepted, frozen_at: new Date(), frozen_reason: null },
      'a@b.c',
    );
    const result = await service.tryComplete(tx as never, 'u1', NOW);
    expect(result).toEqual({ completed: false, thawed: false });
    expect(tx.dependent_profiles.updateMany).not.toHaveBeenCalled();
  });

  it('a lost race (0 rows updated) completes nothing and writes no audit', async () => {
    const { service, tx, audit } = setup(accepted, 'a@b.c', 0);
    const result = await service.tryComplete(tx as never, 'u1', NOW);
    expect(result.completed).toBe(false);
    expect(audit.recordEventOrThrow).not.toHaveBeenCalled();
  });
});

import { StorageBucketAlias } from '../common/services/file-storage.service';
import {
  DEPENDENT_PROFILES_PURGE_JOB,
  DependentProfilesPurgeCronService,
} from './dependent-profiles-purge-cron.service';

const D1 = 'dddddddd-0000-4000-8000-000000000001';
const D2 = 'dddddddd-0000-4000-8000-000000000002';

function setup() {
  const tx: any = {
    users: { update: jest.fn().mockResolvedValue({}) },
    emergency_contacts: { deleteMany: jest.fn().mockResolvedValue({}) },
    users_allergies: { deleteMany: jest.fn().mockResolvedValue({}) },
    users_diseases: { deleteMany: jest.fn().mockResolvedValue({}) },
    users_medicines: { deleteMany: jest.fn().mockResolvedValue({}) },
    guardianship_consent_evidences: {
      deleteMany: jest.fn().mockResolvedValue({}),
    },
    legal_acceptances: { updateMany: jest.fn().mockResolvedValue({}) },
    dependent_profiles: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    dependent_profiles: { findMany: jest.fn().mockResolvedValue([]) },
    guardianship_consent_evidences: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    users: { findUnique: jest.fn().mockResolvedValue({ user_image: null }) },
    $transaction: jest.fn(async (fn: (t: any) => unknown) => fn(tx)),
  };
  const lock = {
    tryAcquire: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const cronLogger = {
    track: jest.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
    trackSkipped: jest.fn().mockResolvedValue(undefined),
  };
  const cache = { bump: jest.fn().mockResolvedValue(undefined) };
  const fileStorage = {
    deleteMany: jest.fn().mockResolvedValue(undefined),
    extractKeyFromPublicUrl: jest.fn(),
  };
  const service = new DependentProfilesPurgeCronService(
    prisma,
    lock as any,
    cronLogger as any,
    cache as any,
    fileStorage as any,
  );
  return { service, prisma, tx, lock, cronLogger, cache, fileStorage };
}

describe('DependentProfilesPurgeCronService scheduling and locking', () => {
  it('runs daily at 04:20 UTC under the documented job name', () => {
    const metadata = (key: string) =>
      Reflect.getMetadata(
        key,
        DependentProfilesPurgeCronService.prototype.handlePurge,
      );
    expect(DEPENDENT_PROFILES_PURGE_JOB).toBe('dependent-profiles-purge');
    expect(metadata('SCHEDULE_CRON_OPTIONS')).toMatchObject({
      cronTime: '20 4 * * *',
      name: 'dependent-profiles-purge',
      timeZone: 'UTC',
    });
  });

  it('takes the 23h lock, tracks the run and always releases', async () => {
    const { service, lock, cronLogger } = setup();
    await service.handlePurge();
    expect(lock.tryAcquire).toHaveBeenCalledWith(
      'cron:dependent-profiles-purge',
      23 * 60 * 60 * 1000,
    );
    expect(cronLogger.track).toHaveBeenCalledWith(
      'dependent-profiles-purge',
      expect.any(Function),
    );
    expect(lock.release).toHaveBeenCalledWith('cron:dependent-profiles-purge');
  });

  it('two instances, one runner: the loser records a skip and touches nothing', async () => {
    const { service, lock, cronLogger, prisma } = setup();
    lock.tryAcquire.mockResolvedValue(false);

    await service.handlePurge();

    expect(cronLogger.trackSkipped).toHaveBeenCalledWith(
      'dependent-profiles-purge',
      'lock_not_acquired',
    );
    expect(cronLogger.track).not.toHaveBeenCalled();
    expect(prisma.dependent_profiles.findMany).not.toHaveBeenCalled();
    expect(lock.release).not.toHaveBeenCalled();
  });

  it('releases the lock even when the run blows up', async () => {
    const { service, lock, cronLogger } = setup();
    cronLogger.track.mockRejectedValue(new Error('boom'));
    await expect(service.handlePurge()).resolves.toBeUndefined();
    expect(lock.release).toHaveBeenCalled();
  });

  it('reports the run as failed when a dependent could not be purged', async () => {
    const { service, prisma, fileStorage, cronLogger } = setup();
    prisma.dependent_profiles.findMany
      .mockResolvedValueOnce([{ user_id: D1 }])
      .mockResolvedValue([]);
    prisma.guardianship_consent_evidences.findMany.mockResolvedValue([
      { file_key: 'k1' },
    ]);
    fileStorage.deleteMany.mockRejectedValue(new Error('R2 down'));

    await service.handlePurge();

    // The fn handed to track() threw, so cron_run_log marks it failed.
    const trackFn = cronLogger.track.mock.calls[0][1] as () => Promise<unknown>;
    prisma.dependent_profiles.findMany
      .mockResolvedValueOnce([{ user_id: D1 }])
      .mockResolvedValue([]);
    await expect(trackFn()).rejects.toThrow(/could not be purged/);
  });
});

describe('DependentProfilesPurgeCronService selection', () => {
  it('selects frozen, not yet purged dependents whose purge date passed', async () => {
    const { service, prisma } = setup();
    const now = new Date('2027-01-15T04:20:00.000Z');

    await service.purgeDue(now);

    expect(prisma.dependent_profiles.findMany).toHaveBeenCalledWith({
      where: {
        frozen_at: { not: null },
        purged_at: null,
        purge_after: { lte: now },
      },
      orderBy: { purge_after: 'asc' },
      take: 100,
      select: { user_id: true },
    });
  });

  it('leaves dependents with a future purge date untouched (nothing selected)', async () => {
    const { service, prisma, tx } = setup();
    prisma.dependent_profiles.findMany.mockResolvedValue([]);
    const summary = await service.purgeDue();
    expect(summary).toEqual({ purged: 0, failed: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.users.update).not.toHaveBeenCalled();
  });

  it('processes in batches of 100 until a short batch', async () => {
    const { service, prisma } = setup();
    const full = Array.from({ length: 100 }, (_, i) => ({ user_id: `u-${i}` }));
    prisma.dependent_profiles.findMany
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([{ user_id: 'u-last' }]);

    const summary = await service.purgeDue();

    expect(prisma.dependent_profiles.findMany).toHaveBeenCalledTimes(2);
    expect(summary).toEqual({ purged: 101, failed: 0 });
  });

  it('does not loop forever on a dependent that keeps failing', async () => {
    const { service, prisma, fileStorage } = setup();
    prisma.guardianship_consent_evidences.findMany.mockResolvedValue([
      { file_key: 'k' },
    ]);
    fileStorage.deleteMany.mockRejectedValue(new Error('R2 down'));
    const full = Array.from({ length: 100 }, (_, i) => ({ user_id: `u-${i}` }));
    prisma.dependent_profiles.findMany
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([]);

    const summary = await service.purgeDue();

    expect(summary).toEqual({ purged: 0, failed: 100 });
    // The second query excludes the 100 that failed.
    const secondWhere =
      prisma.dependent_profiles.findMany.mock.calls[1][0].where;
    expect(secondWhere.user_id.notIn).toHaveLength(100);
  });
});

describe('DependentProfilesPurgeCronService purge action (ruling A9)', () => {
  it('anonymizes the users row, hard-deletes personal data and sets purged_at, in ONE transaction', async () => {
    const { service, prisma, tx, cache } = setup();
    const now = new Date('2027-01-15T04:20:00.000Z');
    prisma.dependent_profiles.findMany
      .mockResolvedValueOnce([{ user_id: D1 }])
      .mockResolvedValue([]);

    await service.purgeDue(now);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.users.update).toHaveBeenCalledWith({
      where: { user_id: D1 },
      data: expect.objectContaining({
        active: false,
        email: null,
        name: null,
        paternal_last_name: null,
        maternal_last_name: null,
        birthday: null,
        user_image: null,
      }),
    });
    for (const model of [
      tx.users_allergies,
      tx.users_diseases,
      tx.users_medicines,
    ]) {
      expect(model.deleteMany).toHaveBeenCalledWith({ where: { user_id: D1 } });
    }
    expect(tx.emergency_contacts.deleteMany).toHaveBeenCalledWith({
      where: { owner_id: D1 },
    });
    expect(tx.guardianship_consent_evidences.deleteMany).toHaveBeenCalledWith({
      where: { guardianship: { dependent_user_id: D1 } },
    });
    expect(tx.legal_acceptances.updateMany).toHaveBeenCalledWith({
      where: { user_id: D1 },
      data: { ip_address: null, user_agent: null },
    });
    expect(tx.dependent_profiles.update).toHaveBeenCalledWith({
      where: { user_id: D1 },
      data: { purged_at: now },
    });
    // The users row is anonymized, never hard-deleted.
    expect(tx.users.delete).toBeUndefined();
    expect(cache.bump).toHaveBeenCalledWith(D1);
  });

  it('deletes the evidence objects and the profile picture from R2 BEFORE touching the database', async () => {
    const { service, prisma, fileStorage } = setup();
    prisma.dependent_profiles.findMany
      .mockResolvedValueOnce([{ user_id: D1 }])
      .mockResolvedValue([]);
    prisma.guardianship_consent_evidences.findMany.mockResolvedValue([
      { file_key: 'guardianships/consent/g1/a.pdf' },
      { file_key: 'guardianships/consent/g1/b.jpg' },
    ]);
    prisma.users.findUnique.mockResolvedValue({
      user_image: 'https://cdn/profiles/ana.jpg',
    });
    fileStorage.extractKeyFromPublicUrl.mockReturnValue('profiles/ana.jpg');

    await service.purgeDue();

    expect(fileStorage.deleteMany).toHaveBeenCalledWith(
      StorageBucketAlias.GUARDIANSHIP_EVIDENCE,
      ['guardianships/consent/g1/a.pdf', 'guardianships/consent/g1/b.jpg'],
    );
    expect(fileStorage.deleteMany).toHaveBeenCalledWith(
      StorageBucketAlias.USER_PROFILES,
      ['profiles/ana.jpg'],
    );
    for (const call of fileStorage.deleteMany.mock.invocationCallOrder) {
      expect(call).toBeLessThan(
        prisma.$transaction.mock.invocationCallOrder[0],
      );
    }
  });

  it('does not call R2 for the evidence bucket when there is no evidence (bucket may be unset)', async () => {
    const { service, prisma, fileStorage } = setup();
    prisma.dependent_profiles.findMany
      .mockResolvedValueOnce([{ user_id: D1 }])
      .mockResolvedValue([]);
    await service.purgeDue();
    expect(fileStorage.deleteMany).not.toHaveBeenCalled();
  });

  it('an R2 failure leaves the dependent untouched: no DB writes, purged_at NOT set, retried next run', async () => {
    const { service, prisma, tx, fileStorage, cache } = setup();
    prisma.dependent_profiles.findMany
      .mockResolvedValueOnce([{ user_id: D1 }, { user_id: D2 }])
      .mockResolvedValue([]);
    prisma.guardianship_consent_evidences.findMany
      .mockResolvedValueOnce([{ file_key: 'k1' }])
      .mockResolvedValueOnce([]);
    fileStorage.deleteMany.mockRejectedValueOnce(new Error('R2 down'));

    const summary = await service.purgeDue();

    expect(summary).toEqual({ purged: 1, failed: 1 });
    // D1 failed: nothing written for it; only D2 reached the transaction.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.dependent_profiles.update).toHaveBeenCalledTimes(1);
    expect(tx.dependent_profiles.update).toHaveBeenCalledWith({
      where: { user_id: D2 },
      data: { purged_at: expect.any(Date) },
    });
    expect(cache.bump).toHaveBeenCalledTimes(1);
  });

  it('a database failure also leaves purged_at unset and is counted', async () => {
    const { service, prisma } = setup();
    prisma.dependent_profiles.findMany
      .mockResolvedValueOnce([{ user_id: D1 }])
      .mockResolvedValue([]);
    prisma.$transaction.mockRejectedValueOnce(new Error('deadlock'));
    expect(await service.purgeDue()).toEqual({ purged: 0, failed: 1 });
  });
});

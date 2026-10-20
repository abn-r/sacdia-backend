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
    evidence_files: { deleteMany: jest.fn().mockResolvedValue({}) },
    requirement_evidence: { deleteMany: jest.fn().mockResolvedValue({}) },
    users_honors: { updateMany: jest.fn().mockResolvedValue({}) },
    notification_deliveries: { deleteMany: jest.fn().mockResolvedValue({}) },
    guardianships: { updateMany: jest.fn().mockResolvedValue({}) },
    dependent_profiles: { update: jest.fn().mockResolvedValue({}) },
    account: { deleteMany: jest.fn().mockResolvedValue({}) },
    session: { deleteMany: jest.fn().mockResolvedValue({}) },
    verification: { deleteMany: jest.fn().mockResolvedValue({}) },
    user_fcm_tokens: { deleteMany: jest.fn().mockResolvedValue({}) },
    supervised_logins: { updateMany: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    dependent_profiles: { findMany: jest.fn().mockResolvedValue([]) },
    guardianship_consent_evidences: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    users: { findUnique: jest.fn().mockResolvedValue({ user_image: null }) },
    evidence_files: { findMany: jest.fn().mockResolvedValue([]) },
    requirement_evidence: { findMany: jest.fn().mockResolvedValue([]) },
    users_honors: { findMany: jest.fn().mockResolvedValue([]) },
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
    extractKeyFromPublicUrl: jest.fn().mockReturnValue(null),
  };
  const deviceRevoker = {
    revokeAllForDependent: jest.fn().mockResolvedValue(0),
    revokeByGuardianship: jest.fn().mockResolvedValue(0),
  };
  const service = new DependentProfilesPurgeCronService(
    prisma,
    lock as any,
    cronLogger as any,
    cache as any,
    fileStorage as any,
    deviceRevoker,
  );
  return {
    service,
    prisma,
    tx,
    lock,
    cronLogger,
    cache,
    fileStorage,
    deviceRevoker,
  };
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

describe('DependentProfilesPurgeCronService evidence, inbox and holder data (ruling S7)', () => {
  const dueOnce = (prisma: any) =>
    prisma.dependent_profiles.findMany
      .mockResolvedValueOnce([{ user_id: D1 }])
      .mockResolvedValue([]);

  /** Public URL -> key, the way R2FileStorageService does it. */
  const keyFromUrl = (_bucket: StorageBucketAlias, url: string) =>
    url.startsWith('https://cdn/') ? url.slice('https://cdn/'.length) : null;

  it('scopes every read to the dependent', async () => {
    const { service, prisma } = setup();
    dueOnce(prisma);

    await service.purgeDue();

    expect(prisma.evidence_files.findMany.mock.calls[0][0].where).toEqual({
      OR: [
        { class_section_progress: { is: { user_id: D1 } } },
        { users_honors: { is: { user_id: D1 } } },
      ],
    });
    expect(prisma.requirement_evidence.findMany.mock.calls[0][0].where).toEqual(
      { progress: { users_honors: { user_id: D1 } } },
    );
    expect(prisma.users_honors.findMany.mock.calls[0][0].where).toEqual({
      user_id: D1,
    });
  });

  it('deletes class evidence, honor requirement evidence and honor files from their buckets', async () => {
    const { service, prisma, fileStorage } = setup();
    dueOnce(prisma);
    fileStorage.extractKeyFromPublicUrl.mockImplementation(keyFromUrl);
    prisma.evidence_files.findMany.mockResolvedValue([
      {
        file_url: 'https://cdn/class-evidence/1-1.jpg',
        section_progress_id: 7,
      },
      { file_url: 'https://cdn/honor/legacy.jpg', section_progress_id: null },
    ]);
    prisma.requirement_evidence.findMany.mockResolvedValue([
      {
        url: 'https://cdn/requirement_evidence/u/1/2/3.png',
        evidence_type: 'IMAGE',
      },
      { url: 'requirement_evidence/u/1/2/4.pdf', evidence_type: 'FILE' },
      { url: 'https://youtu.be/external', evidence_type: 'LINK' },
    ]);
    prisma.users_honors.findMany.mockResolvedValue([
      {
        certificate: 'https://cdn/cert-1.pdf',
        document: 'https://cdn/doc-1.pdf',
        images: ['https://cdn/img-1.jpg', 'https://cdn/img-2.jpg'],
      },
      { certificate: '', document: null, images: [] },
    ]);

    await service.purgeDue();

    const deleted = (bucket: StorageBucketAlias) =>
      fileStorage.deleteMany.mock.calls
        .filter(([alias]: any[]) => alias === bucket)
        .flatMap(([, keys]: any[]) => keys)
        .sort();
    expect(deleted(StorageBucketAlias.CLASS_EVIDENCE)).toEqual([
      'class-evidence/1-1.jpg',
    ]);
    expect(deleted(StorageBucketAlias.EVIDENCE_FILES)).toEqual([
      'requirement_evidence/u/1/2/3.png',
      'requirement_evidence/u/1/2/4.pdf',
    ]);
    expect(deleted(StorageBucketAlias.USERS_HONORS_CERT)).toEqual([
      'cert-1.pdf',
    ]);
    expect(deleted(StorageBucketAlias.USERS_HONORS)).toEqual([
      'doc-1.pdf',
      'honor/legacy.jpg',
      'img-1.jpg',
      'img-2.jpg',
    ]);
    // A LINK is an external URL: no object, nothing to delete.
    for (const [, keys] of fileStorage.deleteMany.mock.calls) {
      expect(keys).not.toContain('https://youtu.be/external');
    }
  });

  it('sends certificate-import objects to their own bucket', async () => {
    const { service, prisma, fileStorage } = setup();
    dueOnce(prisma);
    const importKey = `batches/${'a'.repeat(8)}-aaaa-4aaa-8aaa-${'a'.repeat(12)}/sealed/f-1.pdf`;
    prisma.users_honors.findMany.mockResolvedValue([
      { certificate: importKey, document: null, images: [] },
    ]);

    await service.purgeDue();

    expect(fileStorage.deleteMany).toHaveBeenCalledWith(
      StorageBucketAlias.CERTIFICATE_IMPORTS,
      [importKey],
    );
  });

  it('removes duplicates and never calls a bucket that has nothing to delete', async () => {
    const { service, prisma, fileStorage } = setup();
    dueOnce(prisma);
    prisma.evidence_files.findMany.mockResolvedValue([
      { file_url: 'k/a.jpg', section_progress_id: 1 },
      { file_url: 'k/a.jpg', section_progress_id: 2 },
    ]);

    await service.purgeDue();

    expect(fileStorage.deleteMany).toHaveBeenCalledTimes(1);
    expect(fileStorage.deleteMany).toHaveBeenCalledWith(
      StorageBucketAlias.CLASS_EVIDENCE,
      ['k/a.jpg'],
    );
  });

  it('an R2 failure on class evidence leaves the whole dependent untouched', async () => {
    const { service, prisma, tx, fileStorage, cache } = setup();
    dueOnce(prisma);
    prisma.evidence_files.findMany.mockResolvedValue([
      { file_url: 'k/a.jpg', section_progress_id: 1 },
    ]);
    fileStorage.deleteMany.mockRejectedValue(new Error('R2 down'));

    expect(await service.purgeDue()).toEqual({ purged: 0, failed: 1 });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.evidence_files.deleteMany).not.toHaveBeenCalled();
    expect(tx.notification_deliveries.deleteMany).not.toHaveBeenCalled();
    expect(cache.bump).not.toHaveBeenCalled();
  });

  it('in ONE transaction deletes the evidence rows and inbox rows and blanks holder contact data and honor files', async () => {
    const { service, prisma, tx } = setup();
    dueOnce(prisma);

    await service.purgeDue();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.evidence_files.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { class_section_progress: { is: { user_id: D1 } } },
          { users_honors: { is: { user_id: D1 } } },
        ],
      },
    });
    expect(tx.requirement_evidence.deleteMany).toHaveBeenCalledWith({
      where: { progress: { users_honors: { user_id: D1 } } },
    });
    expect(tx.users_honors.updateMany).toHaveBeenCalledWith({
      where: { user_id: D1 },
      data: { certificate: '', document: null, images: [] },
    });
    expect(tx.notification_deliveries.deleteMany).toHaveBeenCalledWith({
      where: { user_id: D1 },
    });
    expect(tx.guardianships.updateMany).toHaveBeenCalledWith({
      where: { dependent_user_id: D1 },
      data: { external_name: null, external_phone: null },
    });
    // The guardianship rows themselves are kept as legal history.
    expect(tx.guardianships).not.toHaveProperty('deleteMany');
  });
});

describe('DependentProfilesPurgeCronService account-holder path (3a teen)', () => {
  function teen(ctx: ReturnType<typeof setup>, email: string | null) {
    ctx.prisma.dependent_profiles.findMany
      .mockResolvedValueOnce([{ user_id: D1 }])
      .mockResolvedValue([]);
    ctx.prisma.users.findUnique.mockResolvedValue({
      user_image: null,
      email,
      account: [{ id: 'acc-1' }],
    });
  }

  it('deletes credentials, OAuth accounts, verifications, sessions and FCM tokens, and frees the handle', async () => {
    const ctx = setup();
    teen(ctx, 'ana@example.com');

    await ctx.service.purgeDue();

    const { tx } = ctx;
    expect(tx.account.deleteMany).toHaveBeenCalledWith({
      where: { userId: D1 },
    });
    expect(tx.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: D1 },
    });
    expect(tx.user_fcm_tokens.deleteMany).toHaveBeenCalledWith({
      where: { user_id: D1 },
    });
    const verification = tx.verification.deleteMany.mock.calls[0][0].where.OR;
    expect(verification).toEqual(
      expect.arrayContaining([
        { value: D1 },
        { identifier: 'ana@example.com' },
      ]),
    );
    // CHECK: method='handle' requires a handle, so both change together.
    expect(tx.supervised_logins.updateMany).toHaveBeenCalledWith({
      where: { user_id: D1 },
      data: { method: 'email', login_handle: null },
    });
    // The users row stays (foreign keys) with the email nulled: reusable.
    expect(tx.users.update).toHaveBeenCalledWith({
      where: { user_id: D1 },
      data: expect.objectContaining({ email: null, active: false }),
    });
    expect(tx.dependent_profiles.update).toHaveBeenCalled();
    expect(ctx.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('works for a handle teen without an email', async () => {
    const ctx = setup();
    teen(ctx, null);
    await ctx.service.purgeDue();
    const where = ctx.tx.verification.deleteMany.mock.calls[0][0].where.OR;
    expect(where).toHaveLength(2);
    expect(ctx.tx.account.deleteMany).toHaveBeenCalled();
  });

  it('leaves the no-account dependent path unchanged', async () => {
    const ctx = setup();
    ctx.prisma.dependent_profiles.findMany
      .mockResolvedValueOnce([{ user_id: D1 }])
      .mockResolvedValue([]);

    await ctx.service.purgeDue();

    for (const model of [
      ctx.tx.account,
      ctx.tx.session,
      ctx.tx.verification,
      ctx.tx.supervised_logins,
    ]) {
      expect(
        Object.values(model).every((fn: any) => !fn.mock.calls.length),
      ).toBe(true);
    }
  });

  it('a credential failure rolls the purge back: purged_at is not set and the next run retries', async () => {
    const ctx = setup();
    teen(ctx, 'ana@example.com');
    ctx.tx.account.deleteMany.mockRejectedValue(new Error('db'));

    const summary = await ctx.service.purgeDue();

    expect(summary).toEqual({ purged: 0, failed: 1 });
    expect(ctx.cache.bump).not.toHaveBeenCalled();
  });

  it('revokes the linked devices of the child inside the SAME transaction and deletes the push tokens they registered (3b)', async () => {
    const ctx = setup();
    ctx.prisma.dependent_profiles.findMany
      .mockResolvedValueOnce([{ user_id: D1 }])
      .mockResolvedValue([]);

    await ctx.service.purgeDue();

    expect(ctx.deviceRevoker.revokeAllForDependent).toHaveBeenCalledWith(
      ctx.tx,
      D1,
      'dependent_frozen',
    );
    expect(ctx.tx.user_fcm_tokens.deleteMany).toHaveBeenCalledWith({
      where: { user_id: D1 },
    });
    // The revoke happens before the profile is marked purged.
    const revokeOrder =
      ctx.deviceRevoker.revokeAllForDependent.mock.invocationCallOrder[0];
    const purgedOrder =
      ctx.tx.dependent_profiles.update.mock.invocationCallOrder[0];
    expect(revokeOrder).toBeLessThan(purgedOrder);
  });

  it('a device revoke failure rolls the purge back (retried next run)', async () => {
    const ctx = setup();
    ctx.prisma.dependent_profiles.findMany
      .mockResolvedValueOnce([{ user_id: D1 }])
      .mockResolvedValue([]);
    ctx.deviceRevoker.revokeAllForDependent.mockRejectedValue(new Error('db'));

    const summary = await ctx.service.purgeDue();

    expect(summary).toEqual({ purged: 0, failed: 1 });
    expect(ctx.cache.bump).not.toHaveBeenCalled();
  });
});

import { ErrorCode } from '../common/errors/error-codes';
import { GuardianshipLifecycleService } from './guardianship-lifecycle.service';

const DEP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
const DAY = 24 * 60 * 60 * 1000;

function row(overrides: Record<string, unknown> = {}) {
  return {
    guardianship_id: 'gs-1',
    dependent_user_id: DEP,
    guardian_user_id: G1,
    is_primary: true,
    consent_status: 'pending',
    verification_method: null,
    verified_at: null,
    verified_by_user_id: null,
    ...overrides,
  };
}

function setup() {
  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    guardianships: {
      findUnique: jest.fn().mockResolvedValue({ dependent_user_id: DEP }),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    guardianship_link_codes: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    club_role_assignments: { findMany: jest.fn().mockResolvedValue([]) },
    dependent_profiles: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    users: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ name: 'Ana', paternal_last_name: 'Pérez' }),
    },
    // Dependents are guardian-managed children (no account) unless a test says
    // otherwise.
    account: { count: jest.fn().mockResolvedValue(0) },
    supervised_logins: { upsert: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    ...tx,
    $transaction: jest.fn(async (callback: (t: any) => unknown) =>
      callback(tx),
    ),
  };
  const cache = { bump: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    sendToSectionRole: jest.fn().mockResolvedValue(undefined),
  };
  const deviceRevoker = {
    revokeAllForDependent: jest.fn().mockResolvedValue(0),
    revokeByGuardianship: jest.fn().mockResolvedValue(0),
  };
  const service = new GuardianshipLifecycleService(
    prisma,
    cache as any,
    notifications as any,
    deviceRevoker as any,
  );
  return { service, tx, prisma, cache, notifications, deviceRevoker };
}

const assignment = (status: string, mainClubId: number | null = 9) => ({
  assignment_id: `a-${status}`,
  status,
  club_section_id: 5,
  club_sections: { main_club_id: mainClubId },
});

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; getStatus?: () => number };
  }
  return undefined;
}

describe('GuardianshipLifecycleService.detachRow', () => {
  it('revokes the row with the reason and the timestamp', async () => {
    const { service, tx } = setup();
    tx.guardianships.findMany.mockResolvedValue([
      { guardianship_id: 'gs-2', is_primary: true },
    ]);

    await service.detachRow(tx, row(), 'guardian_left');

    expect(tx.guardianships.update).toHaveBeenCalledWith({
      where: { guardianship_id: 'gs-1' },
      data: {
        consent_status: 'revoked',
        revoked_at: expect.any(Date),
        revoked_reason: 'guardian_left',
        modified_at: expect.any(Date),
      },
    });
  });

  it('revokes the open link codes the leaver issued', async () => {
    const { service, tx } = setup();
    await service.detachRow(tx, row(), 'guardian_left');
    expect(tx.guardianship_link_codes.updateMany).toHaveBeenCalledWith({
      where: {
        dependent_user_id: DEP,
        issued_by_user_id: G1,
        consumed_at: null,
        revoked_at: null,
      },
      data: { revoked_at: expect.any(Date) },
    });
  });

  it('secondary leaves: other_guardian and the primary is untouched', async () => {
    const { service, tx } = setup();
    tx.guardianships.findMany.mockResolvedValue([
      { guardianship_id: 'gs-primary', is_primary: true },
    ]);

    const result = await service.detachRow(
      tx,
      row({ guardianship_id: 'gs-sec', is_primary: false }),
      'guardian_left',
    );

    expect(result.outcome).toBe('other_guardian');
    expect(tx.guardianships.update).toHaveBeenCalledTimes(1);
    expect(tx.guardianships.create).not.toHaveBeenCalled();
  });

  it('primary leaves with secondaries: the OLDEST secondary becomes primary', async () => {
    const { service, tx } = setup();
    tx.guardianships.findMany.mockResolvedValue([
      { guardianship_id: 'gs-oldest', is_primary: false },
      { guardianship_id: 'gs-newer', is_primary: false },
    ]);

    const result = await service.detachRow(tx, row(), 'guardian_left');

    expect(result.outcome).toBe('other_guardian');
    expect(tx.guardianships.findMany.mock.calls[0][0].orderBy).toEqual({
      created_at: 'asc',
    });
    expect(tx.guardianships.update).toHaveBeenLastCalledWith({
      where: { guardianship_id: 'gs-oldest' },
      data: { is_primary: true, modified_at: expect.any(Date) },
    });
  });

  it('last guardian leaves with a club assignment: custodian row inherits the status', async () => {
    const { service, tx } = setup();
    const verifiedAt = new Date('2026-10-01T00:00:00.000Z');
    tx.club_role_assignments.findMany.mockResolvedValue([
      assignment('pending'),
    ]);

    const result = await service.detachRow(
      tx,
      row({
        consent_status: 'verified',
        verification_method: 'director_paper_form',
        verified_at: verifiedAt,
        verified_by_user_id: G2,
      }),
      'guardian_left',
    );

    expect(result).toMatchObject({
      outcome: 'club_custody',
      custodyClubSectionId: 5,
      dependentName: 'Ana Pérez',
    });
    expect(tx.guardianships.create).toHaveBeenCalledWith({
      data: {
        dependent_user_id: DEP,
        guardian_user_id: null,
        is_custodian: true,
        custodian_club_id: 9,
        is_primary: true,
        consent_status: 'verified',
        verification_method: 'director_paper_form',
        verified_at: verifiedAt,
        verified_by_user_id: G2,
      },
    });
    expect(tx.dependent_profiles.updateMany).not.toHaveBeenCalled();
  });

  it('prefers the active assignment over a newer pending one', async () => {
    const { service, tx } = setup();
    tx.club_role_assignments.findMany.mockResolvedValue([
      {
        ...assignment('pending'),
        club_section_id: 7,
        club_sections: { main_club_id: 70 },
      },
      assignment('active'),
    ]);
    const result = await service.detachRow(tx, row(), 'guardian_left');
    expect(result.custodyClubSectionId).toBe(5);
    expect(
      tx.guardianships.create.mock.calls[0][0].data.custodian_club_id,
    ).toBe(9);
  });

  it('does not make the custodian primary when another primary survives', async () => {
    const { service, tx } = setup();
    tx.club_role_assignments.findMany.mockResolvedValue([assignment('active')]);
    tx.guardianships.count.mockResolvedValue(1);
    await service.detachRow(tx, row({ is_primary: false }), 'guardian_left');
    expect(tx.guardianships.create.mock.calls[0][0].data.is_primary).toBe(
      false,
    );
  });

  it('last guardian leaves without a club: the profile is frozen for 90 days', async () => {
    const { service, tx } = setup();
    const before = Date.now();

    const result = await service.detachRow(tx, row(), 'guardian_left');

    expect(result.outcome).toBe('frozen');
    expect(tx.guardianships.create).not.toHaveBeenCalled();
    const call = tx.dependent_profiles.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ user_id: DEP, purged_at: null });
    const purgeAfter = (call.data.purge_after as Date).getTime();
    expect(purgeAfter - (call.data.frozen_at as Date).getTime()).toBe(90 * DAY);
    expect(call.data.frozen_at.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('a section without a main club cannot hold custody: frozen instead', async () => {
    const { service, tx } = setup();
    tx.club_role_assignments.findMany.mockResolvedValue([
      assignment('active', null),
    ]);
    const result = await service.detachRow(tx, row(), 'guardian_left');
    expect(result.outcome).toBe('frozen');
    expect(tx.guardianships.create).not.toHaveBeenCalled();
  });
});

describe('GuardianshipLifecycleService.detachGuardian / afterCommit', () => {
  it('detaches every active row of the guardian with the account-closed reason', async () => {
    const { service, tx } = setup();
    tx.guardianships.findMany
      .mockResolvedValueOnce([
        { dependent_user_id: 'dep-b' },
        { dependent_user_id: 'dep-a' },
      ])
      .mockResolvedValueOnce([
        row({ guardianship_id: 'gs-a', dependent_user_id: 'dep-a' }),
        row({ guardianship_id: 'gs-b', dependent_user_id: 'dep-b' }),
      ])
      .mockResolvedValue([{ guardianship_id: 'other', is_primary: true }]);

    const results = await service.detachGuardian(
      tx,
      G1,
      'guardian_account_closed',
    );

    expect(results.map((r) => r.dependentUserId)).toEqual(['dep-a', 'dep-b']);
    const reasons = tx.guardianships.update.mock.calls
      .map(([arg]: any) => arg.data.revoked_reason)
      .filter(Boolean);
    expect(reasons).toEqual([
      'guardian_account_closed',
      'guardian_account_closed',
    ]);
  });

  it('locks every touched dependent in ascending id order, then re-reads the rows under the locks', async () => {
    const { service, tx } = setup();
    tx.guardianships.findMany
      .mockResolvedValueOnce([
        { dependent_user_id: 'dep-b' },
        { dependent_user_id: 'dep-a' },
        { dependent_user_id: 'dep-a' },
      ])
      .mockResolvedValueOnce([]);

    await service.detachGuardian(tx, G1, 'guardian_account_closed');

    const keys = tx.$executeRaw.mock.calls.map((call: any[]) => call[1]);
    expect(keys).toEqual([
      'guardianships:dependent:dep-a',
      'guardianships:dependent:dep-b',
    ]);
    // candidates, then the authoritative read after the locks
    expect(tx.guardianships.findMany).toHaveBeenCalledTimes(2);
    expect(tx.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(
      tx.guardianships.findMany.mock.invocationCallOrder[1],
    );
  });

  it('does nothing (and takes no lock) for a guardian without dependents', async () => {
    const { service, tx } = setup();
    tx.guardianships.findMany.mockResolvedValueOnce([]);
    await expect(
      service.detachGuardian(tx, G1, 'guardian_account_closed'),
    ).resolves.toEqual([]);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('bumps the epoch of every touched dependent and notifies custody directors', async () => {
    const { service, cache, notifications } = setup();

    await service.afterCommit([
      { guardianshipId: 'a', dependentUserId: 'dep-a', outcome: 'frozen' },
      {
        guardianshipId: 'b',
        dependentUserId: 'dep-b',
        outcome: 'club_custody',
        custodyClubSectionId: 5,
        dependentName: 'Ana Pérez',
      },
    ]);

    expect(cache.bump).toHaveBeenCalledWith('dep-a');
    expect(cache.bump).toHaveBeenCalledWith('dep-b');
    expect(notifications.sendToSectionRole).toHaveBeenCalledTimes(1);
    expect(notifications.sendToSectionRole).toHaveBeenCalledWith(
      5,
      ['director', 'deputy-director'],
      'Un menor quedó bajo custodia del club',
      expect.stringContaining('Ana Pérez'),
      expect.objectContaining({ dependent_user_id: 'dep-b' }),
      'family:custody_transferred',
    );
  });

  it('never throws when the custody notification fails', async () => {
    const { service, notifications } = setup();
    notifications.sendToSectionRole.mockRejectedValue(new Error('fcm down'));
    await expect(
      service.afterCommit([
        {
          guardianshipId: 'b',
          dependentUserId: 'dep-b',
          outcome: 'club_custody',
          custodyClubSectionId: 5,
        },
      ]),
    ).resolves.toBeUndefined();
  });
});

describe('GuardianshipLifecycleService.revoke', () => {
  it('a guardian can leave: returns the outcome and bumps the epoch after commit', async () => {
    const { service, tx, cache, prisma } = setup();
    tx.guardianships.findFirst.mockResolvedValue(row());
    tx.guardianships.findMany.mockResolvedValue([
      { guardianship_id: 'other', is_primary: true },
    ]);

    const result = await service.revoke(G1, 'gs-1', 'guardian_left');

    expect(result).toEqual({
      guardianship_id: 'gs-1',
      consent_status: 'revoked',
      dependent_outcome: 'other_guardian',
    });
    expect(cache.bump).toHaveBeenCalledWith(DEP);
    expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      cache.bump.mock.invocationCallOrder[0],
    );
  });

  it('locks the dependent BEFORE reading the rows the decision depends on', async () => {
    const { service, tx } = setup();
    tx.guardianships.findFirst.mockResolvedValue(row());
    tx.guardianships.findMany.mockResolvedValue([
      { guardianship_id: 'other', is_primary: true },
    ]);

    await service.revoke(G1, 'gs-1', 'guardian_left');

    expect(tx.$executeRaw.mock.calls[0][1]).toBe(
      `guardianships:dependent:${DEP}`,
    );
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.guardianships.findFirst.mock.invocationCallOrder[0],
    );
  });

  it('an unknown guardianship id is 404 without taking a lock', async () => {
    const { service, tx } = setup();
    tx.guardianships.findUnique.mockResolvedValue(null);
    const error = await errorOf(service.revoke(G1, 'gs-x', 'guardian_left'));
    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('a stranger gets 404, never a hint that the row exists', async () => {
    const { service, tx, cache } = setup();
    tx.guardianships.findFirst
      .mockResolvedValueOnce(row({ guardian_user_id: G1 }))
      .mockResolvedValueOnce(null); // the caller has no row for this dependent
    const error = await errorOf(
      service.revoke(G2, 'gs-1', 'removed_by_primary'),
    );
    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    expect(cache.bump).not.toHaveBeenCalled();
  });

  it('a missing, revoked or custodian target is 404', async () => {
    const { service, tx } = setup();
    tx.guardianships.findFirst.mockResolvedValue(null);
    const error = await errorOf(service.revoke(G1, 'gs-1', 'guardian_left'));
    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    expect(tx.guardianships.findFirst.mock.calls[0][0].where).toMatchObject({
      is_custodian: false,
      consent_status: { not: 'revoked' },
    });
  });

  it('the primary can remove a secondary', async () => {
    const { service, tx } = setup();
    tx.guardianships.findFirst
      .mockResolvedValueOnce(
        row({
          guardianship_id: 'gs-sec',
          guardian_user_id: G2,
          is_primary: false,
        }),
      )
      .mockResolvedValueOnce({ is_primary: true });
    tx.guardianships.findMany.mockResolvedValue([
      { guardianship_id: 'gs-primary', is_primary: true },
    ]);

    const result = await service.revoke(G1, 'gs-sec', 'removed_by_primary');

    expect(result.dependent_outcome).toBe('other_guardian');
    expect(tx.guardianships.update.mock.calls[0][0].data.revoked_reason).toBe(
      'removed_by_primary',
    );
  });

  it('a secondary cannot remove the primary (403)', async () => {
    const { service, tx, cache } = setup();
    tx.guardianships.findFirst
      .mockResolvedValueOnce(row({ guardian_user_id: G1, is_primary: true }))
      .mockResolvedValueOnce({ is_primary: false });
    const error = await errorOf(
      service.revoke(G2, 'gs-1', 'removed_by_primary'),
    );
    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_REVOKE_FORBIDDEN);
    expect(error?.getStatus?.()).toBe(403);
    expect(cache.bump).not.toHaveBeenCalled();
  });

  it('the primary cannot use guardian_left on someone else, nor removed_by_primary on themself', async () => {
    const { service, tx } = setup();
    tx.guardianships.findFirst
      .mockResolvedValueOnce(row({ guardian_user_id: G2, is_primary: false }))
      .mockResolvedValueOnce({ is_primary: true });
    expect(
      (await errorOf(service.revoke(G1, 'gs-1', 'guardian_left')))?.code,
    ).toBe(ErrorCode.GUARDIANSHIP_REVOKE_FORBIDDEN);

    tx.guardianships.findFirst.mockResolvedValueOnce(
      row({ guardian_user_id: G1, is_primary: true }),
    );
    expect(
      (await errorOf(service.revoke(G1, 'gs-1', 'removed_by_primary')))?.code,
    ).toBe(ErrorCode.GUARDIANSHIP_REVOKE_FORBIDDEN);
  });
});

describe('GuardianshipLifecycleService.deletionImpact', () => {
  it('previews the outcome of each dependent without writing anything', async () => {
    const { service, prisma, tx } = setup();
    prisma.guardianships.findMany.mockResolvedValue([
      {
        dependent_user_id: 'dep-a',
        dependent: { name: 'Ana', paternal_last_name: 'Pérez' },
      },
      {
        dependent_user_id: 'dep-b',
        dependent: { name: 'Luis', paternal_last_name: 'Gómez' },
      },
      {
        dependent_user_id: 'dep-c',
        dependent: { name: 'Eva', paternal_last_name: null },
      },
    ]);
    // dep-a has another guardian, dep-b is in a club, dep-c has nothing.
    prisma.guardianships.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prisma.club_role_assignments.findMany
      .mockResolvedValueOnce([assignment('active')])
      .mockResolvedValueOnce([]);

    const result = await service.deletionImpact(G1);

    expect(result).toEqual({
      dependents: [
        {
          user_id: 'dep-a',
          display_name: 'Ana Pérez',
          outcome: 'other_guardian',
        },
        {
          user_id: 'dep-b',
          display_name: 'Luis Gómez',
          outcome: 'club_custody',
        },
        { user_id: 'dep-c', display_name: 'Eva', outcome: 'frozen' },
      ],
    });
    expect(tx.guardianships.update).not.toHaveBeenCalled();
    expect(tx.guardianships.create).not.toHaveBeenCalled();
  });

  it('excludes frozen and purged dependents from the preview', async () => {
    const { service, prisma } = setup();
    prisma.guardianships.findMany.mockResolvedValue([]);
    await service.deletionImpact(G1);
    expect(
      prisma.guardianships.findMany.mock.calls[0][0].where.dependent,
    ).toEqual({
      dependent_profile: { is: { frozen_at: null, purged_at: null } },
    });
  });
});

describe('GuardianshipLifecycleService: teens and linked devices (phase 3a)', () => {
  const TEEN_ROW = row({
    consent_status: 'verified',
    verification_method: 'director_paper_form',
    verified_at: new Date('2026-10-01T00:00:00Z'),
    verified_by_user_id: 'director-1',
  });

  describe('outcome matrix when the LAST guardian of a teen (account holder) leaves', () => {
    it('no club assignment: pending_guardian, NEVER frozen, the guardian-less clock restarts', async () => {
      const { service, tx, deviceRevoker } = setup();
      tx.account.count.mockResolvedValue(1);

      const result = await service.detachRow(tx, TEEN_ROW, 'guardian_left');

      expect(result.outcome).toBe('pending_guardian');
      expect(tx.dependent_profiles.updateMany).not.toHaveBeenCalled();
      expect(tx.guardianships.create).not.toHaveBeenCalled();
      expect(tx.supervised_logins.upsert).toHaveBeenCalledWith({
        where: { user_id: DEP },
        update: { pending_since: expect.any(Date), pending_reminder_level: 0 },
        create: expect.objectContaining({
          user_id: DEP,
          method: 'email',
          origin: 'self_registered',
          password_set_by: 'self',
          pending_since: expect.any(Date),
          pending_reminder_level: 0,
        }),
      });
      expect(deviceRevoker.revokeAllForDependent).toHaveBeenCalledWith(
        tx,
        DEP,
        'dependent_no_guardian',
      );
    });

    it('with an active/pending club assignment: club_custody, and the teen is still pending (the clock restarts)', async () => {
      const { service, tx } = setup();
      tx.account.count.mockResolvedValue(1);
      tx.club_role_assignments.findMany.mockResolvedValue([
        assignment('active'),
      ]);

      const result = await service.detachRow(tx, TEEN_ROW, 'guardian_left');

      expect(result.outcome).toBe('club_custody');
      expect(tx.guardianships.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          is_custodian: true,
          custodian_club_id: 9,
          consent_status: 'verified',
        }),
      });
      expect(tx.supervised_logins.upsert).toHaveBeenCalledTimes(1);
      expect(tx.dependent_profiles.updateMany).not.toHaveBeenCalled();
    });

    it('a secondary guardian leaving keeps other_guardian and does not touch the clock', async () => {
      const { service, tx } = setup();
      tx.account.count.mockResolvedValue(1);
      tx.guardianships.findMany.mockResolvedValue([
        { guardianship_id: 'gs-primary', is_primary: true },
      ]);

      const result = await service.detachRow(
        tx,
        row({ is_primary: false }),
        'guardian_left',
      );

      expect(result.outcome).toBe('other_guardian');
      expect(tx.supervised_logins.upsert).not.toHaveBeenCalled();
    });

    it('an old dependent WITHOUT an account keeps the Phase 2 outcome: frozen for 90 days', async () => {
      const { service, tx, deviceRevoker } = setup();
      tx.account.count.mockResolvedValue(0);

      const result = await service.detachRow(tx, row(), 'guardian_left');

      expect(result.outcome).toBe('frozen');
      expect(tx.dependent_profiles.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.supervised_logins.upsert).not.toHaveBeenCalled();
      expect(deviceRevoker.revokeAllForDependent).toHaveBeenCalledWith(
        tx,
        DEP,
        'dependent_frozen',
      );
    });

    it('a handle teen (guardian-enabled) loses its last guardian: pending_guardian too, login untouched', async () => {
      const { service, tx } = setup();
      tx.account.count.mockResolvedValue(1);

      const result = await service.detachRow(
        tx,
        TEEN_ROW,
        'guardian_account_closed',
      );

      expect(result.outcome).toBe('pending_guardian');
      // Only the clock fields move: nothing disables the login.
      const update = tx.supervised_logins.upsert.mock.calls[0][0].update;
      expect(Object.keys(update).sort()).toEqual([
        'pending_reminder_level',
        'pending_since',
      ]);
    });
  });

  describe('linked devices', () => {
    it('revokes the devices paired through the leaving guardianship, inside the transaction', async () => {
      const { service, tx, deviceRevoker } = setup();
      tx.guardianships.findMany.mockResolvedValue([
        { guardianship_id: 'gs-other', is_primary: true },
      ]);

      await service.detachRow(tx, row(), 'guardian_left');

      expect(deviceRevoker.revokeByGuardianship).toHaveBeenCalledWith(
        tx,
        'gs-1',
        'guardianship_revoked',
      );
      // Another guardian remains: the other devices stay.
      expect(deviceRevoker.revokeAllForDependent).not.toHaveBeenCalled();
    });

    it('uses guardian_account_closed when the guardian deletes the account', async () => {
      const { service, tx, deviceRevoker } = setup();
      tx.guardianships.findMany.mockResolvedValue([
        { guardianship_id: 'gs-other', is_primary: true },
      ]);

      await service.detachRow(tx, row(), 'guardian_account_closed');

      expect(deviceRevoker.revokeByGuardianship).toHaveBeenCalledWith(
        tx,
        'gs-1',
        'guardian_account_closed',
      );
    });

    it('revokes EVERY device when the last guardian leaves to custody', async () => {
      const { service, tx, deviceRevoker } = setup();
      tx.club_role_assignments.findMany.mockResolvedValue([
        assignment('active'),
      ]);

      await service.detachRow(tx, row(), 'guardian_left');

      expect(deviceRevoker.revokeAllForDependent).toHaveBeenCalledWith(
        tx,
        DEP,
        'dependent_no_guardian',
      );
    });

    it('a failing device revoke rolls the whole detach back (it throws out of the transaction)', async () => {
      const { service, tx, deviceRevoker } = setup();
      deviceRevoker.revokeByGuardianship.mockRejectedValue(new Error('boom'));

      await expect(
        service.detachRow(tx, row(), 'guardian_left'),
      ).rejects.toThrow('boom');
    });
  });

  describe('account deletion preview', () => {
    it('lists pending_guardian for a teen and frozen for an old dependent', async () => {
      const { service, tx } = setup();
      tx.guardianships.findMany.mockResolvedValue([
        {
          dependent_user_id: 'teen-1',
          dependent: { name: 'Luz', paternal_last_name: 'R' },
        },
        {
          dependent_user_id: 'kid-1',
          dependent: { name: 'Teo', paternal_last_name: 'P' },
        },
      ]);
      tx.guardianships.count.mockResolvedValue(0);
      tx.account.count.mockImplementation(({ where }: any) =>
        Promise.resolve(where.userId === 'teen-1' ? 1 : 0),
      );

      const impact = await service.deletionImpact(G1, tx);

      expect(impact.dependents.map((d) => [d.user_id, d.outcome])).toEqual([
        ['teen-1', 'pending_guardian'],
        ['kid-1', 'frozen'],
      ]);
    });
  });

  describe('revokePendingLinkByDependent (the teen removes a wrong pending link)', () => {
    const PENDING = row({
      guardianship_id: 'gs-pending',
      guardian_user_id: G1,
    });

    it('revokes a PENDING link of this teen with reason removed_by_dependent and restarts the clock', async () => {
      const { service, tx, cache } = setup();
      tx.account.count.mockResolvedValue(1);
      tx.guardianships.findFirst.mockResolvedValue(PENDING);

      const result = await service.revokePendingLinkByDependent(
        DEP,
        'gs-pending',
      );

      expect(tx.guardianships.findFirst.mock.calls[0][0].where).toEqual({
        guardianship_id: 'gs-pending',
        dependent_user_id: DEP,
        is_custodian: false,
        guardian_user_id: { not: null },
        consent_status: 'pending',
        invited_by_guardianship_id: null,
      });
      expect(tx.guardianships.update).toHaveBeenCalledWith({
        where: { guardianship_id: 'gs-pending' },
        data: expect.objectContaining({
          consent_status: 'revoked',
          revoked_reason: 'removed_by_dependent',
        }),
      });
      expect(result).toEqual({
        guardianship_id: 'gs-pending',
        consent_status: 'revoked',
        dependent_outcome: 'pending_guardian',
      });
      expect(tx.supervised_logins.upsert).toHaveBeenCalledTimes(1);
      expect(cache.bump).toHaveBeenCalledWith(DEP);
    });

    it('a pending second_guardian row (invited by a guardian) cannot be revoked by the teen (R4 / P3-A27)', async () => {
      const { service, tx, cache } = setup();
      // The DB applies the where clause: emulate it over two pending rows.
      const rows = [
        { ...PENDING, invited_by_guardianship_id: null },
        {
          ...row({ guardianship_id: 'gs-second', guardian_user_id: G1 }),
          invited_by_guardianship_id: 'gs-parent',
        },
      ];
      tx.guardianships.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          rows.find(
            (r: any) =>
              r.guardianship_id === where.guardianship_id &&
              r.invited_by_guardianship_id === where.invited_by_guardianship_id,
          ) ?? null,
        ),
      );

      expect(
        await errorOf(service.revokePendingLinkByDependent(DEP, 'gs-second')),
      ).toMatchObject({ code: ErrorCode.GUARDIANSHIP_NOT_FOUND });
      expect(tx.guardianships.update).not.toHaveBeenCalled();
      expect(cache.bump).not.toHaveBeenCalled();

      // The row the teen initiated itself still goes.
      await service.revokePendingLinkByDependent(DEP, 'gs-pending');
      expect(tx.guardianships.update).toHaveBeenCalledTimes(1);
    });

    it('locks the teen BEFORE reading the link', async () => {
      const { service, tx } = setup();
      tx.guardianships.findFirst.mockResolvedValue(PENDING);

      await service.revokePendingLinkByDependent(DEP, 'gs-pending');

      expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.guardianships.findFirst.mock.invocationCallOrder[0],
      );
    });

    it("a VERIFIED guardian, another teen's link or a custody row cannot be removed: 404 and nothing is written", async () => {
      const { service, tx, cache } = setup();
      tx.guardianships.findFirst.mockResolvedValue(null);

      expect(
        await errorOf(service.revokePendingLinkByDependent(DEP, 'gs-verified')),
      ).toMatchObject({ code: ErrorCode.GUARDIANSHIP_NOT_FOUND });
      expect(tx.guardianships.update).not.toHaveBeenCalled();
      expect(cache.bump).not.toHaveBeenCalled();
    });

    it('revokes the open link codes the removed guardian issued and the devices paired through the link', async () => {
      const { service, tx, deviceRevoker } = setup();
      tx.guardianships.findFirst.mockResolvedValue(PENDING);

      await service.revokePendingLinkByDependent(DEP, 'gs-pending');

      expect(tx.guardianship_link_codes.updateMany).toHaveBeenCalled();
      expect(deviceRevoker.revokeByGuardianship).toHaveBeenCalledWith(
        tx,
        'gs-pending',
        'guardianship_revoked',
      );
    });
  });
});

import { DependentPushRouterService } from './dependent-push-router.service';

const D1 = 'dddddddd-0000-4000-8000-000000000001';
const D2 = 'dddddddd-0000-4000-8000-000000000002';
const ADULT = 'aaaaaaaa-0000-4000-8000-000000000001';
const G1 = 'gggggggg-0000-4000-8000-000000000001';
const G2 = 'gggggggg-0000-4000-8000-000000000002';

function dependentRow(id: string, name: string | null, guardians: string[]) {
  return {
    user_id: id,
    name,
    guardianships_as_dependent: guardians.map((guardian) => ({
      guardian_user_id: guardian,
    })),
  };
}

function setup() {
  const prisma: any = {
    users: { findMany: jest.fn().mockResolvedValue([]) },
    user_fcm_tokens: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const preferences: any = {
    filterAllowedUsers: jest
      .fn()
      .mockImplementation(async (ids: string[]) => new Set(ids)),
  };
  return {
    router: new DependentPushRouterService(prisma, preferences),
    prisma,
    preferences,
  };
}

describe('DependentPushRouterService.expand', () => {
  it('asks for dependents with ONE query and excludes frozen, purged, inactive and account holders', async () => {
    const { router, prisma } = setup();
    prisma.users.findMany.mockResolvedValue([
      dependentRow(D1, 'Ana María', [G1, G2]),
    ]);

    const routes = await router.expand([D1, ADULT, D1]);

    expect(prisma.users.findMany).toHaveBeenCalledTimes(1);
    const args = prisma.users.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      user_id: { in: [D1, ADULT] },
      active: true,
      account: { none: {} },
      dependent_profile: { is: { frozen_at: null, purged_at: null } },
    });
    // At most 4 guardians, never custody/external/test/revoked rows.
    expect(args.select.guardianships_as_dependent).toMatchObject({
      take: 4,
      where: {
        consent_status: { not: 'revoked' },
        is_custodian: false,
        is_test_data: false,
        guardian_user_id: { not: null },
      },
    });
    expect(routes).toEqual([
      { dependentUserId: D1, displayName: 'Ana', guardianUserIds: [G1, G2] },
    ]);
  });

  it('drops dependents that have no active guardian', async () => {
    const { router, prisma } = setup();
    prisma.users.findMany.mockResolvedValue([dependentRow(D1, 'Ana', [])]);
    expect(await router.expand([D1])).toEqual([]);
  });

  it('does not query at all for an empty list', async () => {
    const { router, prisma } = setup();
    expect(await router.expand([])).toEqual([]);
    expect(prisma.users.findMany).not.toHaveBeenCalled();
  });

  it('for a huge audience loads all dependents once and filters in memory (no giant IN list)', async () => {
    const { router, prisma } = setup();
    const audience = Array.from({ length: 2500 }, (_, i) => `u-${i}`);
    audience.push(D1);
    prisma.users.findMany.mockResolvedValue([
      dependentRow(D1, 'Ana', [G1]),
      dependentRow(D2, 'Luis', [G2]), // a dependent NOT in this audience
    ]);

    const routes = await router.expand(audience);

    expect(prisma.users.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.users.findMany.mock.calls[0][0].where).not.toHaveProperty(
      'user_id',
    );
    expect(routes.map((r) => r.dependentUserId)).toEqual([D1]);
  });

  it('falls back to a neutral label when the child has no name', async () => {
    const { router, prisma } = setup();
    prisma.users.findMany.mockResolvedValue([dependentRow(D1, '  ', [G1])]);
    expect((await router.expand([D1]))[0].displayName).toBe('Menor');
  });
});

describe('DependentPushRouterService.buildPushes', () => {
  it('labels the push with the first name and carries dependent_user_id', async () => {
    const { router, prisma } = setup();
    prisma.users.findMany.mockResolvedValue([dependentRow(D1, 'Ana', [G1])]);
    prisma.user_fcm_tokens.findMany.mockResolvedValue([
      { user_id: G1, token: 't-g1' },
    ]);

    const pushes = await router.buildPushes([D1], {
      title: 'Clase aprobada',
      body: 'Buen trabajo',
      data: { type: 'class_approved' },
      source: 'validation:honor_approved',
    });

    expect(pushes).toEqual([
      {
        dependentUserId: D1,
        guardianUserIds: [G1],
        tokens: ['t-g1'],
        title: 'Ana · Clase aprobada',
        body: 'Buen trabajo',
        data: { type: 'class_approved', dependent_user_id: D1 },
      },
    ]);
  });

  it('honors each guardian preference: a guardian who opted out gets nothing', async () => {
    const { router, prisma, preferences } = setup();
    prisma.users.findMany.mockResolvedValue([
      dependentRow(D1, 'Ana', [G1, G2]),
    ]);
    preferences.filterAllowedUsers.mockResolvedValue(new Set([G1]));
    prisma.user_fcm_tokens.findMany.mockResolvedValue([
      { user_id: G1, token: 't-g1' },
    ]);

    const pushes = await router.buildPushes([D1], {
      title: 'T',
      body: 'B',
      source: 'activities:created',
    });

    expect(preferences.filterAllowedUsers).toHaveBeenCalledWith(
      [G1, G2],
      'activities:created',
    );
    expect(prisma.user_fcm_tokens.findMany.mock.calls[0][0].where).toEqual({
      user_id: { in: [G1] },
      active: true,
    });
    expect(pushes).toHaveLength(1);
    expect(pushes[0].guardianUserIds).toEqual([G1]);
    expect(pushes[0].tokens).toEqual(['t-g1']);
  });

  it('sends nothing when every guardian opted out', async () => {
    const { router, prisma, preferences } = setup();
    prisma.users.findMany.mockResolvedValue([dependentRow(D1, 'Ana', [G1])]);
    preferences.filterAllowedUsers.mockResolvedValue(new Set());
    expect(
      await router.buildPushes([D1], { title: 'T', body: 'B', source: 'x:y' }),
    ).toEqual([]);
    expect(prisma.user_fcm_tokens.findMany).not.toHaveBeenCalled();
  });

  it('skips a dependent whose guardians have no active tokens', async () => {
    const { router, prisma } = setup();
    prisma.users.findMany.mockResolvedValue([dependentRow(D1, 'Ana', [G1])]);
    prisma.user_fcm_tokens.findMany.mockResolvedValue([]);
    expect(await router.buildPushes([D1], { title: 'T', body: 'B' })).toEqual(
      [],
    );
  });

  it('one push per dependent, one guardian query for the whole batch', async () => {
    const { router, prisma } = setup();
    prisma.users.findMany.mockResolvedValue([
      dependentRow(D1, 'Ana', [G1]),
      dependentRow(D2, 'Luis', [G1, G2]),
    ]);
    prisma.user_fcm_tokens.findMany.mockResolvedValue([
      { user_id: G1, token: 't-g1' },
      { user_id: G2, token: 't-g2' },
    ]);

    const pushes = await router.buildPushes([D1, D2], {
      title: 'T',
      body: 'B',
    });

    expect(prisma.users.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user_fcm_tokens.findMany).toHaveBeenCalledTimes(1);
    expect(pushes.map((p) => [p.title, p.tokens])).toEqual([
      ['Ana · T', ['t-g1']],
      ['Luis · T', ['t-g1', 't-g2']],
    ]);
  });

  it.each(['family:evidence_uploaded', 'family:consent_verified'])(
    'never re-fans-out the %s source (it already addresses guardians)',
    async (source) => {
      const { router, prisma } = setup();
      expect(
        await router.buildPushes([D1], { title: 'T', body: 'B', source }),
      ).toEqual([]);
      expect(prisma.users.findMany).not.toHaveBeenCalled();
    },
  );

  it('does nothing for plain users', async () => {
    const { router, prisma, preferences } = setup();
    prisma.users.findMany.mockResolvedValue([]);
    expect(
      await router.buildPushes([ADULT], { title: 'T', body: 'B' }),
    ).toEqual([]);
    expect(preferences.filterAllowedUsers).not.toHaveBeenCalled();
  });
});

describe('DependentPushRouterService.routeAndSend', () => {
  it('sends each push with the caller multicast, in batches of 500 tokens', async () => {
    const { router, prisma } = setup();
    const tokens = Array.from({ length: 600 }, (_, i) => `t-${i}`);
    // 600 distinct guardians would exceed the real limit of 4; the batching
    // contract is what is under test here.
    prisma.users.findMany.mockResolvedValue([dependentRow(D1, 'Ana', [G1])]);
    prisma.user_fcm_tokens.findMany.mockResolvedValue(
      tokens.map((token) => ({ user_id: G1, token })),
    );
    const send = jest
      .fn()
      .mockResolvedValue({ successCount: 1, failureCount: 0 });

    const result = await router.routeAndSend(
      [D1],
      { title: 'T', body: 'B' },
      send,
      'test',
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toHaveLength(500);
    expect(send.mock.calls[1][0]).toHaveLength(100);
    expect(send.mock.calls[0][1]).toBe('Ana · T');
    expect(result).toEqual({ successCount: 2, failureCount: 0 });
  });

  it('never throws when a send fails or when routing itself fails', async () => {
    const { router, prisma } = setup();
    prisma.users.findMany.mockResolvedValue([dependentRow(D1, 'Ana', [G1])]);
    prisma.user_fcm_tokens.findMany.mockResolvedValue([
      { user_id: G1, token: 't' },
    ]);
    const failingSend = jest.fn().mockRejectedValue(new Error('fcm down'));
    await expect(
      router.routeAndSend([D1], { title: 'T', body: 'B' }, failingSend, 'test'),
    ).resolves.toEqual({ successCount: 0, failureCount: 0 });

    prisma.users.findMany.mockRejectedValue(new Error('db down'));
    await expect(
      router.routeAndSend([D1], { title: 'T', body: 'B' }, jest.fn(), 'test'),
    ).resolves.toEqual({ successCount: 0, failureCount: 0 });
  });
});

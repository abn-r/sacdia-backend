import { MemberOfMonthService } from './member-of-month.service';
import { ErrorCode } from '../common/errors/error-codes';

describe('MemberOfMonthService listForAdmin authorization', () => {
  const mockPrisma = {
    member_of_month: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockAuthorizationContext = {
    resolveUserAuthorization: jest.fn(),
  };

  const mockCoordinationService = {
    getEffectiveCoordinatorSectionIds: jest.fn(),
  };

  let service: MemberOfMonthService;

  const resolvedAuth = ({
    roles,
    localFieldId,
  }: {
    roles: string[];
    localFieldId?: number;
  }) => ({
    authorization: {
      grants: {
        global_roles: roles.map((role_name) => ({
          role_name,
          permissions: ['mom:supervise'],
          scope: {},
        })),
        club_assignments: [],
      },
      active_assignment: { assignment_id: null },
      effective: {
        scope: {
          global: {
            ...(localFieldId === undefined
              ? {}
              : { local_field: { id: localFieldId, name: 'Campo Local' } }),
          },
        },
      },
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MemberOfMonthService(
      mockPrisma as any,
      {} as any,
      {} as any,
      mockAuthorizationContext as any,
      {} as any,
      mockCoordinationService as any,
    );
    mockPrisma.member_of_month.count.mockResolvedValue(0);
    mockPrisma.member_of_month.findMany.mockResolvedValue([]);
  });

  it('rejects coordinator without assigned club sections', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['coordinator'], localFieldId: 7 }),
    );
    mockCoordinationService.getEffectiveCoordinatorSectionIds.mockResolvedValue(
      [],
    );

    await expect(
      service.listForAdmin('coordinator-without-scope', { localFieldId: 99 }),
    ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });

    expect(mockPrisma.member_of_month.count).not.toHaveBeenCalled();
    expect(mockPrisma.member_of_month.findMany).not.toHaveBeenCalled();
  });

  it('scopes coordinator list to assigned sections and ignores local_field_id', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['coordinator'], localFieldId: 7 }),
    );
    mockCoordinationService.getEffectiveCoordinatorSectionIds.mockResolvedValue(
      [20, 21],
    );

    await service.listForAdmin('coordinator-with-scope', { localFieldId: 99 });

    expect(
      mockCoordinationService.getEffectiveCoordinatorSectionIds,
    ).toHaveBeenCalledWith('coordinator-with-scope');
    expect(mockPrisma.member_of_month.count).toHaveBeenCalledWith({
      where: {
        club_section: {
          club_section_id: { in: [20, 21] },
          clubs: {},
        },
      },
    });
  });

  it('returns empty when coordinator filters a section outside assignments', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['zone-coordinator'] }),
    );
    mockCoordinationService.getEffectiveCoordinatorSectionIds.mockResolvedValue(
      [20, 21],
    );

    await expect(
      service.listForAdmin('zone-coordinator-1', { sectionId: 99 }),
    ).resolves.toEqual({ total: 0, page: 1, limit: 20, items: [] });

    expect(mockPrisma.member_of_month.count).not.toHaveBeenCalled();
  });

  it('narrows coordinator list to an assigned section_id', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['general-coordinator'] }),
    );
    mockCoordinationService.getEffectiveCoordinatorSectionIds.mockResolvedValue(
      [20, 21],
    );

    await service.listForAdmin('general-coordinator-1', { sectionId: 21 });

    expect(mockPrisma.member_of_month.count).toHaveBeenCalledWith({
      where: {
        club_section: {
          club_section_id: { in: [21] },
          clubs: {},
        },
      },
    });
  });

  it('allows admin to request an arbitrary local_field_id filter', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['admin'] }),
    );

    await service.listForAdmin('admin-user', { localFieldId: 99 });

    expect(
      mockCoordinationService.getEffectiveCoordinatorSectionIds,
    ).not.toHaveBeenCalled();
    expect(mockPrisma.member_of_month.count).toHaveBeenCalledWith({
      where: {
        club_section: {
          clubs: { local_field_id: 99 },
        },
      },
    });
  });

  it('forces non-admin territorial actors to their local_field_id', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['director-lf'], localFieldId: 7 }),
    );

    await service.listForAdmin('director-lf-user', { localFieldId: 99 });

    expect(
      mockCoordinationService.getEffectiveCoordinatorSectionIds,
    ).not.toHaveBeenCalled();
    expect(mockPrisma.member_of_month.count).toHaveBeenCalledWith({
      where: {
        club_section: {
          clubs: { local_field_id: 7 },
        },
      },
    });
  });
});

describe('MemberOfMonthService notifications (club data recipients)', () => {
  const PENDING_TEEN = 'pending-teen';
  const ACTIVE_MEMBER = 'active-member';
  const DIRECTOR = 'director-1';

  const mockPrisma = {
    club_sections: {
      findUnique: jest.fn().mockResolvedValue({
        clubs: { club_id: 3, name: 'Club Sur' },
        club_types: { name: 'Conquistadores' },
      }),
    },
    club_role_assignments: {
      findMany: jest.fn().mockResolvedValue([{ user_id: DIRECTOR }]),
    },
    users: { findMany: jest.fn().mockResolvedValue([]) },
    member_of_month: { updateMany: jest.fn().mockResolvedValue({}) },
  };
  const mockNotifications = {
    notifySafe: jest.fn().mockResolvedValue(undefined),
  };
  const mockClubDataRecipients = {
    // Denies the pending teen only.
    filterClubDataRecipients: jest.fn((ids: string[]) =>
      Promise.resolve([...new Set(ids)].filter((id) => id !== PENDING_TEEN)),
    ),
  };

  const build = () =>
    new MemberOfMonthService(
      mockPrisma as any,
      mockNotifications as any,
      mockClubDataRecipients as any,
      {} as any,
      {} as any,
      {} as any,
    );

  beforeEach(() => jest.clearAllMocks());

  it('congratulates an active member but not a pending teen, and does not mark the teen as notified', async () => {
    const winners = [
      { user_id: PENDING_TEEN, total_points: 10 },
      { user_id: ACTIVE_MEMBER, total_points: 10 },
    ];

    await (build() as any).sendMemberOfMonthNotifications(5, winners, 3, 2026);

    const notified = mockNotifications.notifySafe.mock.calls.map((c) => c[0]);
    expect(notified).toContain(ACTIVE_MEMBER);
    expect(notified).not.toContain(PENDING_TEEN);
    expect(mockPrisma.member_of_month.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.member_of_month.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ user_id: ACTIVE_MEMBER }),
      }),
    );
  });

  it('filters the director recipients through the same gate', async () => {
    mockPrisma.club_role_assignments.findMany.mockResolvedValueOnce([
      { user_id: DIRECTOR },
      { user_id: PENDING_TEEN },
    ]);

    await (build() as any).sendMemberOfMonthNotifications(
      5,
      [{ user_id: ACTIVE_MEMBER, total_points: 10 }],
      3,
      2026,
    );

    const notified = mockNotifications.notifySafe.mock.calls.map((c) => c[0]);
    expect(notified).toContain(DIRECTOR);
    expect(notified).not.toContain(PENDING_TEEN);
  });
});

describe('MemberOfMonthService runEvaluation re-run', () => {
  const sendSpy = jest.fn();
  const tx = {
    member_of_month: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  };
  const mockPrisma = {
    $queryRaw: jest.fn(),
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    member_of_month: { deleteMany: jest.fn() },
  };
  const mockAchievements = {
    emitEvent: jest.fn().mockResolvedValue(undefined),
  };

  const build = () => {
    const service = new MemberOfMonthService(
      mockPrisma as any,
      {} as any,
      {} as any,
      {} as any,
      mockAchievements as any,
      {} as any,
    );
    (service as any).sendMemberOfMonthNotifications = sendSpy;
    return service;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    sendSpy.mockResolvedValue(undefined);
    mockPrisma.$queryRaw.mockResolvedValue([
      { user_id: 'u1', total_points: 10 },
      { user_id: 'u2', total_points: 10 },
    ]);
  });

  it('notifies every winner the first time', async () => {
    tx.member_of_month.findMany.mockResolvedValue([]);

    await build().runEvaluation(5, 3, 2026);

    expect(tx.member_of_month.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ user_id: 'u1', notified: false }),
        expect.objectContaining({ user_id: 'u2', notified: false }),
      ],
    });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][4]).toEqual(new Set());
  });

  it('keeps notified=true and sends nothing when a re-run elects the same winners', async () => {
    tx.member_of_month.findMany.mockResolvedValue([
      { user_id: 'u1' },
      { user_id: 'u2' },
    ]);

    await build().runEvaluation(5, 3, 2026);

    expect(tx.member_of_month.findMany).toHaveBeenCalledWith({
      where: { club_section_id: 5, month: 3, year: 2026, notified: true },
      select: { user_id: true },
    });
    expect(tx.member_of_month.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ user_id: 'u1', notified: true }),
        expect.objectContaining({ user_id: 'u2', notified: true }),
      ],
    });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('only notifies the winner who was not already notified', async () => {
    tx.member_of_month.findMany.mockResolvedValue([{ user_id: 'u1' }]);

    await build().runEvaluation(5, 3, 2026);

    expect(tx.member_of_month.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ user_id: 'u1', notified: true }),
        expect.objectContaining({ user_id: 'u2', notified: false }),
      ],
    });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][4]).toEqual(new Set(['u1']));
  });
});

describe('MemberOfMonthService runEvaluation achievement events', () => {
  const tx = {
    member_of_month: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  };
  const mockPrisma = {
    $queryRaw: jest.fn(),
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    member_of_month: { deleteMany: jest.fn() },
  };
  // Mirrors the durable-event contract of AchievementsService.emitEvent:
  // one event_log row (and one queue job) per idempotency key.
  const eventLog = new Map<string, number>();
  const mockAchievements = {
    emitEvent: jest.fn(async (dto: { idempotencyKey?: string }) => {
      const key = dto.idempotencyKey ?? `anon-${eventLog.size}`;
      if (!eventLog.has(key)) eventLog.set(key, eventLog.size + 1);
      return { eventLogId: eventLog.get(key), queued: true };
    }),
  };

  const build = () => {
    const service = new MemberOfMonthService(
      mockPrisma as any,
      {} as any,
      {} as any,
      {} as any,
      mockAchievements as any,
      {} as any,
    );
    (service as any).sendMemberOfMonthNotifications = jest
      .fn()
      .mockResolvedValue(undefined);
    return service;
  };

  const keysEmitted = () =>
    mockAchievements.emitEvent.mock.calls.map((c) => c[0].idempotencyKey);

  beforeEach(() => {
    jest.clearAllMocks();
    eventLog.clear();
  });

  it('emits one keyed event per winner on the first run', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { user_id: 'u1', total_points: 10 },
      { user_id: 'u2', total_points: 10 },
    ]);

    await build().runEvaluation(5, 3, 2026);

    expect(keysEmitted()).toEqual([
      'member-of-month:5:2026-3:u1',
      'member-of-month:5:2026-3:u2',
    ]);
    expect(eventLog.size).toBe(2);
  });

  it('a re-run with the same winners creates no new event log rows', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { user_id: 'u1', total_points: 10 },
      { user_id: 'u2', total_points: 10 },
    ]);
    const service = build();

    await service.runEvaluation(5, 3, 2026);
    await service.runEvaluation(5, 3, 2026);

    expect(mockAchievements.emitEvent).toHaveBeenCalledTimes(4);
    expect(new Set(keysEmitted()).size).toBe(2);
    expect(eventLog.size).toBe(2);
  });

  it('a re-run with a changed winner only adds an event for the new one', async () => {
    const service = build();
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { user_id: 'u1', total_points: 10 },
    ]);
    await service.runEvaluation(5, 3, 2026);

    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { user_id: 'u2', total_points: 12 },
    ]);
    await service.runEvaluation(5, 3, 2026);

    expect([...eventLog.keys()]).toEqual([
      'member-of-month:5:2026-3:u1',
      'member-of-month:5:2026-3:u2',
    ]);
  });

  it('the same user winning another month gets a new event', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { user_id: 'u1', total_points: 10 },
    ]);
    const service = build();

    await service.runEvaluation(5, 3, 2026);
    await service.runEvaluation(5, 4, 2026);

    expect(eventLog.size).toBe(2);
  });
});

describe('MemberOfMonthService notifications skip already-notified winners', () => {
  const mockPrisma = {
    club_sections: {
      findUnique: jest.fn().mockResolvedValue({
        clubs: { club_id: 3, name: 'Club Sur' },
        club_types: { name: 'Conquistadores' },
      }),
    },
    club_role_assignments: { findMany: jest.fn().mockResolvedValue([]) },
    users: { findMany: jest.fn().mockResolvedValue([]) },
    member_of_month: { updateMany: jest.fn().mockResolvedValue({}) },
  };
  const mockNotifications = {
    notifySafe: jest.fn().mockResolvedValue(undefined),
  };
  const mockClubDataRecipients = {
    filterClubDataRecipients: jest.fn((ids: string[]) => Promise.resolve(ids)),
  };

  it('does not congratulate (nor re-mark) a winner already notified', async () => {
    jest.clearAllMocks();
    const service = new MemberOfMonthService(
      mockPrisma as any,
      mockNotifications as any,
      mockClubDataRecipients as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await (service as any).sendMemberOfMonthNotifications(
      5,
      [
        { user_id: 'old', total_points: 10 },
        { user_id: 'new', total_points: 10 },
      ],
      3,
      2026,
      new Set(['old']),
    );

    const notified = mockNotifications.notifySafe.mock.calls.map((c) => c[0]);
    expect(notified).toContain('new');
    expect(notified).not.toContain('old');
    expect(mockPrisma.member_of_month.updateMany).toHaveBeenCalledTimes(1);
  });
});

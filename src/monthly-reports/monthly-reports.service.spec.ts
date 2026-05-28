import { MonthlyReportsService } from './monthly-reports.service';
import { ErrorCode } from '../common/errors/error-codes';

describe('MonthlyReportsService admin list authorization', () => {
  const mockPrisma = {
    monthly_reports: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockAuthorizationContext = {
    resolveUserAuthorization: jest.fn(),
  };

  let service: MonthlyReportsService;

  const resolvedAuth = ({
    roles,
    unionId,
    localFieldId,
    activeAssignmentRole,
    activeClubSectionId = 44,
  }: {
    roles: string[];
    unionId?: number;
    localFieldId?: number;
    activeAssignmentRole?: string;
    activeClubSectionId?: number;
  }) => ({
    authorization: {
      grants: {
        global_roles: roles.map((role_name) => ({
          role_name,
          permissions: ['reports:read'],
          scope: {},
        })),
        club_assignments: activeAssignmentRole
          ? [
              {
                assignment_id: 'active-assignment',
                role_name: activeAssignmentRole,
                permissions: ['reports:read'],
                section: { club_section_id: activeClubSectionId },
              },
            ]
          : [],
      },
      active_assignment: {
        assignment_id: activeAssignmentRole ? 'active-assignment' : null,
      },
      effective: {
        scope: {
          global: {
            ...(unionId === undefined
              ? {}
              : { union: { id: unionId, name: 'Unión' } }),
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
    service = new MonthlyReportsService(
      mockPrisma as any,
      mockAuthorizationContext as any,
    );
    mockPrisma.monthly_reports.count.mockResolvedValue(0);
    mockPrisma.monthly_reports.findMany.mockResolvedValue([]);
  });

  it('rejects actors without global or active-assignment report scope instead of listing all reports', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: [] }),
    );

    await expect(
      service.listForAdmin('club-scoped-user', { page: 1, limit: 25 }),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });

    expect(mockPrisma.monthly_reports.count).not.toHaveBeenCalled();
    expect(mockPrisma.monthly_reports.findMany).not.toHaveBeenCalled();
  });

  it('forces union leadership scope to the actor union and allows narrower local-field filters', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['director-union'], unionId: 20 }),
    );

    await service.listForAdmin('director-union-user', {
      unionId: 99,
      localFieldId: 7,
    });

    expect(mockPrisma.monthly_reports.count).toHaveBeenCalledWith({
      where: {
        club_enrollment: {
          club_section: {
            clubs: {
              local_field_id: 7,
              local_fields: { union_id: 20 },
            },
          },
        },
      },
    });
  });

  it('scopes active club-assignment report readers to their own section', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({
        roles: [],
        activeAssignmentRole: 'secretary',
        activeClubSectionId: 44,
      }),
    );

    await service.listForAdmin('section-secretary', { localFieldId: 99 });

    expect(mockPrisma.monthly_reports.count).toHaveBeenCalledWith({
      where: {
        club_enrollment: {
          club_section: {
            club_section_id: 44,
          },
        },
      },
    });
  });

  it('rejects coordinator without a real local field scope', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['coordinator'] }),
    );

    await expect(
      service.listForAdmin('coordinator-without-lf', { localFieldId: 99 }),
    ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });

    expect(mockPrisma.monthly_reports.count).not.toHaveBeenCalled();
    expect(mockPrisma.monthly_reports.findMany).not.toHaveBeenCalled();
  });

  it('forces coordinator scope to the actor local field and ignores arbitrary local_field_id filters', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['coordinator'], localFieldId: 7 }),
    );

    await service.listForAdmin('coordinator-with-lf', { localFieldId: 99 });

    expect(mockPrisma.monthly_reports.count).toHaveBeenCalledWith({
      where: {
        club_enrollment: {
          club_section: {
            clubs: { local_field_id: 7 },
          },
        },
      },
    });
  });

  it('allows admin to request an arbitrary local_field_id filter', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['admin'] }),
    );

    await service.listForAdmin('admin-user', { localFieldId: 99 });

    expect(mockPrisma.monthly_reports.count).toHaveBeenCalledWith({
      where: {
        club_enrollment: {
          club_section: {
            clubs: { local_field_id: 99 },
          },
        },
      },
    });
  });
});

describe('MonthlyReportsService auto-calculated finances', () => {
  const mockPrisma = {
    finances: {
      findMany: jest.fn(),
    },
  };

  let service: MonthlyReportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MonthlyReportsService(mockPrisma as any, {} as any);
  });

  it('includes both monthly movement balance and accumulated club total balance', async () => {
    mockPrisma.finances.findMany
      .mockResolvedValueOnce([
        { amount: 1000, finances_categories: { type: 0 } },
        { amount: 250, finances_categories: { type: 1 } },
      ])
      .mockResolvedValueOnce([
        { amount: 5000, finances_categories: { type: 0 } },
        { amount: 1200, finances_categories: { type: 1 } },
        { amount: 300, finances_categories: { type: 1 } },
      ]);

    const result = await (service as any).getFinancesData(2, 4, 2026);

    expect(mockPrisma.finances.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        club_section_id: 2,
        month: 4,
        year: 2026,
        active: true,
      },
      include: {
        finances_categories: {
          select: { name: true, type: true },
        },
      },
    });
    expect(mockPrisma.finances.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        club_section_id: 2,
        active: true,
        OR: [{ year: { lt: 2026 } }, { year: 2026, month: { lte: 4 } }],
      },
      include: {
        finances_categories: {
          select: { type: true },
        },
      },
    });
    expect(result).toEqual({
      income: 1000,
      expenses: 250,
      balance: 750,
      total_balance: 3500,
      transactions: 2,
    });
  });
});

describe('MonthlyReportsService scheduled reminders', () => {
  const mockPrisma = {
    system_config: {
      findUnique: jest.fn(),
    },
    club_enrollments: {
      findMany: jest.fn(),
    },
    monthly_reports: {
      findUnique: jest.fn(),
    },
  };

  const mockNotifications = {
    sendToSectionRole: jest.fn(),
  };

  let service: MonthlyReportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MonthlyReportsService(
      mockPrisma as any,
      {} as any,
      mockNotifications as any,
    );
    mockPrisma.system_config.findUnique.mockResolvedValue(null);
    mockPrisma.club_enrollments.findMany.mockResolvedValue([
      {
        club_enrollment_id: 'enrollment-1',
        club_section: {
          club_section_id: 44,
          clubs: { name: 'ACV' },
          club_types: { name: 'Conquistadores' },
        },
      },
    ]);
    mockPrisma.monthly_reports.findUnique.mockResolvedValue({
      status: 'generated',
    });
  });

  it('notifies director, secretary and secretary-treasurer on the 27th monthly data reminder', async () => {
    const result = await service.runReminderNotifications(
      new Date('2026-05-27T15:00:00.000Z'),
    );

    expect(result).toEqual({ itemsProcessed: 1 });
    expect(mockNotifications.sendToSectionRole).toHaveBeenCalledWith(
      44,
      ['director', 'secretary', 'secretary-treasurer'],
      expect.stringContaining('mayo'),
      expect.any(String),
      expect.objectContaining({
        action: 'capture_reminder',
        reportMonth: '5',
        reportYear: '2026',
        route: '/home/reports',
      }),
      'monthly_reports:reminder',
    );
  });

  it('notifies about the previous month on day 1/4/5/6 close cycle', async () => {
    await service.runReminderNotifications(
      new Date('2026-06-06T15:00:00.000Z'),
    );

    expect(mockNotifications.sendToSectionRole).toHaveBeenCalledWith(
      44,
      ['director', 'secretary', 'secretary-treasurer'],
      expect.stringContaining('mayo'),
      expect.any(String),
      expect.objectContaining({
        action: 'generated',
        reportMonth: '5',
        reportYear: '2026',
      }),
      'monthly_reports:reminder',
    );
  });

  it('does not send the day 6 generated notification when the report is not generated yet', async () => {
    mockPrisma.monthly_reports.findUnique.mockResolvedValueOnce({
      status: 'draft',
    });

    const result = await service.runReminderNotifications(
      new Date('2026-06-06T15:00:00.000Z'),
    );

    expect(result).toEqual({ itemsProcessed: 0 });
    expect(mockNotifications.sendToSectionRole).not.toHaveBeenCalled();
  });

  it('does not notify on non-scheduled days', async () => {
    const result = await service.runReminderNotifications(
      new Date('2026-05-28T15:00:00.000Z'),
    );

    expect(result).toEqual({ itemsProcessed: 0 });
    expect(mockNotifications.sendToSectionRole).not.toHaveBeenCalled();
  });
});

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
    localFieldId,
  }: {
    roles: string[];
    localFieldId?: number;
  }) => ({
    authorization: {
      grants: {
        global_roles: roles.map((role_name) => ({
          role_name,
          permissions: ['reports:read'],
          scope: {},
        })),
      },
      effective: {
        scope: {
          global:
            localFieldId === undefined
              ? {}
              : { local_field: { id: localFieldId, name: 'Campo Local' } },
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

  it('rejects actors without an allowed global admin role instead of listing all reports', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: [] }),
    );

    await expect(
      service.listForAdmin('club-scoped-user', { page: 1, limit: 25 }),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });

    expect(mockPrisma.monthly_reports.count).not.toHaveBeenCalled();
    expect(mockPrisma.monthly_reports.findMany).not.toHaveBeenCalled();
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

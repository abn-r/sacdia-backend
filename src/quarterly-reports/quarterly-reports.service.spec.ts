import { QuarterlyReportsService } from './quarterly-reports.service';

describe('QuarterlyReportsService admin visibility', () => {
  const mockPrisma = {
    quarterly_reports: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const mockAuthorizationContext = {
    resolveUserAuthorization: jest.fn(),
  };

  const resolvedAuth = () =>
    ({
      authorization: {
        grants: {
          global_roles: [
            { role_name: 'director-union', permissions: ['reports:read'] },
          ],
          club_assignments: [],
        },
        active_assignment: { assignment_id: null },
        effective: {
          scope: {
            global: { union: { id: 20, name: 'Unión' } },
          },
        },
      },
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.quarterly_reports.count.mockResolvedValue(0);
    mockPrisma.quarterly_reports.findMany.mockResolvedValue([]);
  });

  it('forces union-tier actors to their own union when listing admin quarterly reports', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth(),
    );
    const service = new QuarterlyReportsService(
      mockPrisma as any,
      mockAuthorizationContext as any,
    );

    await service.listForAdmin('director-union-user', {
      unionId: 99,
      localFieldId: 7,
    });

    expect(mockPrisma.quarterly_reports.count).toHaveBeenCalledWith({
      where: {
        club: {
          local_field_id: 7,
          local_fields: { union_id: 20 },
        },
      },
    });
  });
});

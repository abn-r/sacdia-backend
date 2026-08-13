import { AnnualReportsService } from './annual-reports.service';

describe('AnnualReportsService admin visibility', () => {
  const mockPrisma = {
    annual_reports: {
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
            { role_name: 'director-lf', permissions: ['reports:read'] },
          ],
          club_assignments: [],
        },
        active_assignment: { assignment_id: null },
        effective: {
          scope: {
            global: { local_field: { id: 7, name: 'Campo' } },
          },
        },
      },
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.annual_reports.count.mockResolvedValue(0);
    mockPrisma.annual_reports.findMany.mockResolvedValue([]);
  });

  it('forces local-field actors to their own field when listing admin annual reports', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth(),
    );
    const service = new AnnualReportsService(
      mockPrisma as any,
      mockAuthorizationContext as any,
      { getEffectiveCoordinatorSectionIds: jest.fn() } as any,
    );

    await service.listForAdmin('director-lf-user', { localFieldId: 99 });

    expect(mockPrisma.annual_reports.count).toHaveBeenCalledWith({
      where: {
        club: {
          local_field_id: 7,
        },
      },
    });
  });
});

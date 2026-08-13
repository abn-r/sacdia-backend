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

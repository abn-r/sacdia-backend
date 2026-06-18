import { coordinator_assignment_type } from '@prisma/client';
import { CoordinationService } from './coordination.service';
import { ErrorCode } from '../common/errors/error-codes';

describe('CoordinationService', () => {
  const prisma = {
    local_fields: { findUnique: jest.fn() },
    users: { findUnique: jest.fn() },
    club_sections: { findUnique: jest.fn(), findMany: jest.fn() },
    club_role_assignments: { findFirst: jest.fn() },
    coordinator_assignments: { create: jest.fn() },
  };

  const authorizationContext = {
    resolveUserAuthorization: jest.fn(),
    canAccessHierarchyScope: jest.fn(),
  };

  const hierarchy = {
    resolveCurrent: jest.fn(),
  };

  let service: CoordinationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CoordinationService(
      prisma as any,
      authorizationContext as any,
      hierarchy as any,
    );
  });

  it('rejects an assignment when the user is director of the same club_section', async () => {
    authorizationContext.resolveUserAuthorization.mockResolvedValue({});
    authorizationContext.canAccessHierarchyScope.mockReturnValue(true);
    hierarchy.resolveCurrent.mockResolvedValue({ local_field_id: 10 });
    prisma.local_fields.findUnique.mockResolvedValue({ local_field_id: 10 });
    prisma.users.findUnique.mockResolvedValue({
      user_id: '11111111-1111-1111-1111-111111111111',
      users_roles: [{ role_id: '22222222-2222-2222-2222-222222222222' }],
    });
    prisma.club_sections.findUnique.mockResolvedValue({
      club_section_id: 99,
      clubs: { local_field_id: 10 },
    });
    prisma.club_role_assignments.findFirst.mockResolvedValue({
      club_section_id: 99,
    });

    await expect(
      service.createAssignment('actor-user-id', 10, {
        user_id: '11111111-1111-1111-1111-111111111111',
        assignment_type: coordinator_assignment_type.SECTION,
        club_section_id: 99,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.RECORD_CONFLICT });

    expect(prisma.coordinator_assignments.create).not.toHaveBeenCalled();
  });
});

import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClassProgressAccessService } from './class-progress-access.service';

describe('ClassProgressAccessService', () => {
  let service: ClassProgressAccessService;

  const mockPrisma = {
    enrollments: {
      findFirst: jest.fn(),
    },
    class_counselor_assignments: {
      findFirst: jest.fn(),
    },
    club_role_assignments: {
      findMany: jest.fn(),
    },
  };
  const mockAuthorizationContext = {
    hasAnyGlobalRole: jest.fn(),
  };

  const baseParams = {
    actorUserId: '11111111-1111-1111-1111-111111111111',
    targetUserId: '22222222-2222-2222-2222-222222222222',
    classId: 7,
    ecclesiasticalYearId: 2026,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma.enrollments.findFirst.mockResolvedValue({
      enrollment_id: 10,
      user_id: baseParams.targetUserId,
      class_id: baseParams.classId,
      ecclesiastical_year_id: baseParams.ecclesiasticalYearId,
      active: true,
      classes: {
        club_type_id: 2,
      },
    });
    mockPrisma.class_counselor_assignments.findFirst.mockResolvedValue(null);
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValue(false);
    mockPrisma.club_role_assignments.findMany.mockImplementation(
      ({ where }: { where: { user_id?: string } }) => {
        if (where.user_id === baseParams.targetUserId) {
          return Promise.resolve([
            {
              club_section_id: 20,
              club_sections: { club_section_id: 20, club_type_id: 2 },
              roles: { role_name: 'member' },
            },
          ]);
        }

        return Promise.resolve([]);
      },
    );

    service = new ClassProgressAccessService(
      mockPrisma as unknown as PrismaService,
      mockAuthorizationContext as unknown as AuthorizationContextService,
    );
  });

  it('allows self access without consulting the database', async () => {
    await expect(
      service.assertCanAccessClassProgress({
        ...baseParams,
        targetUserId: baseParams.actorUserId,
      }),
    ).resolves.toBeUndefined();

    expect(mockPrisma.enrollments.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.class_counselor_assignments.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.club_role_assignments.findMany).not.toHaveBeenCalled();
    expect(mockAuthorizationContext.hasAnyGlobalRole).not.toHaveBeenCalled();
  });

  it('preserves global admin/coordinator access allowed by the existing guards', async () => {
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValue(true);

    await expect(
      service.assertCanAccessClassProgress(baseParams),
    ).resolves.toBeUndefined();

    expect(mockAuthorizationContext.hasAnyGlobalRole).toHaveBeenCalledWith(
      baseParams.actorUserId,
      [
        'super-admin',
        'admin',
        'assistant-admin',
        'coordinator',
        'zone-coordinator',
        'general-coordinator',
      ],
    );
    expect(mockPrisma.enrollments.findFirst).not.toHaveBeenCalled();
  });

  it('allows an assigned counselor when the target has an active enrollment in the same class and year', async () => {
    mockPrisma.class_counselor_assignments.findFirst.mockImplementation(
      ({ where }: { where: { club_section_id?: { in?: number[] } } }) => {
        if (where.club_section_id?.in?.includes(20)) {
          return Promise.resolve({
            assignment_id: '33333333-3333-3333-3333-333333333333',
            user_id: baseParams.actorUserId,
            club_section_id: 20,
            class_id: baseParams.classId,
            ecclesiastical_year_id: baseParams.ecclesiasticalYearId,
            active: true,
          });
        }

        return Promise.resolve(null);
      },
    );

    await expect(
      service.canAccessClassProgress(baseParams),
    ).resolves.toBe(true);

    expect(mockPrisma.enrollments.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: baseParams.targetUserId,
          class_id: baseParams.classId,
          ecclesiastical_year_id: baseParams.ecclesiasticalYearId,
          active: true,
        }),
      }),
    );
    expect(mockPrisma.class_counselor_assignments.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: baseParams.actorUserId,
          club_section_id: { in: [20] },
          class_id: baseParams.classId,
          ecclesiastical_year_id: baseParams.ecclesiasticalYearId,
          active: true,
        }),
      }),
    );
  });

  it('rejects an assigned counselor when the target belongs to another section', async () => {
    mockPrisma.club_role_assignments.findMany.mockImplementation(
      ({ where }: { where: { user_id?: string } }) => {
        if (where.user_id === baseParams.targetUserId) {
          return Promise.resolve([
            {
              club_section_id: 30,
              club_sections: { club_section_id: 30, club_type_id: 2 },
              roles: { role_name: 'member' },
            },
          ]);
        }

        return Promise.resolve([]);
      },
    );
    mockPrisma.class_counselor_assignments.findFirst.mockImplementation(
      ({ where }: { where: { club_section_id?: { in?: number[] } } }) => {
        if (where.club_section_id?.in?.includes(20)) {
          return Promise.resolve({
            assignment_id: '33333333-3333-3333-3333-333333333333',
            user_id: baseParams.actorUserId,
            club_section_id: 20,
            class_id: baseParams.classId,
            ecclesiastical_year_id: baseParams.ecclesiasticalYearId,
            active: true,
          });
        }

        return Promise.resolve(null);
      },
    );

    await expect(service.canAccessClassProgress(baseParams)).resolves.toBe(
      false,
    );

    expect(mockPrisma.class_counselor_assignments.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: baseParams.actorUserId,
          club_section_id: { in: [30] },
        }),
      }),
    );
  });

  it('allows section-wide leaders when the target class matches the section club type', async () => {
    mockPrisma.club_role_assignments.findMany.mockImplementation(
      ({ where }: { where: { user_id?: string } }) => {
        if (where.user_id === baseParams.targetUserId) {
          return Promise.resolve([
            {
              club_section_id: 99,
              club_sections: { club_section_id: 99, club_type_id: 2 },
              roles: { role_name: 'member' },
            },
          ]);
        }

        return Promise.resolve([
          {
            assignment_id: '44444444-4444-4444-4444-444444444444',
            user_id: baseParams.actorUserId,
            active: true,
            ecclesiastical_year_id: baseParams.ecclesiasticalYearId,
            roles: { role_name: 'director' },
            club_sections: { club_section_id: 99, club_type_id: 2 },
          },
        ]);
      },
    );

    await expect(
      service.assertCanAccessClassProgress(baseParams),
    ).resolves.toBeUndefined();

    expect(mockPrisma.club_role_assignments.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: baseParams.actorUserId,
          club_section_id: { in: [99] },
          ecclesiastical_year_id: baseParams.ecclesiasticalYearId,
          active: true,
          roles: {
            role_name: {
              in: ['director', 'deputy-director', 'secretary', 'secretary-treasurer'],
            },
          },
        }),
      }),
    );
  });

  it('rejects an instructor who is not a formal owner of the progress', async () => {
    mockPrisma.club_role_assignments.findMany.mockImplementation(
      ({ where }: { where: { user_id?: string } }) => {
        if (where.user_id === baseParams.targetUserId) {
          return Promise.resolve([
            {
              club_section_id: 99,
              club_sections: { club_section_id: 99, club_type_id: 2 },
              roles: { role_name: 'member' },
            },
          ]);
        }

        return Promise.resolve([
          {
            assignment_id: '55555555-5555-5555-5555-555555555555',
            user_id: baseParams.actorUserId,
            active: true,
            ecclesiastical_year_id: baseParams.ecclesiasticalYearId,
            roles: { role_name: 'instructor' },
            club_sections: { club_section_id: 99, club_type_id: 2 },
          },
        ]);
      },
    );

    await expect(
      service.assertCanAccessClassProgress(baseParams),
    ).rejects.toMatchObject({
      code: ErrorCode.GUARD_PERMISSION_DENIED,
    });
    await expect(
      service.assertCanAccessClassProgress(baseParams),
    ).rejects.toBeInstanceOf(AppForbiddenException);
  });
});

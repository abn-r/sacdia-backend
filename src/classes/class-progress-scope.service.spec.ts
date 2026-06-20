import { Test } from '@nestjs/testing';
import { ErrorCode } from '../common/errors/error-codes';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClassProgressScopeService } from './class-progress-scope.service';

describe('ClassProgressScopeService', () => {
  let service: ClassProgressScopeService;

  const mockPrisma = {
    club_sections: {
      findFirst: jest.fn(),
    },
    classes: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    class_counselor_assignments: {
      findMany: jest.fn(),
    },
    club_role_assignments: {
      findFirst: jest.fn(),
    },
    ecclesiastical_years: {
      findFirst: jest.fn(),
    },
    enrollments: {
      findMany: jest.fn(),
    },
    class_section_progress: {
      groupBy: jest.fn(),
    },
    class_sections: {
      count: jest.fn(),
    },
  };

  const mockAuthorizationContext = {
    hasAnyGlobalRole: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma.club_sections.findFirst.mockResolvedValue({
      club_section_id: 10,
      club_type_id: 2,
      main_club_id: 99,
    });
    mockPrisma.ecclesiastical_years.findFirst.mockResolvedValue({
      year_id: 2026,
    });
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValue(false);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ClassProgressScopeService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: AuthorizationContextService,
          useValue: mockAuthorizationContext,
        },
      ],
    }).compile();

    service = moduleRef.get(ClassProgressScopeService);
  });

  it('returns section-wide classes for global or section-wide actors', async () => {
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValue(true);
    mockPrisma.classes.findMany.mockResolvedValue([
      { class_id: 1, name: 'Lección 1', club_type_id: 2, active: true },
      { class_id: 2, name: 'Lección 2', club_type_id: 2, active: true },
    ]);

    await expect(
      service.getProgressScope({
        actorUserId: 'actor-1',
        clubId: 99,
        sectionId: 10,
      }),
    ).resolves.toEqual({
      club_section_id: 10,
      club_type_id: 2,
      ecclesiastical_year_id: 2026,
      access_level: 'section',
      classes: [
        {
          class_id: 1,
          name: 'Lección 1',
          club_type_id: 2,
          access_level: 'section',
        },
        {
          class_id: 2,
          name: 'Lección 2',
          club_type_id: 2,
          access_level: 'section',
        },
      ],
    });

    expect(mockPrisma.classes.findMany).toHaveBeenCalledWith({
      where: {
        active: true,
        club_type_id: 2,
      },
      select: {
        class_id: true,
        name: true,
        club_type_id: true,
      },
      orderBy: [{ display_order: 'asc' }, { class_id: 'asc' }],
    });
    expect(mockPrisma.class_counselor_assignments.findMany).not.toHaveBeenCalled();
  });

  it('returns only assigned active classes when the actor does not hold section-wide access', async () => {
    mockPrisma.club_role_assignments.findFirst.mockResolvedValue(null);
    mockPrisma.class_counselor_assignments.findMany.mockResolvedValue([
      {
        class_id: 7,
        classes: {
          class_id: 7,
          name: 'Ruta 1',
          club_type_id: 2,
          active: true,
        },
      },
      {
        class_id: 7,
        classes: {
          class_id: 7,
          name: 'Ruta 1',
          club_type_id: 2,
          active: true,
        },
      },
      {
        class_id: 8,
        classes: {
          class_id: 8,
          name: 'Ruta 2',
          club_type_id: 2,
          active: false,
        },
      },
    ]);

    await expect(
      service.getProgressScope({
        actorUserId: 'actor-2',
        clubId: 99,
        sectionId: 10,
        ecclesiasticalYearId: 2025,
      }),
    ).resolves.toEqual({
      club_section_id: 10,
      club_type_id: 2,
      ecclesiastical_year_id: 2025,
      access_level: 'assigned',
      classes: [
        {
          class_id: 7,
          name: 'Ruta 1',
          club_type_id: 2,
          access_level: 'assigned',
        },
      ],
    });

    expect(mockPrisma.class_counselor_assignments.findMany).toHaveBeenCalledWith({
      where: {
        user_id: 'actor-2',
        club_section_id: 10,
        ecclesiastical_year_id: 2025,
        active: true,
      },
      select: {
        class_id: true,
        classes: {
          select: {
            class_id: true,
            name: true,
            club_type_id: true,
            active: true,
            display_order: true,
          },
        },
      },
      orderBy: [{ created_at: 'asc' }, { class_id: 'asc' }],
    });
  });

  it('denies class member progress when the actor has no scope for that class', async () => {
    mockPrisma.class_counselor_assignments.findMany.mockResolvedValue([
      {
        class_id: 7,
        classes: {
          class_id: 7,
          name: 'Ruta 1',
          club_type_id: 2,
          active: true,
        },
      },
    ]);

    await expect(
      service.getClassMembersProgress({
        actorUserId: 'actor-3',
        clubId: 99,
        sectionId: 10,
        classId: 8,
        ecclesiasticalYearId: 2026,
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.GUARD_PERMISSION_DENIED,
    });

    expect(mockPrisma.enrollments.findMany).not.toHaveBeenCalled();
  });

  it('lists member progress summaries for an accessible class', async () => {
    mockPrisma.class_counselor_assignments.findMany.mockResolvedValue([
      {
        class_id: 7,
        classes: {
          class_id: 7,
          name: 'Ruta 1',
          club_type_id: 2,
          active: true,
        },
      },
    ]);
    mockPrisma.enrollments.findMany.mockResolvedValue([
      {
        enrollment_id: 101,
        user_id: 'user-1',
        class_id: 7,
        ecclesiastical_year_id: 2026,
        investiture_status: 'IN_PROGRESS',
        users: {
          user_id: 'user-1',
          name: 'Ana',
          paternal_last_name: 'López',
          maternal_last_name: 'García',
        },
      },
      {
        enrollment_id: 102,
        user_id: 'user-2',
        class_id: 7,
        ecclesiastical_year_id: 2026,
        investiture_status: 'VALIDATED',
        users: {
          user_id: 'user-2',
          name: 'Bruno',
          paternal_last_name: 'Pérez',
          maternal_last_name: 'Soto',
        },
      },
    ]);
    mockPrisma.class_section_progress.groupBy.mockResolvedValue([
      { enrollment_id: 101, _count: { section_progress_id: 1 } },
      { enrollment_id: 102, _count: { section_progress_id: 2 } },
    ]);
    mockPrisma.class_sections.count.mockResolvedValue(4);

    await expect(
      service.getClassMembersProgress({
        actorUserId: 'actor-4',
        clubId: 99,
        sectionId: 10,
        classId: 7,
        ecclesiasticalYearId: 2026,
      }),
    ).resolves.toEqual({
      club_section_id: 10,
      club_type_id: 2,
      class_id: 7,
      ecclesiastical_year_id: 2026,
      access_level: 'assigned',
      members: [
        {
          user_id: 'user-1',
          name: 'Ana',
          enrollment_id: 101,
          class_id: 7,
          ecclesiastical_year_id: 2026,
          investiture_status: 'IN_PROGRESS',
          completed_sections: 1,
          total_sections: 4,
          overall_progress: 25,
        },
        {
          user_id: 'user-2',
          name: 'Bruno',
          enrollment_id: 102,
          class_id: 7,
          ecclesiastical_year_id: 2026,
          investiture_status: 'VALIDATED',
          completed_sections: 2,
          total_sections: 4,
          overall_progress: 50,
        },
      ],
    });

    expect(mockPrisma.enrollments.findMany).toHaveBeenCalledWith({
      where: {
        class_id: 7,
        ecclesiastical_year_id: 2026,
        active: true,
        users: {
          club_role_assignments: {
            some: {
              club_section_id: 10,
              ecclesiastical_year_id: 2026,
              active: true,
            },
          },
        },
      },
      select: {
        enrollment_id: true,
        user_id: true,
        class_id: true,
        ecclesiastical_year_id: true,
        investiture_status: true,
        users: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
      orderBy: [{ users: { name: 'asc' } }, { user_id: 'asc' }],
    });
  });
});

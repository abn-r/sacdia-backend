import { ClassCounselorAssignmentsService } from './class-counselor-assignments.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ClassCounselorAssignmentsService', () => {
  let service: ClassCounselorAssignmentsService;

  const mockPrisma = {
    ecclesiastical_years: {
      findFirst: jest.fn(),
    },
    club_sections: {
      findFirst: jest.fn(),
    },
    classes: {
      findFirst: jest.fn(),
    },
    club_role_assignments: {
      findFirst: jest.fn(),
    },
    enrollments: {
      findFirst: jest.fn(),
    },
    class_counselor_assignments: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const baseParams = {
    clubId: 1,
    sectionId: 20,
    actorUserId: '11111111-1111-1111-1111-111111111111',
    dto: {
      user_id: '22222222-2222-2222-2222-222222222222',
      class_id: 7,
      ecclesiastical_year_id: 2026,
      responsibility_type: 'primary' as const,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma.ecclesiastical_years.findFirst.mockResolvedValue({
      year_id: 2026,
    });
    mockPrisma.club_sections.findFirst.mockResolvedValue({
      club_section_id: 20,
      main_club_id: 1,
      club_type_id: 2,
    });
    mockPrisma.classes.findFirst.mockResolvedValue({
      class_id: 7,
      club_type_id: 2,
      active: true,
    });
    mockPrisma.club_role_assignments.findFirst.mockResolvedValue({
      assignment_id: '33333333-3333-3333-3333-333333333333',
      roles: { role_name: 'counselor' },
    });
    mockPrisma.enrollments.findFirst.mockResolvedValue({
      enrollment_id: 55,
      investiture_status: 'IN_PROGRESS',
      classes: { name: 'Guía Mayor' },
    });
    mockPrisma.class_counselor_assignments.count.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        if (where.user_id === baseParams.dto.user_id) return Promise.resolve(0);
        return Promise.resolve(0);
      },
    );
    mockPrisma.class_counselor_assignments.findFirst.mockResolvedValue(null);
    mockPrisma.class_counselor_assignments.findMany.mockResolvedValue([]);
    mockPrisma.class_counselor_assignments.findUnique.mockResolvedValue({
      assignment_id: '44444444-4444-4444-4444-444444444444',
      user_id: baseParams.dto.user_id,
      club_section_id: 20,
      class_id: 7,
      ecclesiastical_year_id: 2026,
      responsibility_type: 'assistant',
      active: true,
      exceptional: false,
      exception_reason: null,
    });
    mockPrisma.class_counselor_assignments.create.mockResolvedValue({
      assignment_id: '44444444-4444-4444-4444-444444444444',
      user_id: baseParams.dto.user_id,
      class_id: 7,
      responsibility_type: 'primary',
      active: true,
    });
    mockPrisma.class_counselor_assignments.update.mockResolvedValue({
      assignment_id: '44444444-4444-4444-4444-444444444444',
      user_id: baseParams.dto.user_id,
      class_id: 7,
      responsibility_type: 'primary',
      active: true,
    });

    service = new ClassCounselorAssignmentsService(
      mockPrisma as unknown as PrismaService,
    );
  });

  it('creates a primary class counselor assignment for a counselor in the same section and class type', async () => {
    await expect(service.createAssignment(baseParams)).resolves.toMatchObject({
      assignment_id: '44444444-4444-4444-4444-444444444444',
      responsibility_type: 'primary',
    });

    expect(mockPrisma.class_counselor_assignments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: baseParams.dto.user_id,
          class_id: 7,
          club_section_id: 20,
          responsibility_type: 'primary',
          exceptional: false,
        }),
      }),
    );
  });

  it('rejects a fourth active assignment for the same class in the same section and year', async () => {
    mockPrisma.class_counselor_assignments.count.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        if (
          where.club_section_id === 20 &&
          where.class_id === 7 &&
          where.ecclesiastical_year_id === 2026
        ) {
          return Promise.resolve(3);
        }

        return Promise.resolve(0);
      },
    );

    await expect(service.createAssignment(baseParams)).rejects.toMatchObject({
      code: 'CLASS_COUNSELOR_CLASS_LIMIT_REACHED',
    });
  });

  it('rejects a second class for the same assignee without an exceptional reason', async () => {
    mockPrisma.class_counselor_assignments.count.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        if (
          where.user_id === baseParams.dto.user_id &&
          where.club_section_id === 20 &&
          where.ecclesiastical_year_id === 2026
        ) {
          return Promise.resolve(1);
        }

        return Promise.resolve(0);
      },
    );

    await expect(service.createAssignment(baseParams)).rejects.toMatchObject({
      code: 'CLASS_COUNSELOR_EXCEPTION_REQUIRED',
    });
  });

  it('rejects assigning an instructor as formal owner of the class trajectory', async () => {
    mockPrisma.club_role_assignments.findFirst.mockResolvedValue({
      assignment_id: '33333333-3333-3333-3333-333333333333',
      roles: { role_name: 'instructor' },
    });

    await expect(service.createAssignment(baseParams)).rejects.toMatchObject({
      code: 'CLASS_COUNSELOR_ROLE_NOT_ASSIGNABLE',
    });
  });

  it('rejects assigning a responsible person who is not studying or invested as Guía Mayor', async () => {
    mockPrisma.enrollments.findFirst.mockResolvedValue(null);

    await expect(service.createAssignment(baseParams)).rejects.toMatchObject({
      code: 'CLASS_COUNSELOR_GUIDE_MAJOR_REQUIRED',
    });

    expect(mockPrisma.enrollments.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: baseParams.dto.user_id,
        }),
      }),
    );
    expect(
      mockPrisma.class_counselor_assignments.create,
    ).not.toHaveBeenCalled();
  });

  it('lists class counselor assignments for a club section and year', async () => {
    mockPrisma.class_counselor_assignments.findMany.mockResolvedValue([
      {
        assignment_id: '44444444-4444-4444-4444-444444444444',
        user_id: baseParams.dto.user_id,
        club_section_id: 20,
        class_id: 7,
        ecclesiastical_year_id: 2026,
        responsibility_type: 'primary',
        active: true,
      },
    ]);

    await expect(
      service.listAssignments({
        clubId: 1,
        sectionId: 20,
        ecclesiasticalYearId: 2026,
      }),
    ).resolves.toHaveLength(1);

    expect(
      mockPrisma.class_counselor_assignments.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          club_section_id: 20,
          ecclesiastical_year_id: 2026,
          active: true,
        }),
      }),
    );
  });

  it('updates assignment responsibility while preserving class limits', async () => {
    await expect(
      service.updateAssignment('44444444-4444-4444-4444-444444444444', {
        responsibility_type: 'primary',
      }),
    ).resolves.toMatchObject({
      assignment_id: '44444444-4444-4444-4444-444444444444',
      responsibility_type: 'primary',
    });

    expect(
      mockPrisma.class_counselor_assignments.findFirst,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          club_section_id: 20,
          class_id: 7,
          ecclesiastical_year_id: 2026,
          responsibility_type: 'primary',
          active: true,
          assignment_id: { not: '44444444-4444-4444-4444-444444444444' },
        }),
      }),
    );
    expect(mockPrisma.class_counselor_assignments.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assignment_id: '44444444-4444-4444-4444-444444444444' },
        data: expect.objectContaining({
          responsibility_type: 'primary',
        }),
      }),
    );
  });

  it('soft-deactivates a class counselor assignment when removed', async () => {
    await expect(
      service.removeAssignment('44444444-4444-4444-4444-444444444444'),
    ).resolves.toMatchObject({
      assignment_id: '44444444-4444-4444-4444-444444444444',
    });

    expect(mockPrisma.class_counselor_assignments.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assignment_id: '44444444-4444-4444-4444-444444444444' },
        data: expect.objectContaining({
          active: false,
          end_date: expect.any(Date),
        }),
      }),
    );
  });
});

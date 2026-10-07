import { Prisma } from '@prisma/client';
import { ClassRequirementEligibilityService } from './class-requirement-eligibility.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ClassRequirementEligibilityService', () => {
  let service: ClassRequirementEligibilityService;

  const mockPrisma = {
    enrollments: { findUnique: jest.fn() },
    class_sections: { findMany: jest.fn() },
    class_section_progress: { findMany: jest.fn() },
    users_pr: { findUnique: jest.fn() },
    club_role_assignments: { findMany: jest.fn() },
  } as unknown as jest.Mocked<PrismaService>;

  const enrollment = {
    enrollment_id: 10,
    user_id: 'user-1',
    class_id: 7,
    ecclesiastical_year_id: 2026,
    classes: {
      class_id: 7,
      club_type_id: 2,
      advanced_enabled: false,
    },
    ecclesiastical_year: {
      year_id: 2026,
      start_date: new Date('2026-01-01T00:00:00.000Z'),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ClassRequirementEligibilityService(mockPrisma);

    (mockPrisma.enrollments.findUnique as jest.Mock).mockResolvedValue(
      enrollment,
    );
    (mockPrisma.users_pr.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.club_role_assignments.findMany as jest.Mock).mockResolvedValue([
      {
        club_sections: {
          clubs: {
            local_field_id: 30,
            local_fields: {
              local_field_id: 30,
              union_id: 20,
              unions: { union_id: 20, division_id: 1 },
            },
          },
        },
      },
    ]);
  });

  it('counts basic plus applicable extra for investiture and ignores disabled advanced', async () => {
    (mockPrisma.class_sections.findMany as jest.Mock).mockResolvedValue([
      {
        section_id: 101,
        requirement_track: 'BASIC',
        required_for_investiture: true,
        owner_division_id: null,
        owner_union_id: null,
        owner_local_field_id: null,
      },
      {
        section_id: 102,
        requirement_track: 'ADVANCED',
        required_for_investiture: false,
        owner_division_id: null,
        owner_union_id: null,
        owner_local_field_id: null,
      },
      {
        section_id: 103,
        requirement_track: 'EXTRA',
        required_for_investiture: true,
        owner_division_id: null,
        owner_union_id: null,
        owner_local_field_id: 30,
      },
      {
        section_id: 104,
        requirement_track: 'EXTRA',
        required_for_investiture: true,
        owner_division_id: null,
        owner_union_id: 99,
        owner_local_field_id: null,
      },
    ]);
    (mockPrisma.class_section_progress.findMany as jest.Mock).mockResolvedValue([
      { section_id: 101, status: 'VALIDATED', score: 0 },
      { section_id: 103, status: 'PENDING', score: 80 },
      { section_id: 102, status: 'VALIDATED', score: 100 },
    ]);

    const result = await service.calculateForEnrollment(10);

    expect(result).toMatchObject({
      passing_score: 80,
      applicable_section_ids: [101, 103],
      required_investiture_section_ids: [101, 103],
      overall_progress: 100,
      investiture_eligibility: { eligible: true, missing_required_sections: 0 },
      advanced_eligibility: { enabled: false, eligible: false },
    });
  });

  it('never counts a REJECTED section as completed regardless of score', async () => {
    (mockPrisma.class_sections.findMany as jest.Mock).mockResolvedValue([
      {
        section_id: 101,
        requirement_track: 'BASIC',
        required_for_investiture: true,
        owner_division_id: null,
        owner_union_id: null,
        owner_local_field_id: null,
      },
      {
        section_id: 102,
        requirement_track: 'BASIC',
        required_for_investiture: true,
        owner_division_id: null,
        owner_union_id: null,
        owner_local_field_id: null,
      },
    ]);
    (mockPrisma.class_section_progress.findMany as jest.Mock).mockResolvedValue([
      { section_id: 101, status: 'REJECTED', score: 100 },
      { section_id: 102, status: 'PENDING', score: 80 },
    ]);

    const result = await service.calculateForEnrollment(10);

    expect(result).toMatchObject({
      applicable_section_ids: [101, 102],
      required_investiture_section_ids: [101, 102],
      overall_progress: 50,
      investiture_eligibility: { eligible: false, missing_required_sections: 1 },
    });
  });

  it('blocks investiture eligibility when extra requirements exist but institutional context is missing', async () => {
    (mockPrisma.club_role_assignments.findMany as jest.Mock).mockResolvedValue(
      [],
    );
    (mockPrisma.class_sections.findMany as jest.Mock).mockResolvedValue([
      {
        section_id: 101,
        requirement_track: 'BASIC',
        required_for_investiture: true,
        owner_division_id: null,
        owner_union_id: null,
        owner_local_field_id: null,
      },
      {
        section_id: 103,
        requirement_track: 'EXTRA',
        required_for_investiture: true,
        owner_division_id: null,
        owner_union_id: 20,
        owner_local_field_id: null,
      },
    ]);
    (mockPrisma.class_section_progress.findMany as jest.Mock).mockResolvedValue([
      { section_id: 101, status: 'VALIDATED', score: 0 },
    ]);

    const result = await service.calculateForEnrollment(10);

    expect(result?.investiture_eligibility).toMatchObject({
      eligible: false,
      reason: 'INSTITUTIONAL_CONTEXT_REQUIRED',
      context_resolved: false,
    });
  });

  it('uses 80 by default and a configured field percent when present', async () => {
    (mockPrisma.class_sections.findMany as jest.Mock).mockResolvedValue([
      {
        section_id: 101,
        requirement_track: 'BASIC',
        required_for_investiture: true,
        owner_division_id: null,
        owner_union_id: null,
        owner_local_field_id: null,
      },
    ]);
    (mockPrisma.class_section_progress.findMany as jest.Mock).mockResolvedValue([
      { section_id: 101, status: 'PENDING', score: 79 },
    ]);

    const belowDefault = await service.calculateForEnrollment(10);
    expect(belowDefault).toMatchObject({
      passing_score: 80,
      investiture_progress: { completed: 0, total: 1 },
    });

    (
      mockPrisma as unknown as {
        local_field_class_thresholds: { findUnique: jest.Mock };
      }
    ).local_field_class_thresholds = {
      findUnique: jest.fn().mockResolvedValue({ minimum_percent: 90 }),
    };
    (mockPrisma.class_section_progress.findMany as jest.Mock).mockResolvedValue([
      { section_id: 101, status: 'PENDING', score: 85 },
    ]);

    const belowConfigured = await service.calculateForEnrollment(10);
    expect(belowConfigured).toMatchObject({
      passing_score: 90,
      investiture_progress: { completed: 0, total: 1 },
    });

    (
      mockPrisma as unknown as {
        local_field_class_thresholds: { findUnique: jest.Mock };
      }
    ).local_field_class_thresholds.findUnique.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'The table `public.local_field_class_thresholds` does not exist',
        { code: 'P2021', clientVersion: '7.9.1' },
      ),
    );

    const missingTable = await service.calculateForEnrollment(10);
    expect(missingTable).toMatchObject({ passing_score: 80 });
  });

  it('does not query a threshold when the field is unresolved, and does when the field has no row', async () => {
    (mockPrisma.club_role_assignments.findMany as jest.Mock).mockResolvedValue(
      [],
    );
    (mockPrisma.class_sections.findMany as jest.Mock).mockResolvedValue([
      {
        section_id: 101,
        requirement_track: 'BASIC',
        required_for_investiture: true,
        owner_division_id: null,
        owner_union_id: null,
        owner_local_field_id: null,
      },
    ]);
    (mockPrisma.class_section_progress.findMany as jest.Mock).mockResolvedValue(
      [{ section_id: 101, status: 'PENDING', score: 85 }],
    );
    const findUnique = jest.fn().mockResolvedValue(null);
    (
      mockPrisma as unknown as {
        local_field_class_thresholds: { findUnique: jest.Mock };
      }
    ).local_field_class_thresholds = { findUnique };

    const unresolved = await service.calculateForEnrollment(10);
    expect(unresolved?.passing_score).toBe(80);
    expect(findUnique).not.toHaveBeenCalled();

    (mockPrisma.club_role_assignments.findMany as jest.Mock).mockResolvedValue([
      {
        club_sections: {
          club_type_id: 2,
          clubs: {
            local_field_id: 30,
            local_fields: {
              local_field_id: 30,
              union_id: 20,
              unions: { union_id: 20, division_id: 1 },
            },
          },
        },
      },
    ]);
    const noRow = await service.calculateForEnrollment(10);
    expect(noRow?.passing_score).toBe(80);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('uses the home field threshold for a cross-type enrollment in detail, eligibility and the collective batch', async () => {
    const basicSection = {
      section_id: 101,
      requirement_track: 'BASIC',
      required_for_investiture: true,
      owner_division_id: null,
      owner_union_id: null,
      owner_local_field_id: null,
    };
    const field = (clubTypeId: number, userId: string) => ({
      assignment_id: `assignment-${userId}`,
      user_id: userId,
      ecclesiastical_year_id: 2026,
      club_sections: {
        club_type_id: clubTypeId,
        clubs: {
          local_field_id: 30,
          local_fields: {
            local_field_id: 30,
            union_id: 20,
            unions: { union_id: 20, division_id: 1 },
          },
        },
      },
    });
    const regular = { ...enrollment, enrollment_id: 10, user_id: 'user-1' };
    const cross = {
      ...enrollment,
      enrollment_id: 11,
      user_id: 'gm-user',
      cross_type_enrollment: true,
    };
    (mockPrisma.enrollments.findUnique as jest.Mock).mockImplementation(
      async ({ where }: { where: { enrollment_id: number } }) =>
        where.enrollment_id === 11 ? cross : regular,
    );
    (mockPrisma.enrollments as { findMany: jest.Mock }).findMany = jest
      .fn()
      .mockResolvedValue([
        regular,
        cross,
        { ...regular, enrollment_id: 12, user_id: 'user-2' },
        { ...regular, enrollment_id: 13, user_id: 'user-3' },
      ]);
    (mockPrisma.users_pr as { findMany: jest.Mock }).findMany = jest
      .fn()
      .mockResolvedValue([]);
    (mockPrisma.club_role_assignments.findMany as jest.Mock).mockImplementation(
      async ({ where }: { where: Record<string, unknown> }) => {
        const section = where.club_sections as
          { club_type_id?: number } | undefined;
        const userFilter = where.user_id as
          string | { in?: string[] } | undefined;
        const users = Array.isArray((userFilter as { in?: string[] })?.in)
          ? (userFilter as { in: string[] }).in
          : [typeof userFilter === 'string' ? userFilter : 'user-1'];
        const rows = [];
        const matches = (userId: string, clubTypeId: number) =>
          users.includes(userId) &&
          (section?.club_type_id == null ||
            section.club_type_id === clubTypeId);
        if (matches('user-1', 2)) rows.push(field(2, 'user-1'));
        if (matches('user-2', 2)) rows.push(field(2, 'user-2'));
        if (matches('user-3', 2)) rows.push(field(2, 'user-3'));
        if (matches('gm-user', 3)) rows.push(field(3, 'gm-user'));
        return rows;
      },
    );
    (mockPrisma.class_sections.findMany as jest.Mock).mockResolvedValue([
      basicSection,
    ]);
    (
      mockPrisma.class_section_progress.findMany as jest.Mock
    ).mockImplementation(
      async ({
        where,
      }: {
        where: { enrollment_id: number | { in: number[] } };
      }) => {
        const ids = Array.isArray((where.enrollment_id as { in?: number[] }).in)
          ? (where.enrollment_id as { in: number[] }).in
          : [where.enrollment_id as number];
        return ids.map((enrollmentId) => ({
          enrollment_id: enrollmentId,
          section_id: 101,
          status: 'PENDING',
          score: 85,
        }));
      },
    );
    const findUnique = jest.fn().mockResolvedValue({ minimum_percent: 90 });
    const findMany = jest.fn().mockResolvedValue([
      {
        local_field_id: 30,
        ecclesiastical_year_id: 2026,
        minimum_percent: 90,
      },
    ]);
    (
      mockPrisma as unknown as {
        local_field_class_thresholds: {
          findUnique: jest.Mock;
          findMany: jest.Mock;
        };
      }
    ).local_field_class_thresholds = { findUnique, findMany };

    const regularResult = await service.calculateForEnrollment(10);
    const crossResult = await service.calculateForEnrollment(11);
    expect(regularResult).toMatchObject({
      passing_score: 90,
      investiture_eligibility: { eligible: false },
    });
    expect(crossResult).toMatchObject({
      passing_score: 90,
      investiture_eligibility: { eligible: false },
    });
    expect(findUnique.mock.calls.length).toBeGreaterThan(0);

    findUnique.mockClear();
    (mockPrisma.class_sections.findMany as jest.Mock).mockClear();
    (mockPrisma.class_section_progress.findMany as jest.Mock).mockClear();
    (mockPrisma.club_role_assignments.findMany as jest.Mock).mockClear();

    const batch = await service.calculateForEnrollments([10, 11, 12, 13]);
    expect(batch.get(10)?.passing_score).toBe(90);
    expect(batch.get(11)?.passing_score).toBe(90);
    expect(batch.get(11)?.investiture_eligibility.eligible).toBe(false);
    expect(mockPrisma.class_sections.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.class_section_progress.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.club_role_assignments.findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findUnique).not.toHaveBeenCalled();
  });
});

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
      applicable_section_ids: [101, 103],
      required_investiture_section_ids: [101, 103],
      overall_progress: 100,
      investiture_eligibility: { eligible: true, missing_required_sections: 0 },
      advanced_eligibility: { enabled: false, eligible: false },
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
});

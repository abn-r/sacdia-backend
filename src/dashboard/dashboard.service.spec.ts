import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';
import { ClassRequirementEligibilityService } from '../classes/class-requirement-eligibility.service';

describe('DashboardService', () => {
  let service: DashboardService;

  const mockPrismaService = {
    users: { findUnique: jest.fn() },
    enrollments: { findFirst: jest.fn() },
    users_honors: { findMany: jest.fn() },
    users_pr: { findUnique: jest.fn() },
    club_role_assignments: { findFirst: jest.fn() },
    class_section_progress: { count: jest.fn() },
    class_sections: { count: jest.fn() },
    activities: { findMany: jest.fn() },
  };

  const mockFileStorageService = {
    getSignedDownloadUrl: jest
      .fn()
      .mockImplementation((_bucket: unknown, key: string) =>
        Promise.resolve(key),
      ),
  };

  const mockRequirementEligibilityService = {
    calculateForEnrollment: jest.fn(),
    calculateForEnrollmentRecord: jest.fn(),
  };

  const assignmentClubCentral = {
    assignment_id: 'assign-uuid-007',
    club_sections: {
      club_section_id: 7,
      club_types: { name: 'Conquistadores' },
      clubs: { name: 'Club Central' },
    },
    roles: { role_name: 'member' },
  };

  const amigoEnrollment = {
    enrollment_id: 10,
    user_id: 'user-uuid-001',
    class_id: 3,
    ecclesiastical_year_id: 1,
    classes: {
      class_id: 3,
      name: 'Amigo',
      club_type_id: 2,
      advanced_enabled: false,
    },
    ecclesiastical_year: {
      year_id: 1,
      start_date: new Date('2025-09-01'),
    },
  };

  beforeEach(async () => {
    mockRequirementEligibilityService.calculateForEnrollment.mockResolvedValue({
      overall_progress: 0,
    });
    mockRequirementEligibilityService.calculateForEnrollmentRecord.mockResolvedValue(
      { overall_progress: 0 },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
        {
          provide: ClassRequirementEligibilityService,
          useValue: mockRequirementEligibilityService,
        },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  function expectSingleUserRoundTrip() {
    expect(mockPrismaService.users.findUnique).toHaveBeenCalledTimes(1);
    expect(mockPrismaService.users_pr.findUnique).not.toHaveBeenCalled();
    expect(mockPrismaService.users_honors.findMany).not.toHaveBeenCalled();
    expect(mockPrismaService.enrollments.findFirst).not.toHaveBeenCalled();
    expect(
      mockPrismaService.club_role_assignments.findFirst,
    ).not.toHaveBeenCalled();
    expect(
      mockRequirementEligibilityService.calculateForEnrollment,
    ).not.toHaveBeenCalled();
  }

  // ----------------------------------------
  // Scenario 1: user with full data (with explicit active assignment stored in users_pr)
  // ----------------------------------------
  describe('user with full data', () => {
    it('returns complete dashboard summary using the stored active_club_assignment_id', async () => {
      const userId = 'user-uuid-001';

      mockPrismaService.users.findUnique.mockResolvedValue({
        name: 'Juan',
        paternal_last_name: 'Pérez',
        maternal_last_name: 'García',
        user_image: 'https://cdn.example.com/avatar.jpg',
        users_pr: { active_club_assignment_id: assignmentClubCentral.assignment_id },
        users_honors: [{ validate: true }, { validate: true }, { validate: false }],
        enrollments: [amigoEnrollment],
        club_role_assignments: [
          {
            assignment_id: 'assign-older',
            club_sections: {
              club_section_id: 1,
              club_types: { name: 'Aventureros' },
              clubs: { name: 'Club Viejo' },
            },
            roles: { role_name: 'director' },
          },
          assignmentClubCentral,
        ],
      });

      mockRequirementEligibilityService.calculateForEnrollmentRecord.mockResolvedValue(
        { overall_progress: 40 },
      );

      mockPrismaService.activities.findMany.mockResolvedValue([
        {
          activity_id: 1,
          name: 'Campamento',
          activity_date: new Date('2026-04-10'),
          activity_time: '09:00',
          activity_place: 'Parque Nacional',
          activity_types: { name: 'Outdoor' },
        },
      ]);

      const result = await service.getSummary(userId);

      expect(result.user_name).toBe('Juan Pérez García');
      expect(result.user_avatar).toBe('https://cdn.example.com/avatar.jpg');
      expect(result.club_name).toBe('Club Central');
      expect(result.club_type).toBe('Conquistadores');
      expect(result.user_role).toBe('member');
      expect(result.current_class_name).toBe('Amigo');
      expect(result.class_progress).toBe(40);
      expect(result.honors_completed).toBe(2);
      expect(result.honors_in_progress).toBe(1);
      expect(result.upcoming_activities).toHaveLength(1);
      expect(result.upcoming_activities[0].id).toBe(1);
      expect(result.upcoming_activities[0].title).toBe('Campamento');
      expect(result.upcoming_activities[0].location).toBe('Parque Nacional');
      expect(mockPrismaService.activities.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            active: true,
            activity_instances: {
              some: { active: true, club_section_id: 7 },
            },
            activity_date: { gte: expect.any(Date) },
          }),
        }),
      );
      expect(
        mockRequirementEligibilityService.calculateForEnrollmentRecord,
      ).toHaveBeenCalledWith(amigoEnrollment);
      expectSingleUserRoundTrip();
    });

    it('falls back to most-recent active assignment when stored ID is no longer active', async () => {
      const userId = 'user-uuid-001b';
      const staleAssignmentId = 'assign-stale-001';

      mockPrismaService.users.findUnique.mockResolvedValue({
        name: 'Juan',
        paternal_last_name: 'Pérez',
        maternal_last_name: null,
        user_image: null,
        users_pr: { active_club_assignment_id: staleAssignmentId },
        users_honors: [],
        enrollments: [],
        club_role_assignments: [
          {
            assignment_id: 'assign-current',
            club_sections: {
              club_section_id: 9,
              club_types: { name: 'Aventureros' },
              clubs: { name: 'Club Sur' },
            },
            roles: { role_name: 'member' },
          },
        ],
      });

      mockPrismaService.activities.findMany.mockResolvedValue([]);

      const result = await service.getSummary(userId);

      expect(result.club_name).toBe('Club Sur');
      expect(result.club_type).toBe('Aventureros');
      expectSingleUserRoundTrip();
    });
  });

  // ----------------------------------------
  // Scenario 2: user with no enrollment
  // ----------------------------------------
  describe('user with no enrollment', () => {
    it('returns null class name and 0 progress', async () => {
      const userId = 'user-uuid-002';
      const activeAssignmentId = 'assign-uuid-005';

      mockPrismaService.users.findUnique.mockResolvedValue({
        name: 'María',
        paternal_last_name: 'López',
        maternal_last_name: null,
        user_image: null,
        users_pr: { active_club_assignment_id: activeAssignmentId },
        users_honors: [],
        enrollments: [],
        club_role_assignments: [
          {
            assignment_id: activeAssignmentId,
            club_sections: {
              club_section_id: 5,
              club_types: { name: 'Aventureros' },
              clubs: { name: 'Club Norte' },
            },
            roles: { role_name: 'director' },
          },
        ],
      });

      mockPrismaService.activities.findMany.mockResolvedValue([]);

      const result = await service.getSummary(userId);

      expect(result.current_class_name).toBeNull();
      expect(result.class_progress).toBe(0);
      expect(result.honors_completed).toBe(0);
      expect(result.honors_in_progress).toBe(0);
      expect(result.club_name).toBe('Club Norte');
      expect(result.user_name).toBe('María López');
      expect(
        mockRequirementEligibilityService.calculateForEnrollmentRecord,
      ).not.toHaveBeenCalled();
      expectSingleUserRoundTrip();
    });
  });

  // ----------------------------------------
  // Scenario 3: user with no club
  // ----------------------------------------
  describe('user with no club', () => {
    it('returns null club fields and empty upcoming activities when no assignment exists', async () => {
      const userId = 'user-uuid-003';

      mockPrismaService.users.findUnique.mockResolvedValue({
        name: 'Carlos',
        paternal_last_name: null,
        maternal_last_name: null,
        user_image: null,
        users_pr: null,
        users_honors: [{ validate: true }],
        enrollments: [
          {
            enrollment_id: 20,
            user_id: userId,
            class_id: 2,
            ecclesiastical_year_id: 1,
            classes: {
              class_id: 2,
              name: 'Conquistador',
              club_type_id: 2,
              advanced_enabled: false,
            },
            ecclesiastical_year: {
              year_id: 1,
              start_date: new Date('2025-09-01'),
            },
          },
        ],
        club_role_assignments: [],
      });

      mockRequirementEligibilityService.calculateForEnrollmentRecord.mockResolvedValue(
        { overall_progress: 25 },
      );

      const result = await service.getSummary(userId);

      expect(result.club_name).toBeNull();
      expect(result.club_type).toBeNull();
      expect(result.user_role).toBeNull();
      expect(result.upcoming_activities).toEqual([]);
      expect(mockPrismaService.activities.findMany).not.toHaveBeenCalled();
      expect(result.current_class_name).toBe('Conquistador');
      expect(result.class_progress).toBe(25);
      expect(result.honors_completed).toBe(1);
      expect(result.honors_in_progress).toBe(0);
      expectSingleUserRoundTrip();
    });

    it('uses fallback when users_pr has no active_club_assignment_id', async () => {
      const userId = 'user-uuid-003b';

      mockPrismaService.users.findUnique.mockResolvedValue({
        name: 'Carlos',
        paternal_last_name: null,
        maternal_last_name: null,
        user_image: null,
        users_pr: { active_club_assignment_id: null },
        users_honors: [],
        enrollments: [],
        club_role_assignments: [
          {
            assignment_id: 'assign-latest',
            club_sections: {
              club_section_id: 3,
              club_types: { name: 'Conquistadores' },
              clubs: { name: 'Club Este' },
            },
            roles: { role_name: 'member' },
          },
        ],
      });

      mockPrismaService.activities.findMany.mockResolvedValue([]);

      const result = await service.getSummary(userId);

      expect(result.club_name).toBe('Club Este');
      expect(result.club_type).toBe('Conquistadores');
      expectSingleUserRoundTrip();
    });
  });

  // ----------------------------------------
  // Scenario 4: class progress = 0 when totalSections = 0
  // ----------------------------------------
  describe('edge case: no sections defined for class', () => {
    it('returns 0 progress when totalSections is 0 (avoids division by zero)', async () => {
      const userId = 'user-uuid-004';

      mockPrismaService.users.findUnique.mockResolvedValue({
        name: 'Ana',
        paternal_last_name: 'Torres',
        maternal_last_name: null,
        user_image: null,
        users_pr: null,
        users_honors: [],
        enrollments: [
          {
            enrollment_id: 30,
            user_id: userId,
            class_id: 5,
            ecclesiastical_year_id: 1,
            classes: {
              class_id: 5,
              name: 'Avanzado',
              club_type_id: 2,
              advanced_enabled: false,
            },
            ecclesiastical_year: {
              year_id: 1,
              start_date: new Date('2025-09-01'),
            },
          },
        ],
        club_role_assignments: [],
      });

      mockRequirementEligibilityService.calculateForEnrollmentRecord.mockResolvedValue(
        { overall_progress: 0 },
      );

      const result = await service.getSummary(userId);

      expect(result.class_progress).toBe(0);
      expectSingleUserRoundTrip();
    });
  });

  // ----------------------------------------
  // Scenario 5: progress record with score < 70 must NOT count as completed
  // ----------------------------------------
  describe('edge case: section progress record with score = 0', () => {
    it('returns 0 progress when the only progress record has score < 70', async () => {
      const userId = 'user-uuid-005';

      mockPrismaService.users.findUnique.mockResolvedValue({
        name: 'Pedro',
        paternal_last_name: 'Ruiz',
        maternal_last_name: null,
        user_image: null,
        users_pr: null,
        users_honors: [],
        enrollments: [
          {
            enrollment_id: 1,
            user_id: userId,
            class_id: 13,
            ecclesiastical_year_id: 1,
            classes: {
              class_id: 13,
              name: 'Guía Mayor',
              club_type_id: 3,
              advanced_enabled: false,
            },
            ecclesiastical_year: {
              year_id: 1,
              start_date: new Date('2025-09-01'),
            },
          },
        ],
        club_role_assignments: [],
      });

      mockRequirementEligibilityService.calculateForEnrollmentRecord.mockResolvedValue(
        { overall_progress: 0 },
      );

      const result = await service.getSummary(userId);

      expect(result.current_class_name).toBe('Guía Mayor');
      expect(result.class_progress).toBe(0);

      expect(
        mockRequirementEligibilityService.calculateForEnrollmentRecord,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ enrollment_id: 1 }),
      );
      expectSingleUserRoundTrip();
    });
  });
});

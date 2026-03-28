import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';

describe('DashboardService', () => {
  let service: DashboardService;

  const mockPrismaService = {
    users: { findUnique: jest.fn() },
    enrollments: { findFirst: jest.fn() },
    users_honors: { findMany: jest.fn() },
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
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

  // ----------------------------------------
  // Scenario 1: user with full data
  // ----------------------------------------
  describe('user with full data', () => {
    it('returns complete dashboard summary with real stats', async () => {
      const userId = 'user-uuid-001';

      mockPrismaService.users.findUnique.mockResolvedValue({
        name: 'Juan',
        paternal_last_name: 'Pérez',
        maternal_last_name: 'García',
        user_image: 'https://cdn.example.com/avatar.jpg',
      });

      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 10,
        class_id: 3,
        classes: { name: 'Amigo' },
      });

      mockPrismaService.users_honors.findMany.mockResolvedValue([
        { validate: true },
        { validate: true },
        { validate: false },
      ]);

      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue({
        club_sections: {
          club_section_id: 7,
          club_types: { name: 'Conquistadores' },
          clubs: { name: 'Club Central' },
        },
        roles: { role_name: 'member' },
      });

      mockPrismaService.class_section_progress.count.mockResolvedValue(4);
      mockPrismaService.class_sections.count.mockResolvedValue(10);

      mockPrismaService.activities.findMany.mockResolvedValue([
        {
          activity_id: 1,
          name: 'Campamento',
          created_at: new Date('2026-04-10T09:00:00Z'),
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
      expect(result.class_progress).toBe(40); // 4/10 * 100
      expect(result.honors_completed).toBe(2);
      expect(result.honors_in_progress).toBe(1);
      expect(result.upcoming_activities).toHaveLength(1);
      expect(result.upcoming_activities[0].id).toBe(1);
      expect(result.upcoming_activities[0].title).toBe('Campamento');
      expect(result.upcoming_activities[0].location).toBe('Parque Nacional');
    });
  });

  // ----------------------------------------
  // Scenario 2: user with no enrollment
  // ----------------------------------------
  describe('user with no enrollment', () => {
    it('returns null class name and 0 progress', async () => {
      const userId = 'user-uuid-002';

      mockPrismaService.users.findUnique.mockResolvedValue({
        name: 'María',
        paternal_last_name: 'López',
        maternal_last_name: null,
        user_image: null,
      });

      mockPrismaService.enrollments.findFirst.mockResolvedValue(null);

      mockPrismaService.users_honors.findMany.mockResolvedValue([]);

      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue({
        club_sections: {
          club_section_id: 5,
          club_types: { name: 'Aventureros' },
          clubs: { name: 'Club Norte' },
        },
        roles: { role_name: 'director' },
      });

      mockPrismaService.activities.findMany.mockResolvedValue([]);

      const result = await service.getSummary(userId);

      expect(result.current_class_name).toBeNull();
      expect(result.class_progress).toBe(0);
      expect(result.honors_completed).toBe(0);
      expect(result.honors_in_progress).toBe(0);
      expect(result.club_name).toBe('Club Norte');
      expect(result.user_name).toBe('María López');
      // class_section_progress.count and class_sections.count should NOT be called
      expect(
        mockPrismaService.class_section_progress.count,
      ).not.toHaveBeenCalled();
      expect(mockPrismaService.class_sections.count).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------
  // Scenario 3: user with no club
  // ----------------------------------------
  describe('user with no club', () => {
    it('returns null club fields and empty upcoming activities', async () => {
      const userId = 'user-uuid-003';

      mockPrismaService.users.findUnique.mockResolvedValue({
        name: 'Carlos',
        paternal_last_name: null,
        maternal_last_name: null,
        user_image: null,
      });

      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 20,
        class_id: 2,
        classes: { name: 'Conquistador' },
      });

      mockPrismaService.users_honors.findMany.mockResolvedValue([
        { validate: true },
      ]);

      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue(null);

      mockPrismaService.class_section_progress.count.mockResolvedValue(2);
      mockPrismaService.class_sections.count.mockResolvedValue(8);

      const result = await service.getSummary(userId);

      expect(result.club_name).toBeNull();
      expect(result.club_type).toBeNull();
      expect(result.user_role).toBeNull();
      expect(result.upcoming_activities).toEqual([]);
      // activities.findMany should NOT be called — no club section
      expect(mockPrismaService.activities.findMany).not.toHaveBeenCalled();
      expect(result.current_class_name).toBe('Conquistador');
      expect(result.class_progress).toBe(25); // 2/8 * 100
      expect(result.honors_completed).toBe(1);
      expect(result.honors_in_progress).toBe(0);
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
      });

      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 30,
        class_id: 5,
        classes: { name: 'Avanzado' },
      });

      mockPrismaService.users_honors.findMany.mockResolvedValue([]);
      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue(null);

      mockPrismaService.class_section_progress.count.mockResolvedValue(0);
      mockPrismaService.class_sections.count.mockResolvedValue(0);

      const result = await service.getSummary(userId);

      expect(result.class_progress).toBe(0);
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
      });

      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        class_id: 13,
        classes: { name: 'Guía Mayor' },
      });

      mockPrismaService.users_honors.findMany.mockResolvedValue([]);
      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue(null);

      // Simulates the real bug scenario: 1 progress record with score 0,
      // but the count query with score >= 70 filter returns 0.
      mockPrismaService.class_section_progress.count.mockResolvedValue(0);
      mockPrismaService.class_sections.count.mockResolvedValue(71);

      const result = await service.getSummary(userId);

      expect(result.current_class_name).toBe('Guía Mayor');
      expect(result.class_progress).toBe(0);

      // Verify the count was called with the score >= 70 filter
      expect(
        mockPrismaService.class_section_progress.count,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            score: { gte: 70 },
          }),
        }),
      );
    });
  });
});

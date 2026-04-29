import { Test, TestingModule } from '@nestjs/testing';
import { AchievementsService } from './achievements.service';
import { PrismaService } from '../prisma/prisma.service';
import { HandlerRegistry } from './handlers/handler.registry';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';
import { ACHIEVEMENT_DEFAULT_BADGE_URL } from './achievements.constants';

describe('AchievementsService', () => {
  let service: AchievementsService;

  const mockPrismaService: any = {
    achievement_event_log: {
      create: jest.fn(),
    },
    achievements: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    user_achievements: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    achievement_categories: {
      findMany: jest.fn(),
    },
  };

  const mockHandler = {
    evaluate: jest.fn(),
    validateCriteria: jest.fn().mockReturnValue({ valid: true }),
    calculateProgress: jest.fn(),
  };

  const mockHandlerRegistry = {
    getHandler: jest.fn().mockReturnValue(mockHandler),
  };

  const mockFileStorageService = {
    resolvePublicUrl: jest
      .fn()
      .mockImplementation(
        (_bucket: string, key: string) =>
          `https://cdn.r2.example/achievements-badges/${key}`,
      ),
  };

  /**
   * Build the service without a BullMQ queue (undefined queue — graceful fallback mode).
   * Tests that depend on queue enqueuing use a separate setup with a mock queue.
   */
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AchievementsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: HandlerRegistry, useValue: mockHandlerRegistry },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
        // Simulate the @Optional() @InjectQueue() — provide undefined
        {
          provide: 'BullQueue_achievements',
          useValue: undefined,
        },
      ],
    }).compile();

    service = module.get<AchievementsService>(AchievementsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // emitEvent
  // ---------------------------------------------------------------------------

  describe('emitEvent', () => {
    it('should persist the event to the event log', async () => {
      const mockEventLog = {
        event_id: 1,
        user_id: 'user-1',
        event_type: 'attendance.marked',
        processed: false,
      };
      mockPrismaService.achievement_event_log.create.mockResolvedValue(
        mockEventLog,
      );

      const result = await service.emitEvent({
        userId: 'user-1',
        eventType: 'attendance.marked',
        payload: { session_id: 'abc' },
      });

      expect(
        mockPrismaService.achievement_event_log.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: 'user-1',
            event_type: 'attendance.marked',
            event_payload: { session_id: 'abc' },
            processed: false,
          }),
        }),
      );
      expect(result.eventLogId).toBe(1);
    });

    it('should return queued=false and not crash when no queue is configured', async () => {
      const mockEventLog = {
        event_id: 2,
        user_id: 'user-1',
        event_type: 'login',
        processed: false,
      };
      mockPrismaService.achievement_event_log.create.mockResolvedValue(
        mockEventLog,
      );

      const result = await service.emitEvent({
        userId: 'user-1',
        eventType: 'login',
        payload: {},
      });

      expect(result.eventLogId).toBe(2);
      expect(result.queued).toBe(false); // no queue configured
    });

    it('should return queued=true when queue is available and event is enqueued', async () => {
      // Re-create the service with a mock queue
      const mockQueue = {
        add: jest.fn().mockResolvedValue({ id: 'job-queued' }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AchievementsService,
          { provide: PrismaService, useValue: mockPrismaService },
          { provide: HandlerRegistry, useValue: mockHandlerRegistry },
          { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
          { provide: 'BullQueue_achievements', useValue: mockQueue },
        ],
      }).compile();

      const serviceWithQueue =
        module.get<AchievementsService>(AchievementsService);

      mockPrismaService.achievement_event_log.create.mockResolvedValue({
        event_id: 3,
      });

      const result = await serviceWithQueue.emitEvent({
        userId: 'user-1',
        eventType: 'attendance.marked',
        payload: {},
      });

      expect(result.queued).toBe(true);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'evaluate',
        expect.objectContaining({
          userId: 'user-1',
          eventType: 'attendance.marked',
          eventLogId: 3,
        }),
        expect.any(Object),
      );
    });

    it('should return queued=false (not throw) when queue.add fails', async () => {
      const mockQueue = {
        add: jest.fn().mockRejectedValue(new Error('Redis connection refused')),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AchievementsService,
          { provide: PrismaService, useValue: mockPrismaService },
          { provide: HandlerRegistry, useValue: mockHandlerRegistry },
          { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
          { provide: 'BullQueue_achievements', useValue: mockQueue },
        ],
      }).compile();

      const serviceWithQueue =
        module.get<AchievementsService>(AchievementsService);
      mockPrismaService.achievement_event_log.create.mockResolvedValue({
        event_id: 4,
      });

      const result = await serviceWithQueue.emitEvent({
        userId: 'user-1',
        eventType: 'attendance.marked',
        payload: {},
      });

      // Event was persisted but enqueue failed gracefully
      expect(result.eventLogId).toBe(4);
      expect(result.queued).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // findAllAchievements
  // ---------------------------------------------------------------------------

  describe('findAllAchievements', () => {
    it('should return paginated achievements with default page/limit', async () => {
      const mockData = [
        {
          achievement_id: 1,
          name: 'Logro 1',
          badge_image_key: null,
          category: {},
        },
        {
          achievement_id: 2,
          name: 'Logro 2',
          badge_image_key: null,
          category: {},
        },
      ];
      mockPrismaService.achievements.findMany.mockResolvedValue(mockData);
      mockPrismaService.achievements.count.mockResolvedValue(2);

      const result = await service.findAllAchievements();

      expect(result.data).toHaveLength(2);
      expect(result.data[0].achievement_id).toBe(1);
      expect(result.data[0].badge_image_url).toBe(
        ACHIEVEMENT_DEFAULT_BADGE_URL,
      ); // no key → default url
      expect(result.data[1].achievement_id).toBe(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.totalPages).toBe(1);
    });

    it('should include badge_image_url when badge_image_key is present', async () => {
      const mockData = [
        {
          achievement_id: 1,
          name: 'Logro con badge',
          badge_image_key: 'achievements/badges/1_bronze.png',
          category: {},
        },
      ];
      mockPrismaService.achievements.findMany.mockResolvedValue(mockData);
      mockPrismaService.achievements.count.mockResolvedValue(1);

      const result = await service.findAllAchievements();

      expect(result.data[0].badge_image_url).toBe(
        'https://cdn.r2.example/achievements-badges/achievements/badges/1_bronze.png',
      );
    });

    it('should filter by type when provided', async () => {
      mockPrismaService.achievements.findMany.mockResolvedValue([]);
      mockPrismaService.achievements.count.mockResolvedValue(0);

      await service.findAllAchievements({ type: 'THRESHOLD' });

      expect(mockPrismaService.achievements.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: 'THRESHOLD' }),
        }),
      );
    });

    it('should filter by categoryId when provided', async () => {
      mockPrismaService.achievements.findMany.mockResolvedValue([]);
      mockPrismaService.achievements.count.mockResolvedValue(0);

      await service.findAllAchievements({ categoryId: 3 });

      expect(mockPrismaService.achievements.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category_id: 3 }),
        }),
      );
    });

    it('should filter by active flag when provided', async () => {
      mockPrismaService.achievements.findMany.mockResolvedValue([]);
      mockPrismaService.achievements.count.mockResolvedValue(0);

      await service.findAllAchievements({ active: false });

      expect(mockPrismaService.achievements.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: false }),
        }),
      );
    });

    it('should apply pagination correctly', async () => {
      mockPrismaService.achievements.findMany.mockResolvedValue([]);
      mockPrismaService.achievements.count.mockResolvedValue(45);

      const result = await service.findAllAchievements({ page: 3, limit: 10 });

      expect(result.page).toBe(3);
      expect(result.limit).toBe(10);
      expect(result.totalPages).toBe(5);

      expect(mockPrismaService.achievements.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20, // (page 3 - 1) * 10
          take: 10,
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getUserAchievements
  // ---------------------------------------------------------------------------

  describe('getUserAchievements', () => {
    // Shared catalog fixtures — simulates the full achievements table
    const mockAllAchievements = [
      {
        achievement_id: 1,
        name: 'Logro A',
        points: 50,
        secret: false,
        description: 'Desc A',
        badge_image_key: null,
        category_id: 10,
        category: {
          achievement_category_id: 10,
          name: 'Naturaleza',
          icon: 'leaf',
          display_order: 0,
        },
      },
      {
        achievement_id: 2,
        name: 'Logro B',
        points: 25,
        secret: false,
        description: 'Desc B',
        badge_image_key: null,
        category_id: 10,
        category: {
          achievement_category_id: 10,
          name: 'Naturaleza',
          icon: 'leaf',
          display_order: 0,
        },
      },
      {
        achievement_id: 3,
        name: 'Logro Secreto',
        points: 100,
        secret: true,
        description: 'Hidden',
        badge_image_key: 'key.png',
        category_id: 10,
        category: {
          achievement_category_id: 10,
          name: 'Naturaleza',
          icon: 'leaf',
          display_order: 0,
        },
      },
    ];

    it('should return full catalog with user progress overlaid', async () => {
      const mockUserAchievements = [
        {
          user_achievement_id: 1,
          achievement_id: 1,
          user_id: 'user-1',
          completed: true,
          active: true,
          progress_value: 1,
          progress_target: 1,
        },
      ];

      mockPrismaService.achievements.findMany.mockResolvedValue(
        mockAllAchievements,
      );
      mockPrismaService.user_achievements.findMany.mockResolvedValue(
        mockUserAchievements,
      );

      const result = await service.getUserAchievements('user-1');

      // Summary: 1 completed out of 3 total
      expect(result.summary.total_completed).toBe(1);
      expect(result.summary.total_points).toBe(50);
      expect(result.summary.completion_percentage).toBe(33); // Math.round(1/3*100)

      // All 3 achievements appear in the category (not just earned ones)
      expect(result.categories).toHaveLength(1);
      expect(result.categories[0].achievements).toHaveLength(3);
      expect(result.categories[0].category_id).toBe(10);
      expect(result.categories[0].name).toBe('Naturaleza');

      // Achievement 1: has progress
      const a1 = result.categories[0].achievements[0];
      expect(a1.achievement.achievement_id).toBe(1);
      expect(a1.user_achievement).not.toBeNull();
      expect(a1.user_achievement!.completed).toBe(true);

      // Achievement 2: no progress → null
      const a2 = result.categories[0].achievements[1];
      expect(a2.achievement.achievement_id).toBe(2);
      expect(a2.user_achievement).toBeNull();

      // Achievement 3: secret, not completed → masked
      const a3 = result.categories[0].achievements[2];
      expect(a3.achievement.name).toBe('???');
      expect(a3.achievement.description).toBe('???');
      expect((a3.achievement as any).badge_image_key).toBeNull();
    });

    it('should return all achievements with null progress when user has no records', async () => {
      mockPrismaService.achievements.findMany.mockResolvedValue(
        mockAllAchievements,
      );
      mockPrismaService.user_achievements.findMany.mockResolvedValue([]);

      const result = await service.getUserAchievements('user-no-achievements');

      expect(result.summary.total_completed).toBe(0);
      expect(result.summary.total_points).toBe(0);
      expect(result.summary.completion_percentage).toBe(0);

      // Still shows all achievements
      expect(result.categories).toHaveLength(1);
      expect(result.categories[0].achievements).toHaveLength(3);
      result.categories[0].achievements.forEach((item) => {
        expect(item.user_achievement).toBeNull();
      });
    });

    it('should return empty categories when catalog is empty', async () => {
      mockPrismaService.achievements.findMany.mockResolvedValue([]);
      mockPrismaService.user_achievements.findMany.mockResolvedValue([]);

      const result = await service.getUserAchievements('user-1');

      expect(result.summary.total_completed).toBe(0);
      expect(result.summary.total_points).toBe(0);
      expect(result.summary.completion_percentage).toBe(0);
      expect(result.categories).toHaveLength(0);
    });

    it('should group achievements from multiple categories separately', async () => {
      const multiCatAchievements = [
        {
          achievement_id: 1,
          name: 'A1',
          points: 50,
          secret: false,
          description: null,
          badge_image_key: null,
          category_id: 1,
          category: {
            achievement_category_id: 1,
            name: 'Cat A',
            icon: null,
            display_order: 0,
          },
        },
        {
          achievement_id: 2,
          name: 'B1',
          points: 25,
          secret: false,
          description: null,
          badge_image_key: null,
          category_id: 2,
          category: {
            achievement_category_id: 2,
            name: 'Cat B',
            icon: null,
            display_order: 1,
          },
        },
      ];

      mockPrismaService.achievements.findMany.mockResolvedValue(
        multiCatAchievements,
      );
      mockPrismaService.user_achievements.findMany.mockResolvedValue([]);

      const result = await service.getUserAchievements('user-1');

      expect(result.categories).toHaveLength(2);
      expect(result.categories[0].name).toBe('Cat A');
      expect(result.categories[1].name).toBe('Cat B');
    });

    it('should not mask secret achievements that are completed', async () => {
      const secretAchievement = [
        {
          achievement_id: 5,
          name: 'Real Secret Name',
          points: 200,
          secret: true,
          description: 'Real secret desc',
          badge_image_key: 'badge.png',
          category_id: 1,
          category: {
            achievement_category_id: 1,
            name: 'Special',
            icon: null,
            display_order: 0,
          },
        },
      ];
      const completedProgress = [
        {
          user_achievement_id: 99,
          achievement_id: 5,
          user_id: 'user-1',
          completed: true,
          active: true,
        },
      ];

      mockPrismaService.achievements.findMany.mockResolvedValue(
        secretAchievement,
      );
      mockPrismaService.user_achievements.findMany.mockResolvedValue(
        completedProgress,
      );

      const result = await service.getUserAchievements('user-1');

      const item = result.categories[0].achievements[0];
      expect(item.achievement.name).toBe('Real Secret Name'); // NOT masked
      expect(item.user_achievement).not.toBeNull();
      expect(item.user_achievement!.completed).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // getAchievementDetail
  // ---------------------------------------------------------------------------

  describe('getAchievementDetail', () => {
    it('should return achievement with user progress when userId is provided', async () => {
      const mockAchievement = {
        achievement_id: 1,
        name: 'Test',
        badge_image_key: null,
        category: {},
      };
      const mockProgress = {
        user_achievement_id: 1,
        user_id: 'user-1',
        achievement_id: 1,
        completed: false,
        progress_value: 2,
      };

      mockPrismaService.achievements.findUnique.mockResolvedValue(
        mockAchievement,
      );
      mockPrismaService.user_achievements.findFirst.mockResolvedValue(
        mockProgress,
      );

      const result = await service.getAchievementDetail(1, 'user-1');

      expect(result).not.toBeNull();
      expect(result!.achievement.achievement_id).toBe(1);
      expect(result!.achievement.name).toBe('Test');
      expect(result!.achievement.badge_image_url).toBe(
        ACHIEVEMENT_DEFAULT_BADGE_URL,
      ); // no key → default url
      expect(result!.userProgress).toEqual(mockProgress);
    });

    it('should include badge_image_url when badge_image_key is present', async () => {
      const mockAchievement = {
        achievement_id: 2,
        name: 'Badge Test',
        badge_image_key: 'achievements/badges/2_gold.png',
        category: {},
      };
      mockPrismaService.achievements.findUnique.mockResolvedValue(
        mockAchievement,
      );
      mockPrismaService.user_achievements.findFirst.mockResolvedValue(null);

      const result = await service.getAchievementDetail(2, 'user-1');

      expect(result!.achievement.badge_image_url).toBe(
        'https://cdn.r2.example/achievements-badges/achievements/badges/2_gold.png',
      );
    });

    it('should return achievement with userProgress=null when userId is not provided', async () => {
      const mockAchievement = {
        achievement_id: 1,
        name: 'Test',
        badge_image_key: null,
        category: {},
      };
      mockPrismaService.achievements.findUnique.mockResolvedValue(
        mockAchievement,
      );

      const result = await service.getAchievementDetail(1);

      expect(result!.achievement.achievement_id).toBe(1);
      expect(result!.achievement.badge_image_url).toBe(
        ACHIEVEMENT_DEFAULT_BADGE_URL,
      );
      expect(result!.userProgress).toBeNull();
      expect(
        mockPrismaService.user_achievements.findFirst,
      ).not.toHaveBeenCalled();
    });

    it('should return null when achievement does not exist', async () => {
      mockPrismaService.achievements.findUnique.mockResolvedValue(null);

      const result = await service.getAchievementDetail(999);

      expect(result).toBeNull();
    });

    it('should return achievement with userProgress=null when user has no progress record', async () => {
      const mockAchievement = {
        achievement_id: 1,
        name: 'Test',
        badge_image_key: null,
        category: {},
      };
      mockPrismaService.achievements.findUnique.mockResolvedValue(
        mockAchievement,
      );
      mockPrismaService.user_achievements.findFirst.mockResolvedValue(null); // no progress

      const result = await service.getAchievementDetail(1, 'user-1');

      expect(result!.userProgress).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // validateCriteria
  // ---------------------------------------------------------------------------

  describe('validateCriteria', () => {
    it('should delegate to the handler registry and return its result', () => {
      mockHandler.validateCriteria.mockReturnValue({ valid: true });

      const result = service.validateCriteria('THRESHOLD', {
        event: 'test',
        operator: 'gte',
        target: 5,
      });

      expect(mockHandlerRegistry.getHandler).toHaveBeenCalledWith('THRESHOLD');
      expect(mockHandler.validateCriteria).toHaveBeenCalledWith({
        event: 'test',
        operator: 'gte',
        target: 5,
      });
      expect(result.valid).toBe(true);
    });

    it('should pass through validation errors from handler', () => {
      mockHandler.validateCriteria.mockReturnValue({
        valid: false,
        errors: ['event must be a non-empty string'],
      });

      const result = service.validateCriteria('THRESHOLD', {
        operator: 'gte',
        target: 5,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('event must be a non-empty string');
    });
  });

  // ---------------------------------------------------------------------------
  // getCompletedAchievementIds
  // ---------------------------------------------------------------------------

  describe('getCompletedAchievementIds', () => {
    it('should return a Set of completed achievement IDs for the user', async () => {
      mockPrismaService.user_achievements.findMany.mockResolvedValue([
        { achievement_id: 1 },
        { achievement_id: 5 },
        { achievement_id: 10 },
      ]);

      const result = await service.getCompletedAchievementIds('user-1');

      expect(result).toBeInstanceOf(Set);
      expect(result.has(1)).toBe(true);
      expect(result.has(5)).toBe(true);
      expect(result.has(10)).toBe(true);
      expect(result.has(99)).toBe(false);
    });

    it('should return an empty Set when user has no completed achievements', async () => {
      mockPrismaService.user_achievements.findMany.mockResolvedValue([]);

      const result = await service.getCompletedAchievementIds('user-1');

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    it('should query only completed=true records', async () => {
      mockPrismaService.user_achievements.findMany.mockResolvedValue([]);

      await service.getCompletedAchievementIds('user-1');

      expect(mockPrismaService.user_achievements.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id: 'user-1',
            completed: true,
          }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // enqueueRetroactiveEvaluation
  // ---------------------------------------------------------------------------

  describe('enqueueRetroactiveEvaluation', () => {
    it('should return queued=false when no queue is configured', async () => {
      const result = await service.enqueueRetroactiveEvaluation('user-1', 1);
      expect(result.queued).toBe(false);
    });

    it('should enqueue and return queued=true when queue is available', async () => {
      const mockQueue = {
        add: jest.fn().mockResolvedValue({ id: 'retro-job' }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AchievementsService,
          { provide: PrismaService, useValue: mockPrismaService },
          { provide: HandlerRegistry, useValue: mockHandlerRegistry },
          { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
          { provide: 'BullQueue_achievements', useValue: mockQueue },
        ],
      }).compile();

      const serviceWithQueue =
        module.get<AchievementsService>(AchievementsService);

      const result = await serviceWithQueue.enqueueRetroactiveEvaluation(
        'user-1',
        10,
        true,
      );

      expect(result.queued).toBe(true);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'retroactive-evaluate',
        expect.objectContaining({
          userId: 'user-1',
          achievementId: 10,
          skipNotification: true,
        }),
        expect.any(Object),
      );
    });
  });
});

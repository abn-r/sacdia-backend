import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import {
  AchievementsProcessor,
  EvaluateJobData,
  RetroactiveEvaluateJobData,
} from './achievements.processor';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { HandlerRegistry } from './handlers/handler.registry';

describe('AchievementsProcessor', () => {
  let processor: AchievementsProcessor;

  const mockPrismaService: any = {
    achievement_event_log: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    achievements: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    user_achievements: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  mockPrismaService.$queryRaw = jest.fn().mockResolvedValue([]);

  const mockNotificationsService = {
    notifySafe: jest.fn().mockResolvedValue(undefined),
  };

  const mockEvaluationResult = {
    matched: false,
    currentProgress: 0,
    targetProgress: 5,
  };

  const mockHandler = {
    evaluate: jest.fn().mockResolvedValue(mockEvaluationResult),
    validateCriteria: jest.fn().mockReturnValue({ valid: true }),
    calculateProgress: jest.fn().mockResolvedValue({
      current: 3,
      target: 5,
      percentage: 60,
    }),
  };

  const mockHandlerRegistry = {
    getHandler: jest.fn().mockReturnValue(mockHandler),
  };

  /**
   * Build a fake BullMQ Job without requiring Redis infrastructure.
   */
  function makeJob<T>(name: string, data: T): Job<T> {
    return { id: 'test-job-1', name, data } as unknown as Job<T>;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AchievementsProcessor,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: HandlerRegistry, useValue: mockHandlerRegistry },
      ],
    })
      .overrideProvider(AchievementsProcessor)
      .useFactory({
        factory: () =>
          new AchievementsProcessor(
            mockPrismaService,
            mockHandlerRegistry as any,
            mockNotificationsService as any,
          ),
      })
      .compile();

    processor = module.get<AchievementsProcessor>(AchievementsProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // process() dispatcher
  // ---------------------------------------------------------------------------

  describe('process()', () => {
    it('should dispatch evaluate jobs to handleEvaluate', async () => {
      mockPrismaService.achievements.findMany.mockResolvedValue([]);
      mockPrismaService.$queryRaw.mockResolvedValue([]);
      mockPrismaService.achievement_event_log.update.mockResolvedValue({});

      const job = makeJob<EvaluateJobData>('evaluate', {
        userId: 'user-1',
        eventType: 'attendance.marked',
        payload: {},
        eventLogId: 100,
      });

      const result = await processor.process(job as any);
      expect(result).toEqual({ processed: 0 }); // no matching achievements
    });

    it('should warn on unknown job types and return undefined', async () => {
      const job = makeJob('unknown-job-type', {});
      const result = await processor.process(job as any);
      expect(result).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // evaluate job
  // ---------------------------------------------------------------------------

  describe('evaluate job', () => {
    const baseJobData: EvaluateJobData = {
      userId: 'user-1',
      eventType: 'attendance.marked',
      payload: {},
      eventLogId: 100,
    };

    const mockAchievement = {
      achievement_id: 1,
      name: 'Primer Honor',
      type: 'THRESHOLD',
      active: true,
      repeatable: false,
      max_repeats: null,
      prerequisite_id: null,
      tier: 'BRONZE',
      points: 50,
      criteria: { event: 'attendance.marked', operator: 'gte', target: 5 },
    };

    it('should find matching achievements and call handler.evaluate()', async () => {
      mockPrismaService.achievements.findMany.mockResolvedValue([
        mockAchievement,
      ]);
      mockPrismaService.$queryRaw.mockResolvedValue([]);
      mockPrismaService.user_achievements.findFirst.mockResolvedValue(null);
      mockPrismaService.user_achievements.create.mockResolvedValue({
        user_achievement_id: 1,
      });
      mockPrismaService.achievement_event_log.update.mockResolvedValue({});

      mockHandler.evaluate.mockResolvedValue({
        matched: false,
        currentProgress: 2,
        targetProgress: 5,
      });

      const job = makeJob<EvaluateJobData>('evaluate', baseJobData);
      const result = await processor.process(job as any);

      expect(mockHandler.evaluate).toHaveBeenCalledWith(
        'user-1',
        mockAchievement,
        { eventType: 'attendance.marked', payload: {} },
      );
      expect(result).toEqual({ processed: 1 });
    });

    it('should create user_achievement record when none exists', async () => {
      mockPrismaService.achievements.findMany.mockResolvedValue([
        mockAchievement,
      ]);
      mockPrismaService.$queryRaw.mockResolvedValue([]);
      mockPrismaService.user_achievements.findFirst.mockResolvedValue(null);
      mockPrismaService.user_achievements.create.mockResolvedValue({
        user_achievement_id: 1,
      });
      mockPrismaService.achievement_event_log.update.mockResolvedValue({});

      mockHandler.evaluate.mockResolvedValue({
        matched: false,
        currentProgress: 2,
        targetProgress: 5,
      });

      const job = makeJob<EvaluateJobData>('evaluate', baseJobData);
      await processor.process(job as any);

      expect(mockPrismaService.user_achievements.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: 'user-1',
            achievement_id: 1,
            progress_value: 2,
            progress_target: 5,
            completed: false,
          }),
        }),
      );
    });

    it('should update existing user_achievement record when one exists', async () => {
      const existingRecord = {
        user_achievement_id: 99,
        user_id: 'user-1',
        achievement_id: 1,
        completed: false,
        times_completed: 0,
        completed_at: null,
      };

      mockPrismaService.achievements.findMany.mockResolvedValue([
        mockAchievement,
      ]);
      mockPrismaService.$queryRaw.mockResolvedValue([]);
      mockPrismaService.user_achievements.findFirst.mockResolvedValue(
        existingRecord,
      );
      mockPrismaService.user_achievements.update.mockResolvedValue({
        ...existingRecord,
        progress_value: 3,
      });
      mockPrismaService.achievement_event_log.update.mockResolvedValue({});

      mockHandler.evaluate.mockResolvedValue({
        matched: false,
        currentProgress: 3,
        targetProgress: 5,
      });

      const job = makeJob<EvaluateJobData>('evaluate', baseJobData);
      await processor.process(job as any);

      expect(mockPrismaService.user_achievements.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_achievement_id: 99 },
          data: expect.objectContaining({
            progress_value: 3,
            completed: false,
          }),
        }),
      );
    });

    it('should set completed=true and send notification when progress meets target', async () => {
      mockPrismaService.achievements.findMany.mockResolvedValue([
        mockAchievement,
      ]);
      mockPrismaService.$queryRaw.mockResolvedValue([]);
      mockPrismaService.user_achievements.findFirst.mockResolvedValue(null);
      mockPrismaService.user_achievements.create.mockResolvedValue({
        user_achievement_id: 1,
      });
      mockPrismaService.achievement_event_log.update.mockResolvedValue({});

      mockHandler.evaluate.mockResolvedValue({
        matched: true, // achievement completed
        currentProgress: 5,
        targetProgress: 5,
      });

      const job = makeJob<EvaluateJobData>('evaluate', baseJobData);
      await processor.process(job as any);

      expect(mockPrismaService.user_achievements.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            completed: true,
            times_completed: 1,
          }),
        }),
      );
      expect(mockNotificationsService.notifySafe).toHaveBeenCalledWith(
        'user-1',
        '¡Nuevo logro en tu camino!',
        'Sumaste un nuevo logro: Primera Especialidad',
        expect.objectContaining({
          achievement_id: '1',
          achievement_name: mockAchievement.name,
          points: '50',
          tier: 'BRONZE',
          type: 'achievement_unlocked',
        }),
        'achievements:unlock',
      );
    });

    it('should skip completed non-repeatable achievements', async () => {
      const completedRecord = {
        user_achievement_id: 99,
        user_id: 'user-1',
        achievement_id: 1,
        completed: true,
        times_completed: 1,
        completed_at: new Date(),
      };

      const nonRepeatableAchievement = {
        ...mockAchievement,
        repeatable: false,
      };

      mockPrismaService.achievements.findMany.mockResolvedValue([
        nonRepeatableAchievement,
      ]);
      mockPrismaService.$queryRaw.mockResolvedValue([]);
      mockPrismaService.user_achievements.findFirst.mockResolvedValue(
        completedRecord,
      );
      mockPrismaService.achievement_event_log.update.mockResolvedValue({});

      const job = makeJob<EvaluateJobData>('evaluate', baseJobData);
      await processor.process(job as any);

      expect(mockHandler.evaluate).not.toHaveBeenCalled();
    });

    it('should skip achievements whose prerequisites are not completed', async () => {
      const achievementWithPrereq = { ...mockAchievement, prerequisite_id: 99 };

      mockPrismaService.achievements.findMany.mockResolvedValue([
        achievementWithPrereq,
      ]);
      mockPrismaService.$queryRaw.mockResolvedValue([]);
      // prerequisite not found / not completed
      mockPrismaService.user_achievements.findFirst.mockResolvedValue(null);
      mockPrismaService.achievement_event_log.update.mockResolvedValue({});

      const job = makeJob<EvaluateJobData>('evaluate', baseJobData);
      await processor.process(job as any);

      expect(mockHandler.evaluate).not.toHaveBeenCalled();
    });

    it('should marks event log as processed after evaluation', async () => {
      mockPrismaService.achievements.findMany.mockResolvedValue([]);
      mockPrismaService.$queryRaw.mockResolvedValue([]);
      mockPrismaService.achievement_event_log.update.mockResolvedValue({});

      const job = makeJob<EvaluateJobData>('evaluate', {
        ...baseJobData,
        eventLogId: 42,
      });
      await processor.process(job as any);

      expect(
        mockPrismaService.achievement_event_log.update,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { event_id: 42 },
          data: { processed: true },
        }),
      );
    });

    it('should handle handler errors gracefully and continue processing other achievements', async () => {
      const secondAchievement = {
        ...mockAchievement,
        achievement_id: 2,
        name: 'Other Achievement',
      };

      mockPrismaService.achievements.findMany.mockResolvedValue([
        mockAchievement,
        secondAchievement,
      ]);
      mockPrismaService.$queryRaw.mockResolvedValue([]);
      mockPrismaService.user_achievements.findFirst.mockResolvedValue(null);
      mockPrismaService.user_achievements.create.mockResolvedValue({
        user_achievement_id: 1,
      });
      mockPrismaService.achievement_event_log.update.mockResolvedValue({});

      // First handler call throws, second succeeds
      mockHandler.evaluate
        .mockRejectedValueOnce(new Error('Handler crashed'))
        .mockResolvedValueOnce({
          matched: false,
          currentProgress: 1,
          targetProgress: 5,
        });

      const job = makeJob<EvaluateJobData>('evaluate', baseJobData);
      const result = await processor.process(job as any);

      // Only the second achievement was successfully processed
      expect(result).toEqual({ processed: 1 });
    });

    it('should return processed=0 and not crash when no achievements match event type', async () => {
      mockPrismaService.achievements.findMany.mockResolvedValue([]);
      mockPrismaService.$queryRaw.mockResolvedValue([]);
      mockPrismaService.achievement_event_log.update.mockResolvedValue({});

      const job = makeJob<EvaluateJobData>('evaluate', baseJobData);
      const result = await processor.process(job as any);

      expect(result).toEqual({ processed: 0 });
      expect(mockHandler.evaluate).not.toHaveBeenCalled();
    });

    it('should include COMPOUND achievements from $queryRaw in matching', async () => {
      const compoundAchievement = {
        achievement_id: 5,
        name: 'Compound Test',
        type: 'COMPOUND',
        active: true,
        repeatable: false,
        max_repeats: null,
        prerequisite_id: null,
        tier: 'GOLD',
        points: 100,
        criteria: {
          logic: 'AND',
          conditions: [
            { event: 'attendance.marked', operator: 'gte', target: 3 },
          ],
        },
      };

      mockPrismaService.achievements.findMany.mockResolvedValue([]); // no direct matches
      mockPrismaService.$queryRaw.mockResolvedValue([compoundAchievement]); // compound match
      mockPrismaService.user_achievements.findFirst.mockResolvedValue(null);
      mockPrismaService.user_achievements.create.mockResolvedValue({
        user_achievement_id: 1,
      });
      mockPrismaService.achievement_event_log.update.mockResolvedValue({});

      mockHandler.evaluate.mockResolvedValue({
        matched: false,
        currentProgress: 1,
        targetProgress: 3,
      });

      const job = makeJob<EvaluateJobData>('evaluate', baseJobData);
      const result = await processor.process(job as any);

      expect(mockHandler.evaluate).toHaveBeenCalled();
      expect(result).toEqual({ processed: 1 });
    });
  });

  // ---------------------------------------------------------------------------
  // retroactive-evaluate job
  // ---------------------------------------------------------------------------

  describe('retroactive-evaluate job', () => {
    const baseRetroData: RetroactiveEvaluateJobData = {
      userId: 'user-1',
      achievementId: 10,
    };

    const mockAchievement = {
      achievement_id: 10,
      name: 'Coleccionista de Honores',
      type: 'THRESHOLD',
      active: true,
      tier: 'SILVER',
      points: 75,
      criteria: { event: 'attendance.marked', operator: 'gte', target: 5 },
    };

    it('should call handler.calculateProgress() and upsert progress', async () => {
      mockPrismaService.achievements.findUnique.mockResolvedValue(
        mockAchievement,
      );
      mockPrismaService.user_achievements.findFirst.mockResolvedValue(null);
      mockPrismaService.user_achievements.create.mockResolvedValue({
        user_achievement_id: 1,
      });

      mockHandler.calculateProgress.mockResolvedValue({
        current: 3,
        target: 5,
        percentage: 60,
      });

      const job = makeJob<RetroactiveEvaluateJobData>(
        'retroactive-evaluate',
        baseRetroData,
      );
      const result = await processor.process(job as any);

      expect(mockHandler.calculateProgress).toHaveBeenCalledWith(
        'user-1',
        mockAchievement,
      );
      expect(result).toMatchObject({
        userId: 'user-1',
        achievementId: 10,
        completed: false,
      });
    });

    it('should create new user_achievement record when none exists', async () => {
      mockPrismaService.achievements.findUnique.mockResolvedValue(
        mockAchievement,
      );
      mockPrismaService.user_achievements.findFirst.mockResolvedValue(null);
      mockPrismaService.user_achievements.create.mockResolvedValue({
        user_achievement_id: 1,
      });

      mockHandler.calculateProgress.mockResolvedValue({
        current: 3,
        target: 5,
        percentage: 60,
      });

      const job = makeJob<RetroactiveEvaluateJobData>(
        'retroactive-evaluate',
        baseRetroData,
      );
      await processor.process(job as any);

      expect(mockPrismaService.user_achievements.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: 'user-1',
            achievement_id: 10,
            completed: false,
          }),
        }),
      );
    });

    it('should update existing user_achievement record when one exists', async () => {
      const existing = {
        user_achievement_id: 55,
        user_id: 'user-1',
        achievement_id: 10,
        completed: false,
        times_completed: 0,
        completed_at: null,
      };

      mockPrismaService.achievements.findUnique.mockResolvedValue(
        mockAchievement,
      );
      mockPrismaService.user_achievements.findFirst.mockResolvedValue(existing);
      mockPrismaService.user_achievements.update.mockResolvedValue({
        ...existing,
        progress_value: 4,
      });

      mockHandler.calculateProgress.mockResolvedValue({
        current: 4,
        target: 5,
        percentage: 80,
      });

      const job = makeJob<RetroactiveEvaluateJobData>(
        'retroactive-evaluate',
        baseRetroData,
      );
      await processor.process(job as any);

      expect(mockPrismaService.user_achievements.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_achievement_id: 55 },
          data: expect.objectContaining({ progress_value: 4 }),
        }),
      );
    });

    it('should send notification on first completion during retroactive evaluation', async () => {
      mockPrismaService.achievements.findUnique.mockResolvedValue(
        mockAchievement,
      );
      mockPrismaService.user_achievements.findFirst.mockResolvedValue(null); // first time
      mockPrismaService.user_achievements.create.mockResolvedValue({
        user_achievement_id: 1,
      });

      mockHandler.calculateProgress.mockResolvedValue({
        current: 5,
        target: 5,
        percentage: 100,
      });

      const job = makeJob<RetroactiveEvaluateJobData>(
        'retroactive-evaluate',
        baseRetroData,
      );
      await processor.process(job as any);

      expect(mockNotificationsService.notifySafe).toHaveBeenCalledWith(
        'user-1',
        '¡Nuevo logro en tu camino!',
        'Sumaste un nuevo logro: Coleccionista de Especialidades',
        expect.objectContaining({
          achievement_id: '10',
          achievement_name: mockAchievement.name,
          points: '75',
          tier: 'SILVER',
          type: 'achievement_unlocked',
        }),
        'achievements:retroactive',
      );
    });

    it('should skip notification when skipNotification=true', async () => {
      mockPrismaService.achievements.findUnique.mockResolvedValue(
        mockAchievement,
      );
      mockPrismaService.user_achievements.findFirst.mockResolvedValue(null);
      mockPrismaService.user_achievements.create.mockResolvedValue({
        user_achievement_id: 1,
      });

      mockHandler.calculateProgress.mockResolvedValue({
        current: 5,
        target: 5,
        percentage: 100,
      });

      const job = makeJob<RetroactiveEvaluateJobData>('retroactive-evaluate', {
        ...baseRetroData,
        skipNotification: true,
      });
      await processor.process(job as any);

      expect(mockNotificationsService.notifySafe).not.toHaveBeenCalled();
    });

    it('should return skipped when achievement does not exist', async () => {
      mockPrismaService.achievements.findUnique.mockResolvedValue(null);

      const job = makeJob<RetroactiveEvaluateJobData>(
        'retroactive-evaluate',
        baseRetroData,
      );
      const result = await processor.process(job as any);

      expect(result).toEqual({
        skipped: true,
        reason: 'achievement-not-found',
      });
    });

    it('should return skipped when achievement is inactive', async () => {
      mockPrismaService.achievements.findUnique.mockResolvedValue({
        ...mockAchievement,
        active: false,
      });

      const job = makeJob<RetroactiveEvaluateJobData>(
        'retroactive-evaluate',
        baseRetroData,
      );
      const result = await processor.process(job as any);

      expect(result).toEqual({
        skipped: true,
        reason: 'achievement-not-found',
      });
    });
  });
});

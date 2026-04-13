/**
 * achievements.integration.spec.ts
 *
 * Tests the full flow: emitEvent → processor evaluates → user_achievement updated → notification sent.
 * All Prisma calls are mocked. The test exercises the real service + processor + handler interaction.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { AchievementsService } from './achievements.service';
import { AchievementsProcessor, EvaluateJobData } from './achievements.processor';
import { ThresholdHandler } from './handlers/threshold.handler';
import { HandlerRegistry } from './handlers/handler.registry';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('Achievements Integration: emitEvent → evaluate → notify', () => {
  let service: AchievementsService;
  let processor: AchievementsProcessor;
  let handlerRegistry: HandlerRegistry;

  // ---------------------------------------------------------------------------
  // Shared mock state — tracks event log across multiple emitEvent calls
  // ---------------------------------------------------------------------------
  const eventLogStore: Array<{ event_id: number; event_type: string; event_payload: object; user_id: string }> = [];
  let eventLogIdCounter = 0;

  // Single achievement: THRESHOLD, target=3
  const mockAchievement = {
    achievement_id: 1,
    name: 'Participante Frecuente',
    type: 'THRESHOLD' as const,
    active: true,
    repeatable: false,
    max_repeats: null,
    prerequisite_id: null,
    tier: 'BRONZE',
    points: 50,
    criteria: { event: 'attendance.marked', operator: 'gte', target: 3 },
    category: { achievement_category_id: 1, name: 'Participación' },
  };

  let userAchievementRecord: any = null;

  const mockPrismaService: any = {
    achievement_event_log: {
      create: jest.fn(({ data }) => {
        const id = ++eventLogIdCounter;
        const row = { event_id: id, ...data };
        eventLogStore.push(row);
        return Promise.resolve(row);
      }),
      findMany: jest.fn(({ where }) => {
        const rows = eventLogStore.filter(
          (e) =>
            e.user_id === where.user_id &&
            e.event_type === where.event_type,
        );
        return Promise.resolve(rows.map((r) => ({ event_payload: r.event_payload })));
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    achievements: {
      findMany: jest.fn().mockResolvedValue([mockAchievement]),
      findUnique: jest.fn().mockResolvedValue(mockAchievement),
      count: jest.fn().mockResolvedValue(1),
    },
    user_achievements: {
      findFirst: jest.fn(() => Promise.resolve(userAchievementRecord)),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }) => {
        userAchievementRecord = { user_achievement_id: 1, ...data };
        return Promise.resolve(userAchievementRecord);
      }),
      update: jest.fn(({ data }) => {
        userAchievementRecord = { ...userAchievementRecord, ...data };
        return Promise.resolve(userAchievementRecord);
      }),
    },
  };

  mockPrismaService.$queryRaw = jest.fn().mockResolvedValue([]); // no COMPOUND achievements

  const mockNotificationsService = {
    notifySafe: jest.fn().mockResolvedValue(undefined),
  };

  // Mock the queue — we call processor.process() manually in tests
  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };

  function makeJob<T>(name: string, data: T): Job<T> {
    return { id: 'integration-job', name, data } as unknown as Job<T>;
  }

  beforeEach(async () => {
    // Reset shared state between tests
    eventLogStore.length = 0;
    eventLogIdCounter = 0;
    userAchievementRecord = null;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandlerRegistry,
        ThresholdHandler,
        AchievementsService,
        AchievementsProcessor,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        // Provide queue mock directly — InjectQueue token requires this approach
        {
          provide: 'BullQueue_achievements',
          useValue: mockQueue,
        },
      ],
    })
      .overrideProvider(AchievementsProcessor)
      .useFactory({
        factory: (prisma: PrismaService, registry: HandlerRegistry, notifications: NotificationsService) =>
          new AchievementsProcessor(prisma, registry, notifications),
        inject: [PrismaService, HandlerRegistry, NotificationsService],
      })
      .overrideProvider(AchievementsService)
      .useFactory({
        factory: (prisma: PrismaService, registry: HandlerRegistry) =>
          new AchievementsService(prisma, registry, undefined), // no queue — we call processor manually
        inject: [PrismaService, HandlerRegistry],
      })
      .compile();

    service = module.get<AchievementsService>(AchievementsService);
    processor = module.get<AchievementsProcessor>(AchievementsProcessor);
    handlerRegistry = module.get<HandlerRegistry>(HandlerRegistry);

    // NestJS lifecycle hooks (onModuleInit) are NOT triggered by Test.createTestingModule().compile().
    // Manually invoke onModuleInit on ThresholdHandler so it self-registers with HandlerRegistry,
    // replicating the production wiring without calling module.init() (which would crash because
    // AchievementsProcessor.onApplicationBootstrap() accesses this.worker — a BullMQ worker
    // that does not exist in the test environment).
    const thresholdHandler = module.get<ThresholdHandler>(ThresholdHandler);
    thresholdHandler.onModuleInit();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should complete the achievement after 3 emitEvent calls and send notification', async () => {
    const userId = 'user-integration-1';
    const eventType = 'attendance.marked';
    const payload = {};

    // Step 1: Emit 3 events (the threshold target is 3)
    const result1 = await service.emitEvent({ userId, eventType, payload });
    const result2 = await service.emitEvent({ userId, eventType, payload });
    const result3 = await service.emitEvent({ userId, eventType, payload });

    // All 3 events should be persisted
    expect(result1.eventLogId).toBe(1);
    expect(result2.eventLogId).toBe(2);
    expect(result3.eventLogId).toBe(3);
    expect(eventLogStore).toHaveLength(3);

    // Step 2: Manually trigger the processor with the 3rd event's data
    const job = makeJob<EvaluateJobData>('evaluate', {
      userId,
      eventType,
      payload,
      eventLogId: result3.eventLogId,
    });

    const processResult = await processor.process(job as any);

    // Step 3: Verify the processor evaluated 1 achievement
    expect(processResult).toEqual({ processed: 1 });

    // Step 4: Verify user_achievement was created with completed=true
    expect(userAchievementRecord).toBeDefined();
    expect(userAchievementRecord.user_id).toBe(userId);
    expect(userAchievementRecord.achievement_id).toBe(1);
    expect(userAchievementRecord.progress_value).toBe(3);
    expect(userAchievementRecord.completed).toBe(true);
    expect(userAchievementRecord.times_completed).toBe(1);

    // Step 5: Verify notification was sent with the achievement name
    expect(mockNotificationsService.notifySafe).toHaveBeenCalledWith(
      userId,
      '¡Logro desbloqueado!',
      `Completaste: ${mockAchievement.name}`,
      expect.objectContaining({ achievement_id: '1' }),
      'achievements:unlock',
    );
  });

  it('should NOT complete the achievement after only 2 emitEvent calls (progress tracking)', async () => {
    const userId = 'user-integration-2';
    const eventType = 'attendance.marked';
    const payload = {};

    await service.emitEvent({ userId, eventType, payload });
    await service.emitEvent({ userId, eventType, payload });
    // Only 2 events — target is 3

    const job = makeJob<EvaluateJobData>('evaluate', {
      userId,
      eventType,
      payload,
      eventLogId: 2,
    });

    await processor.process(job as any);

    // user_achievement should exist with progress=2 and completed=false
    expect(userAchievementRecord).toBeDefined();
    expect(userAchievementRecord.progress_value).toBe(2);
    expect(userAchievementRecord.completed).toBe(false);

    // No notification should be sent
    expect(mockNotificationsService.notifySafe).not.toHaveBeenCalled();
  });

  it('should update progress on subsequent processor runs', async () => {
    const userId = 'user-integration-3';
    const eventType = 'attendance.marked';
    const payload = {};

    // First run: 1 event
    await service.emitEvent({ userId, eventType, payload });

    const job1 = makeJob<EvaluateJobData>('evaluate', {
      userId,
      eventType,
      payload,
      eventLogId: 1,
    });
    await processor.process(job1 as any);

    expect(userAchievementRecord.progress_value).toBe(1);
    expect(userAchievementRecord.completed).toBe(false);

    // Second run: 2nd event — now user_achievement exists, should update
    await service.emitEvent({ userId, eventType, payload });

    const job2 = makeJob<EvaluateJobData>('evaluate', {
      userId,
      eventType,
      payload,
      eventLogId: 2,
    });
    await processor.process(job2 as any);

    expect(userAchievementRecord.progress_value).toBe(2);
    expect(userAchievementRecord.completed).toBe(false);
  });

  it('should mark event as processed in the event log', async () => {
    const userId = 'user-integration-4';
    const eventType = 'attendance.marked';

    const emitResult = await service.emitEvent({ userId, eventType, payload: {} });

    const job = makeJob<EvaluateJobData>('evaluate', {
      userId,
      eventType,
      payload: {},
      eventLogId: emitResult.eventLogId,
    });
    await processor.process(job as any);

    expect(mockPrismaService.achievement_event_log.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { event_id: emitResult.eventLogId },
        data: { processed: true },
      }),
    );
  });
});

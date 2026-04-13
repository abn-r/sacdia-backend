import { Test, TestingModule } from '@nestjs/testing';
import { CompoundHandler } from './compound.handler';
import { HandlerRegistry } from './handler.registry';
import { PrismaService } from '../../prisma/prisma.service';

describe('CompoundHandler', () => {
  let handler: CompoundHandler;

  const mockPrismaService: any = {
    achievement_event_log: {
      findMany: jest.fn(),
    },
  };

  const mockHandlerRegistry = {
    register: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompoundHandler,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: HandlerRegistry, useValue: mockHandlerRegistry },
      ],
    }).compile();

    handler = module.get<CompoundHandler>(CompoundHandler);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  it('should register itself on module init', () => {
    handler.onModuleInit();
    expect(mockHandlerRegistry.register).toHaveBeenCalledWith('COMPOUND', handler);
  });

  // ---------------------------------------------------------------------------
  // validateCriteria
  // ---------------------------------------------------------------------------

  describe('validateCriteria', () => {
    it('should return valid for a correct AND compound criteria', () => {
      const result = handler.validateCriteria({
        logic: 'AND',
        conditions: [
          { event: 'attendance.marked', operator: 'gte', target: 5 },
          { event: 'honor.earned', operator: 'gte', target: 1 },
        ],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should return valid for a correct OR compound criteria', () => {
      const result = handler.validateCriteria({
        logic: 'OR',
        conditions: [
          { event: 'attendance.marked', operator: 'gte', target: 10 },
          { event: 'quiz.passed', operator: 'gte', target: 3 },
        ],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should fail when conditions array is empty', () => {
      const result = handler.validateCriteria({
        logic: 'AND',
        conditions: [],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('conditions must be a non-empty array');
    });

    it('should fail when logic is invalid', () => {
      const result = handler.validateCriteria({
        logic: 'XOR', // invalid
        conditions: [{ event: 'test', operator: 'gte', target: 1 }],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('logic must be AND or OR');
    });

    it('should fail when logic is missing', () => {
      const result = handler.validateCriteria({
        conditions: [{ event: 'test', operator: 'gte', target: 1 }],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('logic must be AND or OR');
    });

    it('should fail when a condition has invalid operator', () => {
      const result = handler.validateCriteria({
        logic: 'AND',
        conditions: [
          { event: 'attendance.marked', operator: 'invalid_op', target: 5 },
        ],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'conditions[0].operator must be one of: gte, lte, eq',
      );
    });

    it('should fail when a condition has missing event', () => {
      const result = handler.validateCriteria({
        logic: 'AND',
        conditions: [{ operator: 'gte', target: 5 }],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'conditions[0].event must be a non-empty string',
      );
    });

    it('should fail when a condition has non-numeric target', () => {
      const result = handler.validateCriteria({
        logic: 'AND',
        conditions: [{ event: 'test', operator: 'gte', target: 'many' }],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'conditions[0].target must be a finite number',
      );
    });

    it('should validate all conditions and accumulate errors per index', () => {
      const result = handler.validateCriteria({
        logic: 'AND',
        conditions: [
          { event: 'ok', operator: 'gte', target: 1 },
          { operator: 'bad', target: 'not-a-number' }, // condition[1] has two errors
        ],
      });

      expect(result.valid).toBe(false);
      const errorString = result.errors!.join(' ');
      expect(errorString).toContain('[1]');
    });

    it('should fail when criteria is null', () => {
      const result = handler.validateCriteria(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('criteria must be an object');
    });
  });

  // ---------------------------------------------------------------------------
  // evaluate — AND logic
  // ---------------------------------------------------------------------------

  describe('evaluate (AND logic)', () => {
    const makeAchievement = (criteria: object) =>
      ({ achievement_id: 1, criteria } as any);

    const dummyEvent = { eventType: 'anything', payload: {} };

    it('should return matched=true when all AND conditions are met', async () => {
      // condition 1: attendance >= 5 → 5 events
      // condition 2: honor.earned >= 1 → 1 event
      mockPrismaService.achievement_event_log.findMany
        .mockResolvedValueOnce([
          { event_payload: {} },
          { event_payload: {} },
          { event_payload: {} },
          { event_payload: {} },
          { event_payload: {} },
        ])
        .mockResolvedValueOnce([{ event_payload: {} }]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({
          logic: 'AND',
          conditions: [
            { event: 'attendance.marked', operator: 'gte', target: 5 },
            { event: 'honor.earned', operator: 'gte', target: 1 },
          ],
        }),
        dummyEvent,
      );

      expect(result.matched).toBe(true);
      expect(result.currentProgress).toBe(2); // 2 conditions completed
      expect(result.targetProgress).toBe(2); // 2 total conditions
    });

    it('should return matched=false when one AND condition is not met', async () => {
      // condition 1 met (5 events), condition 2 not met (0 events)
      mockPrismaService.achievement_event_log.findMany
        .mockResolvedValueOnce([
          { event_payload: {} },
          { event_payload: {} },
          { event_payload: {} },
          { event_payload: {} },
          { event_payload: {} },
        ])
        .mockResolvedValueOnce([]); // honor.earned: 0

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({
          logic: 'AND',
          conditions: [
            { event: 'attendance.marked', operator: 'gte', target: 5 },
            { event: 'honor.earned', operator: 'gte', target: 1 },
          ],
        }),
        dummyEvent,
      );

      expect(result.matched).toBe(false);
      expect(result.currentProgress).toBe(1); // 1 of 2 completed
      expect(result.targetProgress).toBe(2);
    });

    it('should return per-condition metadata in the result', async () => {
      mockPrismaService.achievement_event_log.findMany
        .mockResolvedValueOnce([{ event_payload: {} }, { event_payload: {} }]) // attendance: 2
        .mockResolvedValueOnce([{ event_payload: {} }]); // honor: 1

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({
          logic: 'AND',
          conditions: [
            { event: 'attendance.marked', operator: 'gte', target: 2 },
            { event: 'honor.earned', operator: 'gte', target: 1 },
          ],
        }),
        dummyEvent,
      );

      expect(result.metadata).toBeDefined();
      const conditions = result.metadata!.conditions as any[];
      expect(conditions).toHaveLength(2);
      expect(conditions[0].event).toBe('attendance.marked');
      expect(conditions[0].completed).toBe(true);
      expect(conditions[1].event).toBe('honor.earned');
      expect(conditions[1].completed).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // evaluate — OR logic
  // ---------------------------------------------------------------------------

  describe('evaluate (OR logic)', () => {
    const makeAchievement = (criteria: object) =>
      ({ achievement_id: 1, criteria } as any);

    const dummyEvent = { eventType: 'anything', payload: {} };

    it('should return matched=true when at least one OR condition is met', async () => {
      // condition 1: 0 events (not met), condition 2: 3 events (met)
      mockPrismaService.achievement_event_log.findMany
        .mockResolvedValueOnce([]) // attendance: 0
        .mockResolvedValueOnce([
          { event_payload: {} },
          { event_payload: {} },
          { event_payload: {} },
        ]); // honor: 3

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({
          logic: 'OR',
          conditions: [
            { event: 'attendance.marked', operator: 'gte', target: 5 },
            { event: 'honor.earned', operator: 'gte', target: 3 },
          ],
        }),
        dummyEvent,
      );

      expect(result.matched).toBe(true);
    });

    it('should return matched=false when no OR condition is met', async () => {
      mockPrismaService.achievement_event_log.findMany
        .mockResolvedValueOnce([]) // attendance: 0
        .mockResolvedValueOnce([]); // honor: 0

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({
          logic: 'OR',
          conditions: [
            { event: 'attendance.marked', operator: 'gte', target: 5 },
            { event: 'honor.earned', operator: 'gte', target: 3 },
          ],
        }),
        dummyEvent,
      );

      expect(result.matched).toBe(false);
    });

    it('should represent OR progress as max percentage across conditions', async () => {
      // condition 1: 3/5 = 60%, condition 2: 1/3 = 33%
      mockPrismaService.achievement_event_log.findMany
        .mockResolvedValueOnce([{ event_payload: {} }, { event_payload: {} }, { event_payload: {} }]) // 3
        .mockResolvedValueOnce([{ event_payload: {} }]); // 1

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({
          logic: 'OR',
          conditions: [
            { event: 'attendance.marked', operator: 'gte', target: 5 },
            { event: 'honor.earned', operator: 'gte', target: 3 },
          ],
        }),
        dummyEvent,
      );

      // max is 3/5 = 60%, scaled to 100 target → currentProgress = 60, targetProgress = 100
      expect(result.currentProgress).toBe(60);
      expect(result.targetProgress).toBe(100);
    });
  });

  // ---------------------------------------------------------------------------
  // calculateProgress
  // ---------------------------------------------------------------------------

  describe('calculateProgress', () => {
    const makeAchievement = (criteria: object) =>
      ({ achievement_id: 1, criteria } as any);

    it('should return completed_count/total for AND logic', async () => {
      mockPrismaService.achievement_event_log.findMany
        .mockResolvedValueOnce([
          { event_payload: {} },
          { event_payload: {} },
          { event_payload: {} },
        ]) // 3 >= 3 → completed
        .mockResolvedValueOnce([]); // 0 < 1 → not completed

      const result = await handler.calculateProgress(
        'user-1',
        makeAchievement({
          logic: 'AND',
          conditions: [
            { event: 'attendance.marked', operator: 'gte', target: 3 },
            { event: 'honor.earned', operator: 'gte', target: 1 },
          ],
        }),
      );

      expect(result.current).toBe(1); // 1 of 2 completed
      expect(result.target).toBe(2);
      expect(result.percentage).toBe(50);
    });

    it('should return max_percentage for OR logic', async () => {
      // condition 1: 2/4 = 50%, condition 2: 0/1 = 0%
      mockPrismaService.achievement_event_log.findMany
        .mockResolvedValueOnce([{ event_payload: {} }, { event_payload: {} }]) // 2
        .mockResolvedValueOnce([]); // 0

      const result = await handler.calculateProgress(
        'user-1',
        makeAchievement({
          logic: 'OR',
          conditions: [
            { event: 'attendance.marked', operator: 'gte', target: 4 },
            { event: 'honor.earned', operator: 'gte', target: 1 },
          ],
        }),
      );

      expect(result.current).toBe(50); // max is 2/4 = 50%
      expect(result.target).toBe(100);
      expect(result.percentage).toBe(50);
    });

    it('should include conditions in metadata', async () => {
      mockPrismaService.achievement_event_log.findMany
        .mockResolvedValueOnce([{ event_payload: {} }]) // 1 >= 1 completed
        .mockResolvedValueOnce([{ event_payload: {} }]); // 1 >= 1 completed

      const result = await handler.calculateProgress(
        'user-1',
        makeAchievement({
          logic: 'AND',
          conditions: [
            { event: 'a', operator: 'gte', target: 1 },
            { event: 'b', operator: 'gte', target: 1 },
          ],
        }),
      );

      expect(result.metadata).toBeDefined();
      expect((result.metadata!.conditions as any[]).length).toBe(2);
    });
  });
});

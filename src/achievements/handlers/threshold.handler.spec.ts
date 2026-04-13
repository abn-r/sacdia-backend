import { Test, TestingModule } from '@nestjs/testing';
import { ThresholdHandler } from './threshold.handler';
import { HandlerRegistry } from './handler.registry';
import { PrismaService } from '../../prisma/prisma.service';

describe('ThresholdHandler', () => {
  let handler: ThresholdHandler;

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
        ThresholdHandler,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: HandlerRegistry, useValue: mockHandlerRegistry },
      ],
    }).compile();

    handler = module.get<ThresholdHandler>(ThresholdHandler);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  it('should register itself on module init', () => {
    handler.onModuleInit();
    expect(mockHandlerRegistry.register).toHaveBeenCalledWith('THRESHOLD', handler);
  });

  // ---------------------------------------------------------------------------
  // validateCriteria
  // ---------------------------------------------------------------------------

  describe('validateCriteria', () => {
    it('should return valid for correct criteria', () => {
      const result = handler.validateCriteria({
        event: 'attendance.marked',
        operator: 'gte',
        target: 5,
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should return valid for criteria with optional filters', () => {
      const result = handler.validateCriteria({
        event: 'attendance.marked',
        operator: 'gte',
        target: 5,
        filters: { club_type: 'CONQUISTADORES' },
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should fail when event is missing', () => {
      const result = handler.validateCriteria({
        operator: 'gte',
        target: 5,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('event must be a non-empty string');
    });

    it('should fail when event is empty string', () => {
      const result = handler.validateCriteria({
        event: '',
        operator: 'gte',
        target: 5,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('event must be a non-empty string');
    });

    it('should fail when operator is invalid', () => {
      const result = handler.validateCriteria({
        event: 'attendance.marked',
        operator: 'gt', // invalid — must be gte, lte, eq
        target: 5,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('operator must be one of: gte, lte, eq');
    });

    it('should fail when target is not a number', () => {
      const result = handler.validateCriteria({
        event: 'attendance.marked',
        operator: 'gte',
        target: 'five',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('target must be a finite number');
    });

    it('should fail when target is Infinity', () => {
      const result = handler.validateCriteria({
        event: 'attendance.marked',
        operator: 'gte',
        target: Infinity,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('target must be a finite number');
    });

    it('should fail when filters is a non-object value', () => {
      const result = handler.validateCriteria({
        event: 'attendance.marked',
        operator: 'gte',
        target: 5,
        filters: 'invalid',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('filters must be an object when provided');
    });

    it('should fail when criteria is not an object', () => {
      const result = handler.validateCriteria('not-an-object');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('criteria must be an object');
    });

    it('should fail when criteria is null', () => {
      const result = handler.validateCriteria(null);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('criteria must be an object');
    });

    it('should accumulate multiple errors', () => {
      const result = handler.validateCriteria({
        operator: 'bad',
        target: 'notANumber',
      });

      expect(result.valid).toBe(false);
      expect(result.errors!.length).toBeGreaterThan(1);
    });
  });

  // ---------------------------------------------------------------------------
  // evaluate
  // ---------------------------------------------------------------------------

  describe('evaluate', () => {
    const makeAchievement = (criteria: object) =>
      ({
        achievement_id: 1,
        criteria,
      } as any);

    it('should return matched=true when event count meets gte target', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: {} },
        { event_payload: {} },
        { event_payload: {} },
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({ event: 'attendance.marked', operator: 'gte', target: 3 }),
        { eventType: 'attendance.marked', payload: {} },
      );

      expect(result.matched).toBe(true);
      expect(result.currentProgress).toBe(3);
      expect(result.targetProgress).toBe(3);
    });

    it('should return matched=false when event count is below gte target', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: {} },
        { event_payload: {} },
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({ event: 'attendance.marked', operator: 'gte', target: 5 }),
        { eventType: 'attendance.marked', payload: {} },
      );

      expect(result.matched).toBe(false);
      expect(result.currentProgress).toBe(2);
      expect(result.targetProgress).toBe(5);
    });

    it('should return matched=true when count exactly equals eq target', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: {} },
        { event_payload: {} },
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({ event: 'login', operator: 'eq', target: 2 }),
        { eventType: 'login', payload: {} },
      );

      expect(result.matched).toBe(true);
    });

    it('should return matched=true when count is within lte target', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: {} },
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({ event: 'error.reported', operator: 'lte', target: 3 }),
        { eventType: 'error.reported', payload: {} },
      );

      expect(result.matched).toBe(true);
    });

    it('should respect payload filters and only count matching events', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: { club_type: 'CONQUISTADORES' } },
        { event_payload: { club_type: 'CONQUISTADORES' } },
        { event_payload: { club_type: 'AVENTUREROS' } }, // should be excluded
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({
          event: 'attendance.marked',
          operator: 'gte',
          target: 2,
          filters: { club_type: 'CONQUISTADORES' },
        }),
        { eventType: 'attendance.marked', payload: { club_type: 'CONQUISTADORES' } },
      );

      expect(result.matched).toBe(true);
      expect(result.currentProgress).toBe(2);
    });

    it('should return matched=false when filter excludes all events', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: { club_type: 'AVENTUREROS' } },
        { event_payload: { club_type: 'AVENTUREROS' } },
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({
          event: 'attendance.marked',
          operator: 'gte',
          target: 1,
          filters: { club_type: 'CONQUISTADORES' },
        }),
        { eventType: 'attendance.marked', payload: { club_type: 'AVENTUREROS' } },
      );

      expect(result.matched).toBe(false);
      expect(result.currentProgress).toBe(0);
    });

    it('should handle empty event log', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({ event: 'attendance.marked', operator: 'gte', target: 3 }),
        { eventType: 'attendance.marked', payload: {} },
      );

      expect(result.matched).toBe(false);
      expect(result.currentProgress).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // calculateProgress
  // ---------------------------------------------------------------------------

  describe('calculateProgress', () => {
    const makeAchievement = (criteria: object) =>
      ({ achievement_id: 1, criteria } as any);

    it('should return correct current, target and percentage', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: {} },
        { event_payload: {} },
      ]);

      const result = await handler.calculateProgress(
        'user-1',
        makeAchievement({ event: 'attendance.marked', operator: 'gte', target: 4 }),
      );

      expect(result.current).toBe(2);
      expect(result.target).toBe(4);
      expect(result.percentage).toBe(50);
    });

    it('should cap percentage at 100 when count exceeds target', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: {} },
        { event_payload: {} },
        { event_payload: {} },
        { event_payload: {} },
        { event_payload: {} },
      ]);

      const result = await handler.calculateProgress(
        'user-1',
        makeAchievement({ event: 'attendance.marked', operator: 'gte', target: 3 }),
      );

      expect(result.percentage).toBe(100);
    });

    it('should return 0% when no events exist', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([]);

      const result = await handler.calculateProgress(
        'user-1',
        makeAchievement({ event: 'attendance.marked', operator: 'gte', target: 5 }),
      );

      expect(result.current).toBe(0);
      expect(result.target).toBe(5);
      expect(result.percentage).toBe(0);
    });
  });
});

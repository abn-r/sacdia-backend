import { Test, TestingModule } from '@nestjs/testing';
import { CollectionHandler } from './collection.handler';
import { HandlerRegistry } from './handler.registry';
import { PrismaService } from '../../prisma/prisma.service';

describe('CollectionHandler', () => {
  let handler: CollectionHandler;

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
        CollectionHandler,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: HandlerRegistry, useValue: mockHandlerRegistry },
      ],
    }).compile();

    handler = module.get<CollectionHandler>(CollectionHandler);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  it('should register itself on module init', () => {
    handler.onModuleInit();
    expect(mockHandlerRegistry.register).toHaveBeenCalledWith(
      'COLLECTION',
      handler,
    );
  });

  // ---------------------------------------------------------------------------
  // validateCriteria
  // ---------------------------------------------------------------------------

  describe('validateCriteria', () => {
    it('should return valid for correct collection criteria', () => {
      const result = handler.validateCriteria({
        event: 'honor.earned',
        operator: 'distinct_count',
        distinct_field: 'honor_id',
        target: 10,
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should return valid when optional filters are provided', () => {
      const result = handler.validateCriteria({
        event: 'honor.earned',
        operator: 'distinct_count',
        distinct_field: 'honor_id',
        target: 10,
        filters: { category: 'nature' },
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should fail when distinct_field is missing', () => {
      const result = handler.validateCriteria({
        event: 'honor.earned',
        operator: 'distinct_count',
        target: 10,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'distinct_field must be a non-empty string',
      );
    });

    it('should fail when distinct_field is empty string', () => {
      const result = handler.validateCriteria({
        event: 'honor.earned',
        operator: 'distinct_count',
        distinct_field: '',
        target: 10,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'distinct_field must be a non-empty string',
      );
    });

    it('should fail when target is zero (must be positive)', () => {
      const result = handler.validateCriteria({
        event: 'honor.earned',
        operator: 'distinct_count',
        distinct_field: 'honor_id',
        target: 0,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'target must be a positive finite number',
      );
    });

    it('should fail when target is negative', () => {
      const result = handler.validateCriteria({
        event: 'honor.earned',
        operator: 'distinct_count',
        distinct_field: 'honor_id',
        target: -5,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'target must be a positive finite number',
      );
    });

    it('should fail when target is not a number', () => {
      const result = handler.validateCriteria({
        event: 'honor.earned',
        operator: 'distinct_count',
        distinct_field: 'honor_id',
        target: 'many',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'target must be a positive finite number',
      );
    });

    it('should fail when filters is not an object', () => {
      const result = handler.validateCriteria({
        event: 'honor.earned',
        operator: 'distinct_count',
        distinct_field: 'honor_id',
        target: 10,
        filters: 'invalid',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'filters must be an object when provided',
      );
    });

    it('should fail when event is missing', () => {
      const result = handler.validateCriteria({
        operator: 'distinct_count',
        distinct_field: 'honor_id',
        target: 10,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('event must be a non-empty string');
    });

    it('should fail when criteria is null', () => {
      const result = handler.validateCriteria(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('criteria must be an object');
    });
  });

  // ---------------------------------------------------------------------------
  // evaluate
  // ---------------------------------------------------------------------------

  describe('evaluate', () => {
    const makeAchievement = (criteria: object) =>
      ({ achievement_id: 1, criteria }) as any;

    const dummyEvent = { eventType: 'honor.earned', payload: {} };

    it('should collect distinct values and return matched=true when count >= target', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: { honor_id: 1 } },
        { event_payload: { honor_id: 2 } },
        { event_payload: { honor_id: 3 } },
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({
          event: 'honor.earned',
          operator: 'distinct_count',
          distinct_field: 'honor_id',
          target: 3,
        }),
        dummyEvent,
      );

      expect(result.matched).toBe(true);
      expect(result.currentProgress).toBe(3);
      expect(result.targetProgress).toBe(3);
    });

    it('should return matched=false when distinct count is below target', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: { honor_id: 1 } },
        { event_payload: { honor_id: 2 } },
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({
          event: 'honor.earned',
          operator: 'distinct_count',
          distinct_field: 'honor_id',
          target: 5,
        }),
        dummyEvent,
      );

      expect(result.matched).toBe(false);
      expect(result.currentProgress).toBe(2);
      expect(result.targetProgress).toBe(5);
    });

    it('should count duplicate values only once (distinct behavior)', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: { honor_id: 1 } },
        { event_payload: { honor_id: 1 } }, // duplicate
        { event_payload: { honor_id: 2 } },
        { event_payload: { honor_id: 2 } }, // duplicate
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({
          event: 'honor.earned',
          operator: 'distinct_count',
          distinct_field: 'honor_id',
          target: 3,
        }),
        dummyEvent,
      );

      // Only 2 distinct honor IDs: 1 and 2
      expect(result.currentProgress).toBe(2);
      expect(result.matched).toBe(false);
    });

    it('should respect filters and only count events that pass the filter', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: { honor_id: 1, category: 'nature' } },
        { event_payload: { honor_id: 2, category: 'nature' } },
        { event_payload: { honor_id: 3, category: 'craft' } }, // filtered out
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({
          event: 'honor.earned',
          operator: 'distinct_count',
          distinct_field: 'honor_id',
          target: 2,
          filters: { category: 'nature' },
        }),
        dummyEvent,
      );

      expect(result.currentProgress).toBe(2); // only nature honors count
      expect(result.matched).toBe(true);
    });

    it('should include collected_items in metadata', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: { honor_id: 10 } },
        { event_payload: { honor_id: 20 } },
        { event_payload: { honor_id: 30 } },
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({
          event: 'honor.earned',
          operator: 'distinct_count',
          distinct_field: 'honor_id',
          target: 3,
        }),
        dummyEvent,
      );

      expect(result.metadata).toBeDefined();
      const items = result.metadata!.collected_items as number[];
      expect(items).toHaveLength(3);
      expect(items).toContain(10);
      expect(items).toContain(20);
      expect(items).toContain(30);
    });

    it('should handle empty event log and return matched=false', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({
          event: 'honor.earned',
          operator: 'distinct_count',
          distinct_field: 'honor_id',
          target: 5,
        }),
        dummyEvent,
      );

      expect(result.matched).toBe(false);
      expect(result.currentProgress).toBe(0);
      const items = result.metadata!.collected_items as unknown[];
      expect(items).toHaveLength(0);
    });

    it('should exclude events where the distinct field is null or undefined', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: { honor_id: 1 } },
        { event_payload: {} }, // no honor_id field
        { event_payload: { honor_id: null } }, // null honor_id
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({
          event: 'honor.earned',
          operator: 'distinct_count',
          distinct_field: 'honor_id',
          target: 2,
        }),
        dummyEvent,
      );

      // Only honor_id=1 is valid; null/undefined are excluded
      expect(result.currentProgress).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // calculateProgress
  // ---------------------------------------------------------------------------

  describe('calculateProgress', () => {
    const makeAchievement = (criteria: object) =>
      ({ achievement_id: 1, criteria }) as any;

    it('should return distinct count vs target with correct percentage', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: { honor_id: 1 } },
        { event_payload: { honor_id: 2 } },
        { event_payload: { honor_id: 3 } },
      ]);

      const result = await handler.calculateProgress(
        'user-1',
        makeAchievement({
          event: 'honor.earned',
          operator: 'distinct_count',
          distinct_field: 'honor_id',
          target: 6,
        }),
      );

      expect(result.current).toBe(3);
      expect(result.target).toBe(6);
      expect(result.percentage).toBe(50);
    });

    it('should return 0 current and 0% when no events', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([]);

      const result = await handler.calculateProgress(
        'user-1',
        makeAchievement({
          event: 'honor.earned',
          operator: 'distinct_count',
          distinct_field: 'honor_id',
          target: 10,
        }),
      );

      expect(result.current).toBe(0);
      expect(result.percentage).toBe(0);
    });

    it('should cap percentage at 100 when distinct count exceeds target', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: { honor_id: 1 } },
        { event_payload: { honor_id: 2 } },
        { event_payload: { honor_id: 3 } },
        { event_payload: { honor_id: 4 } },
        { event_payload: { honor_id: 5 } },
      ]);

      const result = await handler.calculateProgress(
        'user-1',
        makeAchievement({
          event: 'honor.earned',
          operator: 'distinct_count',
          distinct_field: 'honor_id',
          target: 3,
        }),
      );

      expect(result.percentage).toBe(100);
    });

    it('should include collected_items in metadata', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: { honor_id: 42 } },
      ]);

      const result = await handler.calculateProgress(
        'user-1',
        makeAchievement({
          event: 'honor.earned',
          operator: 'distinct_count',
          distinct_field: 'honor_id',
          target: 5,
        }),
      );

      expect(result.metadata).toBeDefined();
      expect(result.metadata!.collected_items).toContain(42);
    });
  });
});

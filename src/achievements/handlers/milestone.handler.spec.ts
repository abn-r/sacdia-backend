import { Test, TestingModule } from '@nestjs/testing';
import { MilestoneHandler } from './milestone.handler';
import { HandlerRegistry } from './handler.registry';
import { PrismaService } from '../../prisma/prisma.service';

describe('MilestoneHandler', () => {
  let handler: MilestoneHandler;

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
        MilestoneHandler,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: HandlerRegistry, useValue: mockHandlerRegistry },
      ],
    }).compile();

    handler = module.get<MilestoneHandler>(MilestoneHandler);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  it('should register itself on module init', () => {
    handler.onModuleInit();
    expect(mockHandlerRegistry.register).toHaveBeenCalledWith('MILESTONE', handler);
  });

  // ---------------------------------------------------------------------------
  // validateCriteria
  // ---------------------------------------------------------------------------

  describe('validateCriteria', () => {
    it('should return valid for correct milestone criteria (string target)', () => {
      const result = handler.validateCriteria({
        event: 'profile.updated',
        field: 'status',
        operator: 'eq',
        target: 'COMPLETE',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should return valid for correct milestone criteria (number target)', () => {
      const result = handler.validateCriteria({
        event: 'level.reached',
        field: 'level',
        operator: 'eq',
        target: 10,
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should fail when event is missing', () => {
      const result = handler.validateCriteria({
        field: 'status',
        operator: 'eq',
        target: 'COMPLETE',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('event must be a non-empty string');
    });

    it('should fail when field is missing', () => {
      const result = handler.validateCriteria({
        event: 'profile.updated',
        operator: 'eq',
        target: 'COMPLETE',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('field must be a non-empty string');
    });

    it('should fail when field is empty string', () => {
      const result = handler.validateCriteria({
        event: 'profile.updated',
        field: '',
        operator: 'eq',
        target: 'COMPLETE',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('field must be a non-empty string');
    });

    it('should fail when operator is not eq', () => {
      const result = handler.validateCriteria({
        event: 'profile.updated',
        field: 'status',
        operator: 'gte', // only 'eq' is allowed for milestones
        target: 'COMPLETE',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('operator must be eq');
    });

    it('should fail when operator is missing', () => {
      const result = handler.validateCriteria({
        event: 'profile.updated',
        field: 'status',
        target: 'COMPLETE',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('operator must be eq');
    });

    it('should fail when target is an object (not string or number)', () => {
      const result = handler.validateCriteria({
        event: 'profile.updated',
        field: 'status',
        operator: 'eq',
        target: { invalid: true },
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('target must be a string or number');
    });

    it('should fail when target is null', () => {
      const result = handler.validateCriteria({
        event: 'profile.updated',
        field: 'status',
        operator: 'eq',
        target: null,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('target must be a string or number');
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
      ({ achievement_id: 1, criteria } as any);

    it('should return matched=true when live payload matches the milestone field', async () => {
      // The historical log query should NOT be called when live payload matches
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({ event: 'profile.updated', field: 'status', operator: 'eq', target: 'COMPLETE' }),
        { eventType: 'profile.updated', payload: { status: 'COMPLETE' } },
      );

      expect(result.matched).toBe(true);
      expect(result.currentProgress).toBe(1);
      expect(result.targetProgress).toBe(1);
    });

    it('should return matched=false when live payload does not match and no historical match exists', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: { status: 'PENDING' } }, // not COMPLETE
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({ event: 'profile.updated', field: 'status', operator: 'eq', target: 'COMPLETE' }),
        { eventType: 'profile.updated', payload: { status: 'PENDING' } },
      );

      expect(result.matched).toBe(false);
      expect(result.currentProgress).toBe(0);
      expect(result.targetProgress).toBe(1);
    });

    it('should fall back to historical event log when live payload does not match', async () => {
      // Historical log has a matching event
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: { status: 'PENDING' } },
        { event_payload: { status: 'COMPLETE' } }, // historical match
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({ event: 'profile.updated', field: 'status', operator: 'eq', target: 'COMPLETE' }),
        { eventType: 'profile.updated', payload: { status: 'PENDING' } },
      );

      expect(result.matched).toBe(true);
      expect(result.currentProgress).toBe(1);
    });

    it('should skip live check when event type does not match and query history', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: { status: 'COMPLETE' } },
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({ event: 'profile.updated', field: 'status', operator: 'eq', target: 'COMPLETE' }),
        { eventType: 'some.other.event', payload: {} }, // different event type
      );

      expect(result.matched).toBe(true);
    });

    it('should return matched=false with progress 0/1 when no historical match', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({ event: 'level.reached', field: 'level', operator: 'eq', target: 10 }),
        { eventType: 'level.reached', payload: { level: 5 } },
      );

      expect(result.matched).toBe(false);
      expect(result.currentProgress).toBe(0);
      expect(result.targetProgress).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // calculateProgress
  // ---------------------------------------------------------------------------

  describe('calculateProgress', () => {
    const makeAchievement = (criteria: object) =>
      ({ achievement_id: 1, criteria } as any);

    it('should return current=1, target=1, percentage=100 when milestone is completed', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: { status: 'COMPLETE' } },
      ]);

      const result = await handler.calculateProgress(
        'user-1',
        makeAchievement({ event: 'profile.updated', field: 'status', operator: 'eq', target: 'COMPLETE' }),
      );

      expect(result.current).toBe(1);
      expect(result.target).toBe(1);
      expect(result.percentage).toBe(100);
    });

    it('should return current=0, target=1, percentage=0 when milestone is not completed', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { event_payload: { status: 'PENDING' } },
      ]);

      const result = await handler.calculateProgress(
        'user-1',
        makeAchievement({ event: 'profile.updated', field: 'status', operator: 'eq', target: 'COMPLETE' }),
      );

      expect(result.current).toBe(0);
      expect(result.target).toBe(1);
      expect(result.percentage).toBe(0);
    });

    it('should return 0 progress when event log is empty', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([]);

      const result = await handler.calculateProgress(
        'user-1',
        makeAchievement({ event: 'profile.updated', field: 'status', operator: 'eq', target: 'COMPLETE' }),
      );

      expect(result.current).toBe(0);
      expect(result.percentage).toBe(0);
    });
  });
});

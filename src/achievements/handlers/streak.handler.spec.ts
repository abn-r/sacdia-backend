import { Test, TestingModule } from '@nestjs/testing';
import { StreakHandler } from './streak.handler';
import { HandlerRegistry } from './handler.registry';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Helper — build a Date anchored to a specific ISO date string (UTC midnight).
 */
function d(isoDate: string): Date {
  return new Date(isoDate + 'T00:00:00Z');
}

describe('StreakHandler', () => {
  let handler: StreakHandler;

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
        StreakHandler,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: HandlerRegistry, useValue: mockHandlerRegistry },
      ],
    }).compile();

    handler = module.get<StreakHandler>(StreakHandler);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  it('should register itself on module init', () => {
    handler.onModuleInit();
    expect(mockHandlerRegistry.register).toHaveBeenCalledWith('STREAK', handler);
  });

  // ---------------------------------------------------------------------------
  // validateCriteria
  // ---------------------------------------------------------------------------

  describe('validateCriteria', () => {
    it('should return valid for correct streak criteria with week unit', () => {
      const result = handler.validateCriteria({
        event: 'attendance.marked',
        operator: 'streak',
        target: 4,
        streak_unit: 'week',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should return valid when grace_period is included', () => {
      const result = handler.validateCriteria({
        event: 'attendance.marked',
        operator: 'streak',
        target: 4,
        streak_unit: 'week',
        grace_period: 1,
      });

      expect(result.valid).toBe(true);
    });

    it('should fail when streak_unit is invalid', () => {
      const result = handler.validateCriteria({
        event: 'attendance.marked',
        operator: 'streak',
        target: 4,
        streak_unit: 'biweek', // invalid
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('streak_unit must be one of: day, week, month');
    });

    it('should fail when streak_unit is missing', () => {
      const result = handler.validateCriteria({
        event: 'attendance.marked',
        operator: 'streak',
        target: 4,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('streak_unit must be one of: day, week, month');
    });

    it('should fail when target is missing', () => {
      const result = handler.validateCriteria({
        event: 'attendance.marked',
        operator: 'streak',
        streak_unit: 'week',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('target must be a positive finite number');
    });

    it('should fail when target is zero', () => {
      const result = handler.validateCriteria({
        event: 'attendance.marked',
        operator: 'streak',
        target: 0,
        streak_unit: 'week',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('target must be a positive finite number');
    });

    it('should fail when target is negative', () => {
      const result = handler.validateCriteria({
        event: 'attendance.marked',
        operator: 'streak',
        target: -1,
        streak_unit: 'week',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('target must be a positive finite number');
    });

    it('should fail when grace_period is negative', () => {
      const result = handler.validateCriteria({
        event: 'attendance.marked',
        operator: 'streak',
        target: 4,
        streak_unit: 'week',
        grace_period: -1,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'grace_period must be a non-negative number when provided',
      );
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

    const dummyEvent = { eventType: 'attendance.marked', payload: {} };

    it('should detect a 4-week consecutive streak and return matched=true', async () => {
      // 4 consecutive ISO weeks: 2026-W06, W07, W08, W09
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { created_at: d('2026-02-02') }, // W06
        { created_at: d('2026-02-09') }, // W07
        { created_at: d('2026-02-16') }, // W08
        { created_at: d('2026-02-23') }, // W09
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({ event: 'attendance.marked', operator: 'streak', target: 4, streak_unit: 'week' }),
        dummyEvent,
      );

      expect(result.matched).toBe(true);
      expect(result.currentProgress).toBeGreaterThanOrEqual(4);
      expect(result.targetProgress).toBe(4);
    });

    it('should return matched=false when there is a gap in the weekly streak', async () => {
      // W06, W07, gap (W08 missing), W09
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { created_at: d('2026-02-02') }, // W06
        { created_at: d('2026-02-09') }, // W07
        // W08 missing
        { created_at: d('2026-02-23') }, // W09
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({ event: 'attendance.marked', operator: 'streak', target: 4, streak_unit: 'week' }),
        dummyEvent,
      );

      // Streak restarts from W09, max consecutive is 2 (W07, gap then W09)
      // Without grace, streak from W09 backward is just 1 (W08 is missing)
      expect(result.matched).toBe(false);
    });

    it('should respect grace_period and count a week with 1 missed period allowed', async () => {
      // W06, W07, gap (W08), W09 — with grace_period=1 this still forms a 4-week streak
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { created_at: d('2026-02-02') }, // W06
        { created_at: d('2026-02-09') }, // W07
        // W08 missing (covered by grace)
        { created_at: d('2026-02-23') }, // W09
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({
          event: 'attendance.marked',
          operator: 'streak',
          target: 4,
          streak_unit: 'week',
          grace_period: 1,
        }),
        dummyEvent,
      );

      // With grace_period=1, the gap in W08 is forgiven → streak = W06+W07+(grace W08)+W09 = 4
      expect(result.matched).toBe(true);
    });

    it('should handle daily streak correctly', async () => {
      // 3 consecutive days
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { created_at: d('2026-03-01') },
        { created_at: d('2026-03-02') },
        { created_at: d('2026-03-03') },
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({ event: 'login', operator: 'streak', target: 3, streak_unit: 'day' }),
        dummyEvent,
      );

      expect(result.matched).toBe(true);
      expect(result.currentProgress).toBe(3);
    });

    it('should handle monthly streak correctly', async () => {
      // 3 consecutive months
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { created_at: d('2026-01-15') }, // 2026-01
        { created_at: d('2026-02-10') }, // 2026-02
        { created_at: d('2026-03-05') }, // 2026-03
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({ event: 'donation.made', operator: 'streak', target: 3, streak_unit: 'month' }),
        dummyEvent,
      );

      expect(result.matched).toBe(true);
      expect(result.currentProgress).toBe(3);
    });

    it('should count events in the same period only once', async () => {
      // Two events in the same week — should only count as 1 week in the streak
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { created_at: d('2026-02-09') }, // W07 — Monday
        { created_at: d('2026-02-11') }, // W07 — Wednesday (same week)
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({ event: 'attendance.marked', operator: 'streak', target: 2, streak_unit: 'week' }),
        dummyEvent,
      );

      // Only 1 distinct week, streak is 1, target is 2
      expect(result.matched).toBe(false);
      expect(result.currentProgress).toBe(1);
    });

    it('should return streak of 0 for empty event log', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({ event: 'attendance.marked', operator: 'streak', target: 4, streak_unit: 'week' }),
        dummyEvent,
      );

      expect(result.matched).toBe(false);
      expect(result.currentProgress).toBe(0);
    });

    it('should return streak of 1 for a single event', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { created_at: d('2026-02-09') }, // W07
      ]);

      const result = await handler.evaluate(
        'user-1',
        makeAchievement({ event: 'attendance.marked', operator: 'streak', target: 4, streak_unit: 'week' }),
        dummyEvent,
      );

      expect(result.currentProgress).toBe(1);
      expect(result.matched).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // calculateProgress
  // ---------------------------------------------------------------------------

  describe('calculateProgress', () => {
    const makeAchievement = (criteria: object) =>
      ({ achievement_id: 1, criteria } as any);

    it('should return current streak length vs target with correct percentage', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { created_at: d('2026-02-09') }, // W07
        { created_at: d('2026-02-16') }, // W08
      ]);

      const result = await handler.calculateProgress(
        'user-1',
        makeAchievement({ event: 'attendance.marked', operator: 'streak', target: 4, streak_unit: 'week' }),
      );

      expect(result.current).toBe(2);
      expect(result.target).toBe(4);
      expect(result.percentage).toBe(50);
    });

    it('should return 0 current and 0% when no events exist', async () => {
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([]);

      const result = await handler.calculateProgress(
        'user-1',
        makeAchievement({ event: 'attendance.marked', operator: 'streak', target: 4, streak_unit: 'week' }),
      );

      expect(result.current).toBe(0);
      expect(result.percentage).toBe(0);
    });

    it('should cap percentage at 100 when streak exceeds target', async () => {
      // 5 consecutive weeks but target is 3
      mockPrismaService.achievement_event_log.findMany.mockResolvedValue([
        { created_at: d('2026-01-26') }, // W05
        { created_at: d('2026-02-02') }, // W06
        { created_at: d('2026-02-09') }, // W07
        { created_at: d('2026-02-16') }, // W08
        { created_at: d('2026-02-23') }, // W09
      ]);

      const result = await handler.calculateProgress(
        'user-1',
        makeAchievement({ event: 'attendance.marked', operator: 'streak', target: 3, streak_unit: 'week' }),
      );

      expect(result.percentage).toBe(100);
    });
  });
});

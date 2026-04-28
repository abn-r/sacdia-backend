import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { achievements } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AchievementHandler,
  EvaluationResult,
  ProgressResult,
  ValidationResult,
} from './handler.interface';
import { HandlerRegistry } from './handler.registry';

interface StreakCriteria {
  event: string;
  operator: 'streak';
  target: number;
  streak_unit: 'day' | 'week' | 'month';
  grace_period?: number;
}

@Injectable()
export class StreakHandler implements AchievementHandler, OnModuleInit {
  private readonly logger = new Logger(StreakHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: HandlerRegistry,
  ) {}

  onModuleInit() {
    this.registry.register('STREAK', this);
    this.logger.log('StreakHandler registered');
  }

  validateCriteria(criteria: unknown): ValidationResult {
    const errors: string[] = [];

    if (!criteria || typeof criteria !== 'object') {
      return { valid: false, errors: ['criteria must be an object'] };
    }

    const c = criteria as Record<string, unknown>;

    if (typeof c.event !== 'string' || !c.event) {
      errors.push('event must be a non-empty string');
    }

    if (
      typeof c.target !== 'number' ||
      !Number.isFinite(c.target) ||
      c.target < 1
    ) {
      errors.push('target must be a positive finite number');
    }

    if (!['day', 'week', 'month'].includes(c.streak_unit as string)) {
      errors.push('streak_unit must be one of: day, week, month');
    }

    if (c.grace_period !== undefined) {
      if (typeof c.grace_period !== 'number' || c.grace_period < 0) {
        errors.push('grace_period must be a non-negative number when provided');
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  async evaluate(
    userId: string,
    achievement: achievements,
    _event: { eventType: string; payload: Record<string, unknown> },
  ): Promise<EvaluationResult> {
    const criteria = achievement.criteria as unknown as StreakCriteria;
    const currentStreak = await this.computeCurrentStreak(userId, criteria);
    const matched = currentStreak >= criteria.target;

    return {
      matched,
      currentProgress: currentStreak,
      targetProgress: criteria.target,
    };
  }

  async calculateProgress(
    userId: string,
    achievement: achievements,
  ): Promise<ProgressResult> {
    const criteria = achievement.criteria as unknown as StreakCriteria;
    const current = await this.computeCurrentStreak(userId, criteria);
    const target = criteria.target;
    const percentage = Math.min(100, Math.round((current / target) * 100));

    return { current, target, percentage };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Compute the current consecutive streak (in streak_unit windows) for the
   * given user and event type. Works backwards from the most recent period,
   * allowing grace_period missed windows.
   */
  private async computeCurrentStreak(
    userId: string,
    criteria: StreakCriteria,
  ): Promise<number> {
    const events = await this.prisma.achievement_event_log.findMany({
      where: {
        user_id: userId,
        event_type: criteria.event,
      },
      select: { created_at: true },
      orderBy: { created_at: 'desc' },
    });

    if (events.length === 0) return 0;

    // Collect distinct period keys the user has events in
    const periodSet = new Set<string>();
    for (const e of events) {
      periodSet.add(this.toPeriodKey(e.created_at, criteria.streak_unit));
    }

    // Sort period keys descending
    const periods = Array.from(periodSet).sort().reverse();

    if (periods.length === 0) return 0;

    const gracePeriod = criteria.grace_period ?? 0;
    let streak = 1;
    let missesLeft = gracePeriod;
    let currentPeriod = periods[0];

    for (let i = 1; i < 1000; i++) {
      const previousPeriod = this.previousPeriodKey(
        currentPeriod,
        criteria.streak_unit,
      );

      if (periodSet.has(previousPeriod)) {
        streak++;
        currentPeriod = previousPeriod;
        missesLeft = gracePeriod; // reset grace on hit
      } else if (missesLeft > 0) {
        missesLeft--;
        streak++; // grace gap counts as a forgiven period toward the streak
        currentPeriod = previousPeriod; // skip this window (grace)
      } else {
        break;
      }
    }

    return streak;
  }

  /**
   * Convert a date to a sortable period key string:
   * day  → "YYYY-MM-DD"
   * week → "YYYY-WNN"  (ISO week)
   * month→ "YYYY-MM"
   */
  private toPeriodKey(date: Date, unit: 'day' | 'week' | 'month'): string {
    const d = new Date(date);
    switch (unit) {
      case 'day':
        return d.toISOString().slice(0, 10);
      case 'month':
        return d.toISOString().slice(0, 7);
      case 'week': {
        const isoWeek = this.getISOWeekKey(d);
        return isoWeek;
      }
    }
  }

  /**
   * Returns "YYYY-WNN" for ISO week — Monday-based.
   * Uses UTC getters to avoid local-timezone date shifts on UTC-midnight inputs.
   */
  private getISOWeekKey(date: Date): string {
    const d = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
    const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil(
      ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
    );
    return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  }

  /**
   * Return the period key immediately before the given one.
   */
  private previousPeriodKey(
    key: string,
    unit: 'day' | 'week' | 'month',
  ): string {
    switch (unit) {
      case 'day': {
        const d = new Date(key + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
      }
      case 'month': {
        const [year, month] = key.split('-').map(Number);
        const d = new Date(Date.UTC(year, month - 2, 1));
        return d.toISOString().slice(0, 7);
      }
      case 'week': {
        // "YYYY-WNN" → parse year and week number
        const [yearStr, weekPart] = key.split('-W');
        const year = parseInt(yearStr, 10);
        const week = parseInt(weekPart, 10);

        if (week > 1) {
          return `${year}-W${String(week - 1).padStart(2, '0')}`;
        } else {
          // Week 1 of year → last week of previous year
          const dec28 = new Date(Date.UTC(year - 1, 11, 28));
          return this.getISOWeekKey(dec28);
        }
      }
    }
  }
}

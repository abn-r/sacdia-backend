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

interface ThresholdCriteria {
  event: string;
  operator: 'gte' | 'lte' | 'eq';
  target: number;
  filters?: Record<string, unknown>;
}

@Injectable()
export class ThresholdHandler implements AchievementHandler, OnModuleInit {
  private readonly logger = new Logger(ThresholdHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: HandlerRegistry,
  ) {}

  onModuleInit() {
    this.registry.register('THRESHOLD', this);
    this.logger.log('ThresholdHandler registered');
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

    if (!['gte', 'lte', 'eq'].includes(c.operator as string)) {
      errors.push('operator must be one of: gte, lte, eq');
    }

    if (typeof c.target !== 'number' || !Number.isFinite(c.target)) {
      errors.push('target must be a finite number');
    }

    if (
      c.filters !== undefined &&
      (typeof c.filters !== 'object' || c.filters === null)
    ) {
      errors.push('filters must be an object when provided');
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  async evaluate(
    userId: string,
    achievement: achievements,
    event: { eventType: string; payload: Record<string, unknown> },
  ): Promise<EvaluationResult> {
    const criteria = achievement.criteria as unknown as ThresholdCriteria;

    // Only process if this event type matches
    if (event.eventType !== criteria.event) {
      const progress = await this.countMatchingEvents(userId, criteria);
      return {
        matched: this.compare(progress, criteria.operator, criteria.target),
        currentProgress: progress,
        targetProgress: criteria.target,
      };
    }

    const currentCount = await this.countMatchingEvents(userId, criteria);
    const matched = this.compare(
      currentCount,
      criteria.operator,
      criteria.target,
    );

    return {
      matched,
      currentProgress: currentCount,
      targetProgress: criteria.target,
    };
  }

  async calculateProgress(
    userId: string,
    achievement: achievements,
  ): Promise<ProgressResult> {
    const criteria = achievement.criteria as unknown as ThresholdCriteria;
    const current = await this.countMatchingEvents(userId, criteria);
    const target = criteria.target;
    const percentage = Math.min(100, Math.round((current / target) * 100));

    return { current, target, percentage };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async countMatchingEvents(
    userId: string,
    criteria: ThresholdCriteria,
  ): Promise<number> {
    const events = await this.prisma.achievement_event_log.findMany({
      where: {
        user_id: userId,
        event_type: criteria.event,
      },
      select: { event_payload: true },
    });

    if (!criteria.filters || Object.keys(criteria.filters).length === 0) {
      return events.length;
    }

    // Apply payload filters
    const filtered = events.filter((e) => {
      const payload = e.event_payload as Record<string, unknown>;
      return Object.entries(criteria.filters!).every(
        ([key, value]) => payload[key] === value,
      );
    });

    return filtered.length;
  }

  private compare(
    current: number,
    operator: 'gte' | 'lte' | 'eq',
    target: number,
  ): boolean {
    switch (operator) {
      case 'gte':
        return current >= target;
      case 'lte':
        return current <= target;
      case 'eq':
        return current === target;
    }
  }
}

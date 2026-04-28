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

interface CollectionCriteria {
  event: string;
  operator: 'distinct_count';
  distinct_field: string;
  target: number;
  filters?: Record<string, unknown>;
}

@Injectable()
export class CollectionHandler implements AchievementHandler, OnModuleInit {
  private readonly logger = new Logger(CollectionHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: HandlerRegistry,
  ) {}

  onModuleInit() {
    this.registry.register('COLLECTION', this);
    this.logger.log('CollectionHandler registered');
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

    if (typeof c.distinct_field !== 'string' || !c.distinct_field) {
      errors.push('distinct_field must be a non-empty string');
    }

    if (
      typeof c.target !== 'number' ||
      !Number.isFinite(c.target) ||
      c.target < 1
    ) {
      errors.push('target must be a positive finite number');
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
    _event: { eventType: string; payload: Record<string, unknown> },
  ): Promise<EvaluationResult> {
    const criteria = achievement.criteria as unknown as CollectionCriteria;
    const { distinctValues, count } = await this.collectDistinctValues(
      userId,
      criteria,
    );
    const matched = count >= criteria.target;

    return {
      matched,
      currentProgress: count,
      targetProgress: criteria.target,
      metadata: { collected_items: distinctValues },
    };
  }

  async calculateProgress(
    userId: string,
    achievement: achievements,
  ): Promise<ProgressResult> {
    const criteria = achievement.criteria as unknown as CollectionCriteria;
    const { distinctValues, count } = await this.collectDistinctValues(
      userId,
      criteria,
    );
    const target = criteria.target;
    const percentage = Math.min(100, Math.round((count / target) * 100));

    return {
      current: count,
      target,
      percentage,
      metadata: { collected_items: distinctValues },
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async collectDistinctValues(
    userId: string,
    criteria: CollectionCriteria,
  ): Promise<{ distinctValues: unknown[]; count: number }> {
    const events = await this.prisma.achievement_event_log.findMany({
      where: {
        user_id: userId,
        event_type: criteria.event,
      },
      select: { event_payload: true },
    });

    const distinctSet = new Set<unknown>();

    for (const e of events) {
      const payload = e.event_payload as Record<string, unknown>;

      // Apply optional pre-filters
      if (criteria.filters && Object.keys(criteria.filters).length > 0) {
        const passesFilter = Object.entries(criteria.filters).every(
          ([key, value]) => payload[key] === value,
        );
        if (!passesFilter) continue;
      }

      const fieldValue = payload[criteria.distinct_field];
      if (fieldValue !== undefined && fieldValue !== null) {
        distinctSet.add(fieldValue);
      }
    }

    const distinctValues = Array.from(distinctSet);
    return { distinctValues, count: distinctValues.length };
  }
}

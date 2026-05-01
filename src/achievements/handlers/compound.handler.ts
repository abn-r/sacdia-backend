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

interface CompoundCondition {
  event: string;
  operator: 'gte' | 'lte' | 'eq';
  target: number;
  filters?: Record<string, unknown>;
}

interface CompoundCriteria {
  logic: 'AND' | 'OR';
  conditions: CompoundCondition[];
}

interface ConditionStatus {
  event: string;
  current: number;
  target: number;
  completed: boolean;
}

@Injectable()
export class CompoundHandler implements AchievementHandler, OnModuleInit {
  private readonly logger = new Logger(CompoundHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: HandlerRegistry,
  ) {}

  onModuleInit() {
    this.registry.register('COMPOUND', this);
    this.logger.log('CompoundHandler registered');
  }

  validateCriteria(criteria: unknown): ValidationResult {
    const errors: string[] = [];

    if (!criteria || typeof criteria !== 'object') {
      return { valid: false, errors: ['criteria must be an object'] };
    }

    const c = criteria as Record<string, unknown>;

    if (!['AND', 'OR'].includes(c.logic as string)) {
      errors.push('logic must be AND or OR');
    }

    if (!Array.isArray(c.conditions) || c.conditions.length === 0) {
      errors.push('conditions must be a non-empty array');
    } else {
      (c.conditions as unknown[]).forEach((cond, index) => {
        if (!cond || typeof cond !== 'object') {
          errors.push(`conditions[${index}] must be an object`);
          return;
        }
        const condition = cond as Record<string, unknown>;
        if (typeof condition.event !== 'string' || !condition.event) {
          errors.push(`conditions[${index}].event must be a non-empty string`);
        }
        if (!['gte', 'lte', 'eq'].includes(condition.operator as string)) {
          errors.push(
            `conditions[${index}].operator must be one of: gte, lte, eq`,
          );
        }
        if (
          typeof condition.target !== 'number' ||
          !Number.isFinite(condition.target)
        ) {
          errors.push(`conditions[${index}].target must be a finite number`);
        }
      });
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
    const criteria = achievement.criteria as unknown as CompoundCriteria;
    const conditionStatuses = await this.evaluateConditions(
      userId,
      criteria.conditions,
    );

    const allCompleted = conditionStatuses.every((cs) => cs.completed);
    const anyCompleted = conditionStatuses.some((cs) => cs.completed);
    const matched = criteria.logic === 'AND' ? allCompleted : anyCompleted;

    const totalConditions = conditionStatuses.length;
    const completedCount = conditionStatuses.filter(
      (cs) => cs.completed,
    ).length;

    let currentProgress: number;
    let targetProgress: number;

    if (criteria.logic === 'AND') {
      currentProgress = completedCount;
      targetProgress = totalConditions;
    } else {
      // OR: progress reflects the best performing sub-condition as a percentage
      const maxPct = Math.max(
        ...conditionStatuses.map((cs) => Math.min(cs.current / cs.target, 1)),
      );
      currentProgress = Math.round(maxPct * 100);
      targetProgress = 100;
    }

    return {
      matched,
      currentProgress,
      targetProgress,
      metadata: { conditions: conditionStatuses },
    };
  }

  async calculateProgress(
    userId: string,
    achievement: achievements,
  ): Promise<ProgressResult> {
    const criteria = achievement.criteria as unknown as CompoundCriteria;
    const conditionStatuses = await this.evaluateConditions(
      userId,
      criteria.conditions,
    );

    const totalConditions = conditionStatuses.length;
    const completedCount = conditionStatuses.filter(
      (cs) => cs.completed,
    ).length;

    let current: number;
    let target: number;

    if (criteria.logic === 'AND') {
      current = completedCount;
      target = totalConditions;
    } else {
      const maxPct = Math.max(
        ...conditionStatuses.map((cs) => Math.min(cs.current / cs.target, 1)),
      );
      current = Math.round(maxPct * 100);
      target = 100;
    }

    const percentage = Math.min(100, Math.round((current / target) * 100));

    return {
      current,
      target,
      percentage,
      metadata: { conditions: conditionStatuses },
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async evaluateConditions(
    userId: string,
    conditions: CompoundCondition[],
  ): Promise<ConditionStatus[]> {
    return Promise.all(
      conditions.map(async (cond) => {
        const count = await this.countEventsForCondition(userId, cond);
        return {
          event: cond.event,
          current: count,
          target: cond.target,
          completed: this.compare(count, cond.operator, cond.target),
        };
      }),
    );
  }

  private async countEventsForCondition(
    userId: string,
    condition: CompoundCondition,
  ): Promise<number> {
    const events = await this.prisma.achievement_event_log.findMany({
      where: {
        user_id: userId,
        event_type: condition.event,
      },
      select: { event_payload: true },
    });

    if (!condition.filters || Object.keys(condition.filters).length === 0) {
      return events.length;
    }

    return events.filter((e) => {
      const payload = e.event_payload as Record<string, unknown>;
      return Object.entries(condition.filters!).every(
        ([key, value]) => payload[key] === value,
      );
    }).length;
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

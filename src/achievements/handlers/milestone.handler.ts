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

interface MilestoneCriteria {
  event: string;
  field: string;
  operator: 'eq';
  target: string | number;
}

@Injectable()
export class MilestoneHandler implements AchievementHandler, OnModuleInit {
  private readonly logger = new Logger(MilestoneHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: HandlerRegistry,
  ) {}

  onModuleInit() {
    this.registry.register('MILESTONE', this);
    this.logger.log('MilestoneHandler registered');
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

    if (typeof c.field !== 'string' || !c.field) {
      errors.push('field must be a non-empty string');
    }

    if (c.operator !== 'eq') {
      errors.push('operator must be eq');
    }

    if (typeof c.target !== 'string' && typeof c.target !== 'number') {
      errors.push('target must be a string or number');
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
    const criteria = achievement.criteria as unknown as MilestoneCriteria;

    // Check live event payload first — fast path
    if (event.eventType === criteria.event) {
      const fieldValue = event.payload[criteria.field];
      if (fieldValue === criteria.target) {
        return { matched: true, currentProgress: 1, targetProgress: 1 };
      }
    }

    // Fallback: check historical event log for any matching event
    const matched = await this.hasMatchingEvent(userId, criteria);
    return {
      matched,
      currentProgress: matched ? 1 : 0,
      targetProgress: 1,
    };
  }

  async calculateProgress(
    userId: string,
    achievement: achievements,
  ): Promise<ProgressResult> {
    const criteria = achievement.criteria as unknown as MilestoneCriteria;
    const matched = await this.hasMatchingEvent(userId, criteria);

    return {
      current: matched ? 1 : 0,
      target: 1,
      percentage: matched ? 100 : 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async hasMatchingEvent(
    userId: string,
    criteria: MilestoneCriteria,
  ): Promise<boolean> {
    const events = await this.prisma.achievement_event_log.findMany({
      where: {
        user_id: userId,
        event_type: criteria.event,
      },
      select: { event_payload: true },
    });

    return events.some((e) => {
      const payload = e.event_payload as Record<string, unknown>;
      return payload[criteria.field] === criteria.target;
    });
  }
}

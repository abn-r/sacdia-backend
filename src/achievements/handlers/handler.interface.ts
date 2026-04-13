import { achievements } from '@prisma/client';

export interface EvaluationResult {
  matched: boolean;
  currentProgress: number;
  targetProgress: number;
  metadata?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export interface ProgressResult {
  current: number;
  target: number;
  percentage: number;
  metadata?: Record<string, unknown>;
}

export interface AchievementHandler {
  evaluate(
    userId: string,
    achievement: achievements,
    event: { eventType: string; payload: Record<string, unknown> },
  ): Promise<EvaluationResult>;

  validateCriteria(criteria: unknown): ValidationResult;

  calculateProgress(
    userId: string,
    achievement: achievements,
  ): Promise<ProgressResult>;
}

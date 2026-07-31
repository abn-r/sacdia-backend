import { Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuditActor,
  AuditJson,
  CriticalAuditEvent,
  CriticalAuditWriterService,
} from './critical-audit-writer.service';

export type SecurityDenialAuditEvent = {
  entityType: string;
  entityId: string;
  eventKey: string;
  denialCode: ErrorCode;
  actor: AuditActor;
  target: { userId: string | null; scope: AuditJson };
  clubId?: number;
  summary?: string;
  effectiveAt?: Date;
  temporal?: CriticalAuditEvent['temporal'];
  correlationId?: string;
  idempotencyKey?: string;
};

type DenialAuditDatabase = Pick<PrismaService, '$transaction'>;

/**
 * Records policy denials without changing their control flow.  A denial is
 * still the caller's original error even when durable audit infrastructure is
 * unavailable or the fallback logger itself fails.
 */
@Injectable()
export class SecurityDenialAuditService {
  private readonly logger = new Logger(SecurityDenialAuditService.name);

  constructor(
    private readonly prisma: DenialAuditDatabase,
    private readonly criticalAuditWriter: CriticalAuditWriterService,
  ) {}

  async record(event: SecurityDenialAuditEvent): Promise<void> {
    try {
      await this.prisma.$transaction((tx) =>
        this.criticalAuditWriter.write(tx, this.toCriticalEvent(event)),
      );
    } catch (error) {
      this.reportFailure(event, error);
    }
  }

  async preserveDenial(
    originalError: unknown,
    event: SecurityDenialAuditEvent,
  ): Promise<never> {
    await this.record(event);
    throw originalError;
  }

  private toCriticalEvent(event: SecurityDenialAuditEvent): CriticalAuditEvent {
    return {
      entityType: event.entityType,
      entityId: event.entityId,
      action: 'AUTHORIZATION_DENIED',
      eventKey: event.eventKey,
      actor: event.actor,
      target: event.target,
      before: {},
      after: { denial_code: event.denialCode },
      clubId: event.clubId,
      summary: event.summary,
      effectiveAt: event.effectiveAt,
      temporal: event.temporal,
      correlationId: event.correlationId,
      idempotencyKey: event.idempotencyKey,
      result: 'denied',
    };
  }

  private reportFailure(event: SecurityDenialAuditEvent, error: unknown): void {
    try {
      this.logger.error(
        `Failed to audit authorization denial ${event.denialCode} for ${event.entityType}/${event.entityId}`,
        error instanceof Error ? error.stack : String(error),
      );
    } catch {
      // Observability is explicitly best-effort; preserve the original denial.
    }
  }
}

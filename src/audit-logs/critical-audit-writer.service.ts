import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { BusinessDate } from '../common/clock/zoned-business-time.service';
import type { CanonicalGeographicIanaTimezone } from '../common/timezone/canonical-geographic-iana-timezone';

type AuditTransaction = {
  $queryRaw: Prisma.TransactionClient['$queryRaw'];
  audit_logs: Pick<
    Prisma.TransactionClient['audit_logs'],
    'findUnique' | 'create'
  >;
};
type AuditJsonPrimitive = string | number | boolean | null;
export type AuditJsonValue = AuditJsonPrimitive | AuditJson | AuditJsonValue[];
export type AuditJson = { [key: string]: AuditJsonValue };
export type AuditActor =
  | { kind: 'user'; userId: string; roleName: string | null; scope: AuditJson }
  | { kind: 'system'; userId: null; roleName: string | null; scope: AuditJson };

export type CriticalAuditEvent = {
  entityType: string;
  entityId: string;
  action: string;
  eventKey: string;
  actor: AuditActor;
  target: { userId: string | null; scope: AuditJson };
  before: AuditJson;
  after: AuditJson;
  clubId?: number;
  summary?: string;
  effectiveAt?: Date;
  temporal?: {
    businessDate: BusinessDate;
    businessTimezone: CanonicalGeographicIanaTimezone;
  };
  correlationId?: string;
  idempotencyKey?: string;
  result?: 'succeeded' | 'blocked' | 'denied';
};

export type CriticalAuditWrite = { auditLogId: bigint; replayed: boolean };
const storedAuditSelect = {
  audit_log_id: true,
  entity_type: true,
  entity_id: true,
  action: true,
  event_key: true,
  club_id: true,
  summary: true,
  actor_user_id: true,
  actor_kind: true,
  actor_role_name: true,
  actor_scope: true,
  target_user_id: true,
  target_scope: true,
  effective_at: true,
  correlation_id: true,
  idempotency_key: true,
  result: true,
  changes: true,
} satisfies Prisma.audit_logsSelect;
type StoredAuditEvent = Prisma.audit_logsGetPayload<{
  select: typeof storedAuditSelect;
}>;

@Injectable()
export class CriticalAuditWriterService {
  async write(
    tx: AuditTransaction,
    event: CriticalAuditEvent,
  ): Promise<CriticalAuditWrite> {
    const data = this.data(event);
    const expected = this.canonical(this.comparable(data));
    await this.persistence(
      tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`critical-audit:${event.eventKey}`}, 0))`,
      ),
    );
    const existing = await this.persistence(
      tx.audit_logs.findUnique({
        where: { event_key: event.eventKey },
        select: storedAuditSelect,
      }),
    );
    if (existing) {
      if (this.canonical(this.comparable(existing)) !== expected)
        throw this.unavailable();
      return { auditLogId: existing.audit_log_id, replayed: true };
    }

    try {
      const created = await tx.audit_logs.create({ data });
      return { auditLogId: created.audit_log_id, replayed: false };
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError ||
          error instanceof Prisma.PrismaClientUnknownRequestError ||
          error instanceof Prisma.PrismaClientInitializationError ||
          error instanceof Prisma.PrismaClientRustPanicError
        )
          throw this.unavailable();
        throw error;
      }
      const winner = await this.persistence(
        tx.audit_logs.findUnique({
          where: { event_key: event.eventKey },
          select: storedAuditSelect,
        }),
      );
      if (!winner || this.canonical(this.comparable(winner)) !== expected)
        throw this.unavailable();
      return { auditLogId: winner.audit_log_id, replayed: true };
    }
  }

  private data(event: CriticalAuditEvent): Prisma.audit_logsCreateArgs['data'] {
    return {
      entity_type: event.entityType,
      entity_id: event.entityId,
      action: event.action,
      event_key: event.eventKey,
      club_id: event.clubId ?? null,
      summary: event.summary ?? null,
      actor_user_id: event.actor.userId,
      actor_kind: event.actor.kind,
      actor_role_name: event.actor.roleName,
      actor_scope: event.actor.scope as Prisma.InputJsonValue,
      target_user_id: event.target.userId,
      target_scope: event.target.scope as Prisma.InputJsonValue,
      effective_at: event.effectiveAt ?? null,
      correlation_id: event.correlationId ?? null,
      idempotency_key: event.idempotencyKey ?? null,
      result: event.result ?? 'succeeded',
      changes: {
        before: event.before,
        after: event.after,
        ...(event.temporal === undefined
          ? {}
          : {
              temporal: {
                business_date: event.temporal.businessDate,
                business_timezone: event.temporal.businessTimezone,
              },
            }),
      } as Prisma.InputJsonValue,
    };
  }

  private comparable(
    value: StoredAuditEvent | Prisma.audit_logsCreateArgs['data'],
  ): Record<string, unknown> {
    const {
      audit_log_id: _auditLogId,
      effective_at,
      ...rest
    } = value as StoredAuditEvent;
    if (effective_at !== null && !(effective_at instanceof Date))
      throw new TypeError('Audit effective_at must be a Date');
    return {
      ...rest,
      effective_at: effective_at?.toISOString() ?? null,
    };
  }

  private canonical(value: unknown): string {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1)
        if (!Object.hasOwn(value, index))
          throw new TypeError('Audit arrays cannot contain holes');
      return `[${value.map((item) => this.canonical(item)).join(',')}]`;
    }
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime()))
        throw new TypeError('Audit Date values must be valid');
      return JSON.stringify(value.toISOString());
    }
    if (value !== null && typeof value === 'object') {
      if (Object.getPrototypeOf(value) !== Object.prototype)
        throw new TypeError('Audit values must be JSON-compatible');
      return `{${Object.keys(value)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${this.canonical((value as Record<string, unknown>)[key])}`,
        )
        .join(',')}}`;
    }
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      return JSON.stringify(value);
    throw new TypeError('Audit values must be JSON-compatible');
  }

  private async persistence<T>(operation: Promise<T>): Promise<T> {
    try {
      return await operation;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError ||
        error instanceof Prisma.PrismaClientRustPanicError
      )
        throw this.unavailable();
      throw error;
    }
  }

  private unavailable(): AppException {
    return new AppException(
      ErrorCode.AUDIT_WRITE_FAILED,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

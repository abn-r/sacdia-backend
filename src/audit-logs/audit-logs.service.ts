import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppNotFoundException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  getAuditCorrelationId,
  markExplicitAuditRecorded,
} from './audit-request-context';

export interface RecordEventDto {
  entity_type: string;
  entity_id: string;
  action: 'CREATED' | 'UPDATED' | 'DELETED' | (string & {});
  club_id?: number;
  actor_user_id?: string;
  summary?: string;
  changes?: Record<string, unknown>;
  result?: 'succeeded' | 'failed';
  /** 'service' (default) for domain events, 'http' for interceptor rows. */
  source?: 'http' | 'service';
  request_context?: Record<string, unknown>;
  /** Defaults to the ambient request correlation id when available. */
  correlation_id?: string;
  actor_kind?: 'user' | 'anonymous' | 'system';
}

export interface AuditLogItem {
  audit_log_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  summary: string | null;
  actor: {
    user_id: string;
    name: string | null;
    paternal_last_name: string | null;
  } | null;
  created_at: string;
}

export interface ListByClubResult {
  items: AuditLogItem[];
  next_cursor: string | null;
}

export interface AdminAuditLogListItem {
  audit_log_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  result: string;
  source: string;
  summary: string | null;
  club_id: number | null;
  correlation_id: string | null;
  actor: AuditLogItem['actor'];
  created_at: string;
}

export interface AdminAuditLogDetail extends AdminAuditLogListItem {
  changes: Record<string, unknown> | null;
  request_context: Record<string, unknown> | null;
}

export interface ListAdminResult {
  items: AdminAuditLogListItem[];
  next_cursor: string | null;
}

export type ListAdminOpts = {
  entity_type?: string;
  actor_user_id?: string;
  action?: string;
  result?: string;
  source?: string;
  from?: string;
  to?: string;
  club_id?: number;
  correlation_id?: string;
  limit?: number;
  cursor?: string;
};

@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fire-and-forget event recorder. Errors are swallowed and logged so
   * callers are never blocked by audit-log failures.
   */
  async recordEvent(dto: RecordEventDto): Promise<void> {
    const source = dto.source ?? 'service';
    // Domain events mark the request context up front (even if the insert
    // fails) so the HTTP interceptor never emits a redundant generic row.
    if (source === 'service') {
      markExplicitAuditRecorded();
    }
    try {
      await this.prisma.audit_logs.create({
        data: {
          entity_type: dto.entity_type,
          entity_id: dto.entity_id,
          action: dto.action,
          club_id: dto.club_id ?? null,
          actor_user_id: dto.actor_user_id ?? null,
          summary: dto.summary ?? null,
          changes:
            dto.changes !== undefined
              ? (dto.changes as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          result: dto.result ?? 'succeeded',
          source,
          request_context:
            dto.request_context !== undefined
              ? (dto.request_context as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          correlation_id: dto.correlation_id ?? getAuditCorrelationId() ?? null,
          actor_kind: dto.actor_kind ?? 'user',
        },
      });
    } catch (err) {
      this.logger.warn(
        `[AuditLogs] Failed to record event ${dto.action} ${dto.entity_type}/${dto.entity_id}: ${String(err)}`,
      );
    }
  }

  /**
   * Returns the audit history for a club, cursor-paginated descending by
   * created_at (newest first). cursor is the audit_log_id of the last seen
   * item (exclusive lower bound when paginating backwards by ID desc).
   */
  async listByClub(
    clubId: number,
    opts: { limit?: number; cursor?: bigint },
  ): Promise<ListByClubResult> {
    const limit = Math.min(opts.limit ?? 50, 100);

    const rows = await this.prisma.audit_logs.findMany({
      where: {
        club_id: clubId,
        ...(opts.cursor !== undefined
          ? { audit_log_id: { lt: opts.cursor } }
          : {}),
      },
      orderBy: { audit_log_id: 'desc' },
      take: limit + 1,
      select: {
        audit_log_id: true,
        entity_type: true,
        entity_id: true,
        action: true,
        summary: true,
        actor_user_id: true,
        created_at: true,
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const usersMap = await this.hydrateActors(
      items.map((r) => r.actor_user_id),
    );

    const result: AuditLogItem[] = items.map((r) => ({
      audit_log_id: r.audit_log_id.toString(),
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      action: r.action,
      summary: r.summary,
      actor: this.toActor(r.actor_user_id, usersMap),
      created_at: r.created_at.toISOString(),
    }));

    const lastItem = items[items.length - 1];
    const next_cursor =
      hasMore && lastItem ? lastItem.audit_log_id.toString() : null;

    return { items: result, next_cursor };
  }

  /**
   * Global audit viewer. No territorial scope — callers must already be
   * authorized as super-admin with `audit:read`. List never returns
   * `changes` or `request_context`.
   */
  async listAdmin(opts: ListAdminOpts = {}): Promise<ListAdminResult> {
    const limit = Math.min(opts.limit ?? 50, 100);
    const cursor =
      opts.cursor !== undefined ? BigInt(opts.cursor) : undefined;

    const createdAt: Prisma.DateTimeFilter = {};
    if (opts.from) createdAt.gte = parseDateBound(opts.from, 'start');
    if (opts.to) createdAt.lte = parseDateBound(opts.to, 'end');

    const rows = await this.prisma.audit_logs.findMany({
      where: {
        ...(opts.entity_type ? { entity_type: opts.entity_type } : {}),
        ...(opts.actor_user_id ? { actor_user_id: opts.actor_user_id } : {}),
        ...(opts.action ? { action: opts.action } : {}),
        ...(opts.result ? { result: opts.result } : {}),
        ...(opts.source ? { source: opts.source } : {}),
        ...(opts.club_id !== undefined ? { club_id: opts.club_id } : {}),
        ...(opts.correlation_id
          ? { correlation_id: opts.correlation_id }
          : {}),
        ...(Object.keys(createdAt).length > 0 ? { created_at: createdAt } : {}),
        ...(cursor !== undefined ? { audit_log_id: { lt: cursor } } : {}),
      },
      orderBy: { audit_log_id: 'desc' },
      take: limit + 1,
      select: {
        audit_log_id: true,
        entity_type: true,
        entity_id: true,
        action: true,
        result: true,
        source: true,
        summary: true,
        club_id: true,
        correlation_id: true,
        actor_user_id: true,
        created_at: true,
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const usersMap = await this.hydrateActors(
      items.map((r) => r.actor_user_id),
    );

    const result: AdminAuditLogListItem[] = items.map((r) => ({
      audit_log_id: r.audit_log_id.toString(),
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      action: r.action,
      result: r.result,
      source: r.source,
      summary: r.summary,
      club_id: r.club_id,
      correlation_id: r.correlation_id,
      actor: this.toActor(r.actor_user_id, usersMap),
      created_at: r.created_at.toISOString(),
    }));

    const lastItem = items[items.length - 1];
    const next_cursor =
      hasMore && lastItem ? lastItem.audit_log_id.toString() : null;

    return { items: result, next_cursor };
  }

  async getById(auditLogId: string): Promise<AdminAuditLogDetail> {
    if (!/^\d+$/.test(auditLogId)) {
      throw new AppNotFoundException(ErrorCode.RECORD_NOT_FOUND);
    }

    const row = await this.prisma.audit_logs.findUnique({
      where: { audit_log_id: BigInt(auditLogId) },
    });

    if (!row) {
      throw new AppNotFoundException(ErrorCode.RECORD_NOT_FOUND);
    }

    const usersMap = await this.hydrateActors([row.actor_user_id]);

    return {
      audit_log_id: row.audit_log_id.toString(),
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      action: row.action,
      result: row.result,
      source: row.source,
      summary: row.summary,
      club_id: row.club_id,
      correlation_id: row.correlation_id,
      actor: this.toActor(row.actor_user_id, usersMap),
      created_at: row.created_at.toISOString(),
      changes: asJsonObject(row.changes),
      request_context: asJsonObject(row.request_context),
    };
  }

  private toActor(
    actorUserId: string | null,
    usersMap: ActorMap,
  ): AuditLogItem['actor'] {
    if (!actorUserId) return null;
    return {
      user_id: actorUserId,
      name: usersMap.get(actorUserId)?.name ?? null,
      paternal_last_name: usersMap.get(actorUserId)?.paternal_last_name ?? null,
    };
  }

  private async hydrateActors(
    actorIds: Array<string | null>,
  ): Promise<ActorMap> {
    const uniqueIds = [
      ...new Set(actorIds.filter((id): id is string => id !== null)),
    ];
    const usersMap: ActorMap = new Map();
    if (uniqueIds.length === 0) return usersMap;

    const users = await this.prisma.users.findMany({
      where: { user_id: { in: uniqueIds } },
      select: { user_id: true, name: true, paternal_last_name: true },
    });
    for (const user of users) {
      usersMap.set(user.user_id, {
        name: user.name ?? null,
        paternal_last_name: user.paternal_last_name ?? null,
      });
    }
    return usersMap;
  }
}

type ActorMap = Map<
  string,
  { name: string | null; paternal_last_name: string | null }
>;

function parseDateBound(value: string, edge: 'start' | 'end'): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(
      edge === 'end' ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`,
    );
  }
  return new Date(value);
}

function asJsonObject(
  value: Prisma.JsonValue | null,
): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

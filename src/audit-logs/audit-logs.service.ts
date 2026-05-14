import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordEventDto {
  entity_type: string;
  entity_id: string;
  action: 'CREATED' | 'UPDATED' | 'DELETED';
  club_id?: number;
  actor_user_id?: string;
  summary?: string;
  changes?: Record<string, unknown>;
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

@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fire-and-forget event recorder. Errors are swallowed and logged so
   * callers are never blocked by audit-log failures.
   */
  async recordEvent(dto: RecordEventDto): Promise<void> {
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

    // Hydrate actor names in parallel (missing users → null)
    const actorIds = [
      ...new Set(
        items
          .map((r) => r.actor_user_id)
          .filter((id): id is string => id !== null),
      ),
    ];

    const usersMap = new Map<
      string,
      { name: string | null; paternal_last_name: string | null }
    >();

    if (actorIds.length > 0) {
      const users = await this.prisma.users.findMany({
        where: { user_id: { in: actorIds } },
        select: { user_id: true, name: true, paternal_last_name: true },
      });
      for (const u of users) {
        usersMap.set(u.user_id, {
          name: u.name ?? null,
          paternal_last_name: u.paternal_last_name ?? null,
        });
      }
    }

    const result: AuditLogItem[] = items.map((r) => ({
      audit_log_id: r.audit_log_id.toString(),
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      action: r.action,
      summary: r.summary,
      actor: r.actor_user_id
        ? {
            user_id: r.actor_user_id,
            name: usersMap.get(r.actor_user_id)?.name ?? null,
            paternal_last_name:
              usersMap.get(r.actor_user_id)?.paternal_last_name ?? null,
          }
        : null,
      created_at: r.created_at.toISOString(),
    }));

    const lastItem = items[items.length - 1];
    const next_cursor =
      hasMore && lastItem ? lastItem.audit_log_id.toString() : null;

    return { items: result, next_cursor };
  }
}

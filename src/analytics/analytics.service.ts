import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  investiture_status_enum,
  investiture_action_enum,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  SlaDashboardDto,
  InvestiturePipelineItemDto,
} from './dto/sla-dashboard.dto';

// ─── Simple in-memory cache (60s TTL) ────────────────────────────────────────
type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

const STATUS_LABELS: Record<string, string> = {
  IN_PROGRESS: 'En progreso',
  SUBMITTED_FOR_VALIDATION: 'Enviado para validación',
  CLUB_APPROVED: 'Aprobado por club',
  COORDINATOR_APPROVED: 'Aprobado por coordinador',
  FIELD_APPROVED: 'Aprobado por campo',
  INVESTIDO: 'Investido',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
};

/** Statuses that mean "still pending in the pipeline" (not terminal) */
const PENDING_STATUSES: investiture_status_enum[] = [
  investiture_status_enum.IN_PROGRESS,
  investiture_status_enum.SUBMITTED_FOR_VALIDATION,
  investiture_status_enum.CLUB_APPROVED,
  investiture_status_enum.COORDINATOR_APPROVED,
  investiture_status_enum.FIELD_APPROVED,
];

/** Statuses that are considered "in review" (submitted but not yet field-approved or invested) */
const IN_REVIEW_STATUSES: investiture_status_enum[] = [
  investiture_status_enum.SUBMITTED_FOR_VALIDATION,
  investiture_status_enum.CLUB_APPROVED,
  investiture_status_enum.COORDINATOR_APPROVED,
];

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly cache = new Map<string, CacheEntry<SlaDashboardDto>>();
  private readonly CACHE_TTL_MS = 60_000;
  private readonly CACHE_EVICTION_THRESHOLD = 50;

  constructor(private readonly prisma: PrismaService) {}

  // ──────────────────────────────────────────────────────────────────────────
  // CACHE HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  private getFromCache(key: string): SlaDashboardDto | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    // Evict all expired entries when the map grows large enough to warrant cleanup
    if (this.cache.size > this.CACHE_EVICTION_THRESHOLD) {
      const now = Date.now();
      for (const [k, v] of this.cache) {
        if (now > v.expiresAt) {
          this.cache.delete(k);
        }
      }
    }
    return entry.data;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────────────────────────────────────

  async getSlaDashboard(
    scopedClubSectionIds?: number[],
  ): Promise<SlaDashboardDto> {
    const cacheKey = scopedClubSectionIds
      ? `sla:sections:${scopedClubSectionIds.sort((a, b) => a - b).join(',')}`
      : 'sla:global';

    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    const result = await this.computeSlaDashboard(scopedClubSectionIds);
    this.cache.set(cacheKey, {
      data: result,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });

    return result;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // COMPUTATION
  // ──────────────────────────────────────────────────────────────────────────

  private async computeSlaDashboard(
    scopedClubSectionIds?: number[],
  ): Promise<SlaDashboardDto> {
    const now = new Date();
    // 90-day window for approval rate and overdue detection
    const cutoff90d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    // 12-week window for throughput chart (week 0 = current incomplete week)
    const cutoff12w = new Date(now.getTime() - 84 * 24 * 60 * 60 * 1000);

    // Build enrollment filter
    const enrollmentUserFilter = scopedClubSectionIds
      ? {
          users: {
            club_role_assignments: {
              some: {
                club_section_id: { in: scopedClubSectionIds },
                active: true,
              },
            },
          },
        }
      : {};

    const [
      pipelineGroups,
      classSectionsPending,
      honorsPending,
      camporeeClubsPending,
      camporeesMembersPending,
      camporeesPaymentsPending,
      timingResult,
      throughputResult,
      approvalRateResult,
      overdueCount,
    ] = await Promise.all([
      // 1. Investiture pipeline by status
      this.prisma.enrollments.groupBy({
        by: ['investiture_status'],
        where: {
          active: true,
          investiture_status: { in: PENDING_STATUSES },
          ...enrollmentUserFilter,
        },
        _count: { enrollment_id: true },
      }),

      // 2a. Class section progress pending validation
      this.prisma.class_section_progress.count({
        where: {
          status: 'PENDING',
          active: true,
          ...(scopedClubSectionIds
            ? {
                enrollments: {
                  users: {
                    club_role_assignments: {
                      some: {
                        club_section_id: { in: scopedClubSectionIds },
                        active: true,
                      },
                    },
                  },
                },
              }
            : {}),
        },
      }),

      // 2b. User honors pending validation
      this.prisma.users_honors.count({
        where: {
          validation_status: 'PENDING_REVIEW',
          active: true,
          ...(scopedClubSectionIds
            ? {
                users: {
                  club_role_assignments: {
                    some: {
                      club_section_id: { in: scopedClubSectionIds },
                      active: true,
                    },
                  },
                },
              }
            : {}),
        },
      }),

      // 3a. Camporee clubs pending approval
      scopedClubSectionIds
        ? Promise.resolve(0)
        : this.prisma.camporee_clubs.count({
            where: {
              status: 'registered',
              active: true,
            },
          }),

      // 3b. Camporee members pending approval
      scopedClubSectionIds
        ? Promise.resolve(0)
        : this.prisma.camporee_members.count({
            where: {
              status: 'registered',
              active: true,
            },
          }),

      // 3c. Camporee payments pending approval
      scopedClubSectionIds
        ? Promise.resolve(0)
        : this.prisma.camporee_payments.count({
            where: {
              status: 'registered',
            },
          }),

      // 4. Timing: avg days per stage using raw SQL for date math
      this.computeTimingMetrics(scopedClubSectionIds),

      // 5. Throughput: 12-week approved/rejected counts
      this.computeThroughput(cutoff12w, scopedClubSectionIds),

      // 6. Approval rate last 90 days
      this.computeApprovalRate(cutoff90d, scopedClubSectionIds),

      // 7. Overdue: enrollments submitted >30 days ago still not field_approved
      this.countOverdue(scopedClubSectionIds),
    ]);

    // ── Build pipeline array ──────────────────────────────────────────────
    const pipelineMap = new Map<string, number>();
    for (const group of pipelineGroups) {
      pipelineMap.set(group.investiture_status, group._count.enrollment_id);
    }

    const pipeline: InvestiturePipelineItemDto[] = PENDING_STATUSES.map(
      (status) => ({
        status,
        label: STATUS_LABELS[status] ?? status,
        count: pipelineMap.get(status) ?? 0,
      }),
    );

    const totalPending = pipeline.reduce((sum, p) => sum + p.count, 0);
    const inReview = IN_REVIEW_STATUSES.reduce(
      (sum, s) => sum + (pipelineMap.get(s) ?? 0),
      0,
    );

    return {
      investiture: {
        total_pending: totalPending,
        in_review: inReview,
        overdue: overdueCount,
        pipeline,
      },
      validation: {
        class_sections_pending: classSectionsPending,
        honors_pending: honorsPending,
        total_pending: classSectionsPending + honorsPending,
      },
      camporee: {
        clubs_pending: camporeeClubsPending,
        members_pending: camporeesMembersPending,
        payments_pending: camporeesPaymentsPending,
      },
      timing: timingResult,
      throughput: throughputResult,
      approval_rate: approvalRateResult,
      computed_at: new Date().toISOString(),
      cached: false,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TIMING METRICS (raw SQL for date arithmetic)
  // ──────────────────────────────────────────────────────────────────────────

  private async computeTimingMetrics(scopedClubSectionIds?: number[]) {
    try {
      if (scopedClubSectionIds?.length === 0) {
        return {
          avg_days_to_submit: null,
          avg_days_club_approval: null,
          avg_days_coordinator_approval: null,
          avg_days_field_approval: null,
          avg_days_total: null,
        };
      }

      // We use the investiture_validation_history table to compute stage durations.
      // LAG() window function measures days between consecutive stage transitions.
      // avg_days_total uses MIN/MAX per enrollment that reached INVESTIDO — not the last stage gap.
      type StageRow = {
        avg_days_to_submit: string | null;
        avg_days_club_approval: string | null;
        avg_days_coordinator_approval: string | null;
        avg_days_field_approval: string | null;
      };

      type TotalRow = {
        avg_days_total: string | null;
      };

      const toNum = (v: string | null) =>
        v != null ? Math.round(parseFloat(v) * 10) / 10 : null;

      if (scopedClubSectionIds !== undefined) {
        const scopedSectionSql = Prisma.join(scopedClubSectionIds);
        const [stageRows, totalRows] = await Promise.all([
          this.prisma.$queryRaw<StageRow[]>`
            WITH scoped_users AS (
              SELECT DISTINCT cra.user_id
              FROM club_role_assignments cra
              WHERE cra.club_section_id IN (${scopedSectionSql})
                AND cra.active = true
            ),
            enrollment_actions AS (
              SELECT
                h.enrollment_id,
                h.action,
                h.created_at,
                LAG(h.created_at) OVER (
                  PARTITION BY h.enrollment_id ORDER BY h.created_at
                ) AS prev_at
              FROM enrollments e
              JOIN scoped_users su ON su.user_id = e.user_id
              JOIN investiture_validation_history h
                ON h.enrollment_id = e.enrollment_id
              WHERE e.active = true
            )
            SELECT
              AVG(CASE WHEN action = 'SUBMITTED'
                       THEN EXTRACT(EPOCH FROM (created_at - prev_at)) / 86400.0 END) AS avg_days_to_submit,
              AVG(CASE WHEN action = 'CLUB_APPROVED'
                       THEN EXTRACT(EPOCH FROM (created_at - prev_at)) / 86400.0 END) AS avg_days_club_approval,
              AVG(CASE WHEN action = 'COORDINATOR_APPROVED'
                       THEN EXTRACT(EPOCH FROM (created_at - prev_at)) / 86400.0 END) AS avg_days_coordinator_approval,
              AVG(CASE WHEN action = 'FIELD_APPROVED'
                       THEN EXTRACT(EPOCH FROM (created_at - prev_at)) / 86400.0 END) AS avg_days_field_approval
            FROM enrollment_actions
            WHERE prev_at IS NOT NULL
          `,
          this.prisma.$queryRaw<TotalRow[]>`
            WITH scoped_users AS (
              SELECT DISTINCT cra.user_id
              FROM club_role_assignments cra
              WHERE cra.club_section_id IN (${scopedSectionSql})
                AND cra.active = true
            ),
            invested AS (
              SELECT DISTINCT h.enrollment_id
              FROM investiture_validation_history h
              WHERE h.action = 'INVESTIDO'
            ),
            enrollment_total AS (
              SELECT
                h.enrollment_id,
                EXTRACT(EPOCH FROM (MAX(h.created_at) - MIN(h.created_at))) / 86400.0 AS total_days
              FROM invested i
              JOIN enrollments e
                ON e.enrollment_id = i.enrollment_id
               AND e.active = true
              JOIN scoped_users su ON su.user_id = e.user_id
              JOIN investiture_validation_history h
                ON h.enrollment_id = i.enrollment_id
              GROUP BY h.enrollment_id
            )
            SELECT AVG(total_days) AS avg_days_total FROM enrollment_total
          `,
        ]);

        const stage = stageRows[0];
        const total = totalRows[0];

        return {
          avg_days_to_submit: toNum(stage?.avg_days_to_submit ?? null),
          avg_days_club_approval: toNum(stage?.avg_days_club_approval ?? null),
          avg_days_coordinator_approval: toNum(
            stage?.avg_days_coordinator_approval ?? null,
          ),
          avg_days_field_approval: toNum(
            stage?.avg_days_field_approval ?? null,
          ),
          avg_days_total: toNum(total?.avg_days_total ?? null),
        };
      }

      // Global path — drive from enrollments (active) / INVESTIDO, not full history scan
      const [stageRows, totalRows] = await Promise.all([
        this.prisma.$queryRaw<StageRow[]>`
          WITH enrollment_actions AS (
            SELECT
              h.enrollment_id,
              h.action,
              h.created_at,
              LAG(h.created_at) OVER (
                PARTITION BY h.enrollment_id ORDER BY h.created_at
              ) AS prev_at
            FROM enrollments e
            JOIN investiture_validation_history h
              ON h.enrollment_id = e.enrollment_id
            WHERE e.active = true
          )
          SELECT
            AVG(CASE WHEN action = 'SUBMITTED'
                     THEN EXTRACT(EPOCH FROM (created_at - prev_at)) / 86400.0 END) AS avg_days_to_submit,
            AVG(CASE WHEN action = 'CLUB_APPROVED'
                     THEN EXTRACT(EPOCH FROM (created_at - prev_at)) / 86400.0 END) AS avg_days_club_approval,
            AVG(CASE WHEN action = 'COORDINATOR_APPROVED'
                     THEN EXTRACT(EPOCH FROM (created_at - prev_at)) / 86400.0 END) AS avg_days_coordinator_approval,
            AVG(CASE WHEN action = 'FIELD_APPROVED'
                     THEN EXTRACT(EPOCH FROM (created_at - prev_at)) / 86400.0 END) AS avg_days_field_approval
          FROM enrollment_actions
          WHERE prev_at IS NOT NULL
        `,
        this.prisma.$queryRaw<TotalRow[]>`
          WITH invested AS (
            SELECT DISTINCT h.enrollment_id
            FROM investiture_validation_history h
            WHERE h.action = 'INVESTIDO'
          ),
          enrollment_total AS (
            SELECT
              h.enrollment_id,
              EXTRACT(EPOCH FROM (MAX(h.created_at) - MIN(h.created_at))) / 86400.0 AS total_days
            FROM invested i
            JOIN enrollments e
              ON e.enrollment_id = i.enrollment_id
             AND e.active = true
            JOIN investiture_validation_history h
              ON h.enrollment_id = i.enrollment_id
            GROUP BY h.enrollment_id
          )
          SELECT AVG(total_days) AS avg_days_total FROM enrollment_total
        `,
      ]);

      const stage = stageRows[0];
      const total = totalRows[0];

      return {
        avg_days_to_submit: toNum(stage?.avg_days_to_submit ?? null),
        avg_days_club_approval: toNum(stage?.avg_days_club_approval ?? null),
        avg_days_coordinator_approval: toNum(
          stage?.avg_days_coordinator_approval ?? null,
        ),
        avg_days_field_approval: toNum(stage?.avg_days_field_approval ?? null),
        avg_days_total: toNum(total?.avg_days_total ?? null),
      };
    } catch (error) {
      this.logger.warn('Timing metrics query failed, returning nulls', error);
      return {
        avg_days_to_submit: null,
        avg_days_club_approval: null,
        avg_days_coordinator_approval: null,
        avg_days_field_approval: null,
        avg_days_total: null,
      };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // THROUGHPUT (12-week time series, raw SQL for date bucketing)
  // ──────────────────────────────────────────────────────────────────────────

  private async computeThroughput(
    since: Date,
    scopedClubSectionIds?: number[],
  ) {
    try {
      if (scopedClubSectionIds?.length === 0) {
        return [];
      }

      type ThroughputRow = {
        week: string;
        approved: string;
        rejected: string;
      };

      let rows: ThroughputRow[];

      if (scopedClubSectionIds !== undefined) {
        const scopedSectionSql = Prisma.join(scopedClubSectionIds);
        rows = await this.prisma.$queryRaw<ThroughputRow[]>`
          SELECT
            TO_CHAR(DATE_TRUNC('week', filtered.created_at), 'IYYY-"W"IW') AS week,
            COUNT(*) FILTER (WHERE filtered.action = 'FIELD_APPROVED') AS approved,
            COUNT(*) FILTER (WHERE filtered.action = 'REJECTED') AS rejected
          FROM (
            SELECT h.created_at, h.action
            FROM investiture_validation_history h
            WHERE h.action IN ('FIELD_APPROVED', 'REJECTED')
              AND h.created_at >= ${since}
              AND EXISTS (
                SELECT 1
                FROM enrollments e
                JOIN club_role_assignments cra ON cra.user_id = e.user_id
                WHERE e.enrollment_id = h.enrollment_id
                  AND e.active = true
                  AND cra.club_section_id IN (${scopedSectionSql})
                  AND cra.active = true
              )
          ) filtered
          GROUP BY DATE_TRUNC('week', filtered.created_at)
          ORDER BY DATE_TRUNC('week', filtered.created_at) ASC
        `;
      } else {
        rows = await this.prisma.$queryRaw<ThroughputRow[]>`
          SELECT
            TO_CHAR(DATE_TRUNC('week', filtered.created_at), 'IYYY-"W"IW') AS week,
            COUNT(*) FILTER (WHERE filtered.action = 'FIELD_APPROVED') AS approved,
            COUNT(*) FILTER (WHERE filtered.action = 'REJECTED') AS rejected
          FROM (
            SELECT h.created_at, h.action
            FROM investiture_validation_history h
            WHERE h.action IN ('FIELD_APPROVED', 'REJECTED')
              AND h.created_at >= ${since}
          ) filtered
          GROUP BY DATE_TRUNC('week', filtered.created_at)
          ORDER BY DATE_TRUNC('week', filtered.created_at) ASC
        `;
      }

      return rows.map((r) => ({
        week: r.week,
        approved: parseInt(r.approved, 10) || 0,
        rejected: parseInt(r.rejected, 10) || 0,
      }));
    } catch (error) {
      this.logger.warn('Throughput query failed, returning empty', error);
      return [];
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // APPROVAL RATE (last 90 days)
  // ──────────────────────────────────────────────────────────────────────────

  private async computeApprovalRate(
    since: Date,
    scopedClubSectionIds?: number[],
  ) {
    try {
      if (scopedClubSectionIds?.length === 0) {
        return { resolved: 0, approved: 0, rate: 0 };
      }

      const [approvedCount, rejectedCount] = await Promise.all([
        this.prisma.investiture_validation_history.count({
          where: {
            action: investiture_action_enum.FIELD_APPROVED,
            created_at: { gte: since },
            ...(scopedClubSectionIds
              ? {
                  enrollments: {
                    users: {
                      club_role_assignments: {
                        some: {
                          active: true,
                          club_section_id: { in: scopedClubSectionIds },
                        },
                      },
                    },
                  },
                }
              : {}),
          },
        }),
        this.prisma.investiture_validation_history.count({
          where: {
            action: investiture_action_enum.REJECTED,
            created_at: { gte: since },
            ...(scopedClubSectionIds
              ? {
                  enrollments: {
                    users: {
                      club_role_assignments: {
                        some: {
                          active: true,
                          club_section_id: { in: scopedClubSectionIds },
                        },
                      },
                    },
                  },
                }
              : {}),
          },
        }),
      ]);

      const resolved = approvedCount + rejectedCount;
      const rate =
        resolved > 0 ? Math.round((approvedCount / resolved) * 1000) / 10 : 0;

      return { resolved, approved: approvedCount, rate };
    } catch (error) {
      this.logger.warn('Approval rate query failed', error);
      return { resolved: 0, approved: 0, rate: 0 };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // OVERDUE DETECTION
  // ──────────────────────────────────────────────────────────────────────────

  private async countOverdue(scopedClubSectionIds?: number[]): Promise<number> {
    try {
      // Overdue = submitted for validation >30 days ago and still not field_approved
      const overdueDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      return await this.prisma.enrollments.count({
        where: {
          active: true,
          investiture_status: { in: IN_REVIEW_STATUSES },
          submitted_at: { lt: overdueDate },
          ...(scopedClubSectionIds
            ? {
                users: {
                  club_role_assignments: {
                    some: {
                      club_section_id: { in: scopedClubSectionIds },
                      active: true,
                    },
                  },
                },
              }
            : {}),
        },
      });
    } catch (error) {
      this.logger.warn('Overdue count query failed', error);
      return 0;
    }
  }
}

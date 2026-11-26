import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DistributedLockService } from '../../../common/services/distributed-lock.service';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import {
  RANKING_RECALCULATION_DISABLED_VALUE,
  RANKING_RECALCULATION_ENABLED_CONFIG_KEY,
} from '../../ranking-recalculation-kill-switch';
import { AnnualRankingConfigService } from '../annual-ranking-config.service';
import {
  AnnualRankingPointsService,
  type AnnualRankingPointsConfig,
} from './annual-ranking-points.service';

const LOCK_TTL_MS = 10 * 60 * 1000;
const SCORING_CONCURRENCY = 5;
const UPSERT_BATCH_SIZE = 100;

export type ProgressSnapshotSkipReason =
  'kill-switch' | 'year-not-found' | 'lock-not-acquired';

export interface ProgressSnapshotRefreshResult {
  yearId: number | null;
  upserted: number;
  deleted: number;
  /** Enrollments whose scoring threw; their previous row is kept. */
  failed: number;
  skipped?: boolean;
  reason?: ProgressSnapshotSkipReason;
}

type EffectiveConfig = AnnualRankingPointsConfig & {
  annual_ranking_config_id: string;
  max_points: number;
};

interface SnapshotRow {
  club_enrollment_id: string;
  club_section_id: number;
  club_id: number;
  club_type_id: number;
  local_field_id: number;
  annual_ranking_config_id: string;
  current_points: number;
  max_points: number;
}

/**
 * Persists the live annual-progress points of every active club section for a
 * year so territory views can count tiers without scoring each section on
 * request. Runs after the nightly club rankings step.
 */
@Injectable()
export class AnnualRankingProgressSnapshotService {
  private readonly logger = new Logger(
    AnnualRankingProgressSnapshotService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly lockService: DistributedLockService,
    private readonly configService: AnnualRankingConfigService,
    private readonly points: AnnualRankingPointsService,
  ) {}

  async refreshYear(yearId?: number): Promise<ProgressSnapshotRefreshResult> {
    const killSwitch = await this.prisma.system_config.findUnique({
      where: { config_key: RANKING_RECALCULATION_ENABLED_CONFIG_KEY },
    });
    if (killSwitch?.config_value === RANKING_RECALCULATION_DISABLED_VALUE) {
      this.logger.warn('Progress snapshot skipped: kill-switch enabled');
      return this.skipped(yearId ?? null, 'kill-switch');
    }

    const year = await this.resolveYear(yearId);
    if (!year) {
      this.logger.warn(
        `Progress snapshot skipped: year ${yearId ?? 'active'} not found`,
      );
      return this.skipped(yearId ?? null, 'year-not-found');
    }

    const lockKey = `rankings:progress-snapshot:${year.year_id}`;
    const acquired = await this.lockService.tryAcquire(lockKey, LOCK_TTL_MS);
    if (!acquired) {
      this.logger.warn(
        `Progress snapshot skipped: lock ${lockKey} held by another run`,
      );
      return this.skipped(year.year_id, 'lock-not-acquired');
    }

    try {
      return await this.run(year);
    } finally {
      await this.lockService.release(lockKey);
    }
  }

  private async run(year: {
    year_id: number;
    start_date: Date | null;
  }): Promise<ProgressSnapshotRefreshResult> {
    const yearId = year.year_id;
    const calendarYear = this.points.calendarYearFromStartDate(year.start_date);

    const enrollments = await this.prisma.club_enrollments.findMany({
      where: {
        ecclesiastical_year_id: yearId,
        club_section: { active: true, clubs: { active: true } },
      },
      select: {
        club_enrollment_id: true,
        club_section: {
          select: {
            club_section_id: true,
            club_type_id: true,
            clubs: {
              select: {
                club_id: true,
                local_field_id: true,
                local_fields: { select: { union_id: true } },
              },
            },
          },
        },
      },
    });

    // Keyed by local field + club type; holds the promise so concurrent
    // sections of the same scope share one lookup.
    const configCache = new Map<string, Promise<EffectiveConfig | null>>();
    const rows: SnapshotRow[] = [];
    const keptEnrollmentIds: string[] = [];
    let failed = 0;

    for (let i = 0; i < enrollments.length; i += SCORING_CONCURRENCY) {
      const chunk = enrollments.slice(i, i + SCORING_CONCURRENCY);
      await Promise.all(
        chunk.map(async (enrollment) => {
          const section = enrollment.club_section;
          const club = section.clubs;
          if (!club) return;

          try {
            const config = await this.getConfig(
              configCache,
              club.local_field_id,
              section.club_type_id,
              yearId,
            );
            if (!config) return;

            const { currentPoints } = await this.points.computePoints(config, {
              clubEnrollmentId: enrollment.club_enrollment_id,
              clubId: club.club_id,
              clubSectionId: section.club_section_id,
              localFieldId: club.local_field_id,
              unionId: club.local_fields?.union_id ?? null,
              ecclesiasticalYearId: yearId,
              calendarYear,
            });

            rows.push({
              club_enrollment_id: enrollment.club_enrollment_id,
              club_section_id: section.club_section_id,
              club_id: club.club_id,
              club_type_id: section.club_type_id,
              local_field_id: club.local_field_id,
              annual_ranking_config_id: config.annual_ranking_config_id,
              current_points: currentPoints,
              max_points: config.max_points,
            });
          } catch (error) {
            failed += 1;
            keptEnrollmentIds.push(enrollment.club_enrollment_id);
            this.logger.error(
              `Progress snapshot failed for enrollment ${enrollment.club_enrollment_id}: ${(error as Error).message}`,
            );
          }
        }),
      );
    }

    const calculatedAt = new Date();
    for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
      await this.prisma.$transaction(
        batch.map((row) => {
          const data = {
            ecclesiastical_year_id: yearId,
            club_section_id: row.club_section_id,
            club_id: row.club_id,
            club_type_id: row.club_type_id,
            local_field_id: row.local_field_id,
            annual_ranking_config_id: row.annual_ranking_config_id,
            current_points: row.current_points,
            max_points: row.max_points,
            calculated_at: calculatedAt,
          };
          return this.prisma.annual_ranking_progress_snapshots.upsert({
            where: { club_enrollment_id: row.club_enrollment_id },
            create: { club_enrollment_id: row.club_enrollment_id, ...data },
            update: data,
          });
        }),
      );
    }

    const keepIds = [
      ...rows.map((row) => row.club_enrollment_id),
      ...keptEnrollmentIds,
    ];
    const { count: deleted } =
      await this.prisma.annual_ranking_progress_snapshots.deleteMany({
        where:
          keepIds.length > 0
            ? {
                ecclesiastical_year_id: yearId,
                club_enrollment_id: { notIn: keepIds },
              }
            : { ecclesiastical_year_id: yearId },
      });

    this.logger.log(
      `Progress snapshot year=${yearId}: upserted=${rows.length} deleted=${deleted} failed=${failed}`,
    );

    return { yearId, upserted: rows.length, deleted, failed };
  }

  private getConfig(
    cache: Map<string, Promise<EffectiveConfig | null>>,
    localFieldId: number,
    clubTypeId: number,
    yearId: number,
  ): Promise<EffectiveConfig | null> {
    const key = `${localFieldId}:${clubTypeId}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = this.configService
        .getByScope({
          localFieldId,
          clubTypeId,
          ecclesiasticalYearId: yearId,
        })
        .then((config) => config as EffectiveConfig)
        .catch((error: unknown) => {
          if (
            error instanceof AppException &&
            error.code === ErrorCode.ANNUAL_RANKING_CONFIG_NOT_FOUND
          ) {
            return null;
          }
          throw error;
        });
      cache.set(key, pending);
    }
    return pending;
  }

  private async resolveYear(
    yearId: number | undefined,
  ): Promise<{ year_id: number; start_date: Date | null } | null> {
    const select = { year_id: true, start_date: true } as const;
    return yearId !== undefined
      ? this.prisma.ecclesiastical_years.findUnique({
          where: { year_id: yearId },
          select,
        })
      : this.prisma.ecclesiastical_years.findFirst({
          where: { active: true },
          orderBy: { start_date: 'desc' },
          select,
        });
  }

  private skipped(
    yearId: number | null,
    reason: ProgressSnapshotSkipReason,
  ): ProgressSnapshotRefreshResult {
    return {
      yearId,
      upserted: 0,
      deleted: 0,
      failed: 0,
      skipped: true,
      reason,
    };
  }
}

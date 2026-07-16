import { Injectable } from '@nestjs/common';
import {
  AppBadRequestException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type {
  OperationsDashboardDto,
  OperationsDashboardQueryDto,
} from './dto/operations-dashboard.dto';
import { mapOperationsDashboard } from './operations-dashboard.mapper';
import { OperationsDashboardRepository } from './operations-dashboard.repository';
import { OperationsDashboardScopeService } from './operations-dashboard-scope.service';
import type {
  EcclesiasticalYearRecord,
  ReportingMonth,
  ResolvedOperationsDashboardScope,
} from './operations-dashboard.types';

type CacheEntry = {
  data: OperationsDashboardDto;
  expiresAt: number;
};

const CACHE_TTL_MS = 60_000;

@Injectable()
export class OperationsDashboardService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly scopeService: OperationsDashboardScopeService,
    private readonly repository: OperationsDashboardRepository,
  ) {}

  async getDashboard(
    actorId: string,
    query: OperationsDashboardQueryDto,
  ): Promise<OperationsDashboardDto> {
    const scope = await this.scopeService.resolve(actorId, {
      divisionId: query.division_id,
      unionId: query.union_id,
      localFieldId: query.local_field_id,
    });
    const ecclesiasticalYear = await this.resolveEcclesiasticalYear(
      query.ecclesiastical_year_id,
    );
    const reportingMonth = this.resolveReportingMonth(
      query,
      ecclesiasticalYear,
      new Date(),
    );
    const cacheKey = this.cacheKey(scope, ecclesiasticalYear, reportingMonth);
    const now = Date.now();
    const cached = this.cache.get(cacheKey);

    if (cached && now < cached.expiresAt) {
      return {
        ...cached.data,
        meta: { ...cached.data.meta, cached: true },
      };
    }
    if (cached) this.cache.delete(cacheKey);

    const includeHonors = ecclesiasticalYear.active;
    const raw = await this.repository.loadSnapshot({
      scope,
      ecclesiasticalYear,
      reportingMonth,
      includeHonors,
    });
    const data = mapOperationsDashboard({
      raw,
      scope,
      ecclesiasticalYear,
      reportingMonth,
      computedAt: new Date(),
      honorsAvailable: includeHonors,
    });

    this.cache.set(cacheKey, {
      data,
      expiresAt: now + CACHE_TTL_MS,
    });

    return data;
  }

  private async resolveEcclesiasticalYear(
    yearId?: number,
  ): Promise<EcclesiasticalYearRecord> {
    const year =
      yearId === undefined
        ? await this.repository.findActiveEcclesiasticalYear()
        : await this.repository.findEcclesiasticalYearById(yearId);

    if (!year) {
      throw new AppNotFoundException(
        ErrorCode.ADMIN_ECCLESIASTICAL_YEAR_NOT_FOUND,
      );
    }
    return year;
  }

  private resolveReportingMonth(
    query: OperationsDashboardQueryDto,
    ecclesiasticalYear: EcclesiasticalYearRecord,
    now: Date,
  ): ReportingMonth | null {
    if (query.report_year !== undefined && query.report_month !== undefined) {
      const requested = {
        year: query.report_year,
        month: query.report_month,
      };
      if (!isReportingMonthWithinYear(requested, ecclesiasticalYear)) {
        throw new AppBadRequestException(
          ErrorCode.ANALYTICS_REPORTING_PERIOD_OUTSIDE_ECCLESIASTICAL_YEAR,
        );
      }
      return requested;
    }

    return resolveLastClosedMonthWithinYear(ecclesiasticalYear, now);
  }

  private cacheKey(
    scope: ResolvedOperationsDashboardScope,
    year: EcclesiasticalYearRecord,
    reportingMonth: ReportingMonth | null,
  ): string {
    return [
      'operations-dashboard',
      scope.level,
      scope.id ?? 'all',
      year.year_id,
      reportingMonth?.year ?? 'none',
      reportingMonth?.month ?? 'none',
    ].join(':');
  }
}

function isReportingMonthWithinYear(
  reportingMonth: ReportingMonth,
  year: EcclesiasticalYearRecord,
): boolean {
  const requestedOrdinal =
    reportingMonth.year * 12 + (reportingMonth.month - 1);
  const startOrdinal =
    year.start_date.getUTCFullYear() * 12 + year.start_date.getUTCMonth();
  const endOrdinal =
    year.end_date.getUTCFullYear() * 12 + year.end_date.getUTCMonth();

  return requestedOrdinal >= startOrdinal && requestedOrdinal <= endOrdinal;
}

export function resolveLastClosedMonthWithinYear(
  year: EcclesiasticalYearRecord,
  now: Date,
): ReportingMonth | null {
  const lastClosedMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  const yearEndMonth = new Date(
    Date.UTC(year.end_date.getUTCFullYear(), year.end_date.getUTCMonth(), 1),
  );
  const yearStartMonth = new Date(
    Date.UTC(
      year.start_date.getUTCFullYear(),
      year.start_date.getUTCMonth(),
      1,
    ),
  );
  const candidate =
    lastClosedMonth.getTime() < yearEndMonth.getTime()
      ? lastClosedMonth
      : yearEndMonth;

  if (candidate.getTime() < yearStartMonth.getTime()) return null;

  return {
    year: candidate.getUTCFullYear(),
    month: candidate.getUTCMonth() + 1,
  };
}

import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ZonedBusinessTimeService } from '../clock/zoned-business-time.service';
import {
  AppConflictException,
  AppNotFoundException,
} from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { CLOCK, type Clock } from '../clock/clock';
import type { CanonicalGeographicIanaTimezone } from '../timezone/canonical-geographic-iana-timezone';

/**
 * Institutional timezone for the ecclesiastical-year calendar.
 * All date comparisons against the `ecclesiastical_years` table use
 * America/Mexico_City per the spec (§4.1).
 */
export const ECCLESIASTICAL_YEAR_TIMEZONE =
  'America/Mexico_City' as CanonicalGeographicIanaTimezone;

export type EcclesiasticalYear = {
  year_id: number;
  start_date: Date;
  end_date: Date;
  active: boolean;
  modified_at: Date | null;
};

export function ecclesiasticalCalendarRevision(
  year: Pick<
    EcclesiasticalYear,
    'year_id' | 'start_date' | 'end_date' | 'modified_at'
  >,
): string {
  const ymd = (value: Date) => value.toISOString().slice(0, 10);
  return `${year.year_id}:${ymd(year.start_date)}:${ymd(year.end_date)}:${year.modified_at?.toISOString() ?? ''}`;
}

/**
 * Shared service for resolving the current ecclesiastical (church) year.
 *
 * Date comparisons are performed in the institutional timezone
 * (`America/Mexico_City`) to correctly handle midnight boundaries and
 * daylight-saving transitions. This mirrors the DB column semantics
 * (`@db.Date` → no time zone stored).
 *
 * Registered in CommonModule (@Global) so every feature module can inject it
 * without importing CommonModule explicitly.
 */
@Injectable()
export class EcclesiasticalYearService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly zonedBusinessTime: ZonedBusinessTimeService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Returns the ecclesiastical year whose date range covers `at` in the
   * institutional timezone.
   *
   * @param at - The instant to check. Defaults to `this.clock.now()`.
   * @throws {AppNotFoundException} `CLASS_ACTIVE_YEAR_NOT_FOUND` when no row covers the date.
   * @throws {AppConflictException} `ECCLESIASTICAL_YEAR_AMBIGUOUS` when more than one row covers it.
   */
  async getCurrentYear(at?: Date): Promise<EcclesiasticalYear> {
    const instant = at ?? this.clock.now();
    const businessDate = this.zonedBusinessTime.businessDate(
      instant,
      ECCLESIASTICAL_YEAR_TIMEZONE,
    );

    const dateParam = new Date(businessDate);

    const years = await this.prisma.ecclesiastical_years.findMany({
      where: {
        start_date: { lte: dateParam },
        end_date: { gte: dateParam },
      },
      select: {
        year_id: true,
        start_date: true,
        end_date: true,
        active: true,
        modified_at: true,
      },
    });

    if (years.length === 0) {
      throw new AppNotFoundException(ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND);
    }

    if (years.length > 1) {
      throw new AppConflictException(ErrorCode.ECCLESIASTICAL_YEAR_AMBIGUOUS);
    }

    return years[0];
  }
}

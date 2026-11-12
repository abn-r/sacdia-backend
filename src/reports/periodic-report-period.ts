import { DEFAULT_AGE_TIMEZONE, calendarDateIn } from '../common/age/age.util';

/**
 * Period maths shared by the quarterly and annual reports.
 *
 * One time zone (`America/Mexico_City`, the project default) defines "today"
 * and the instant a civil day starts. Every range is half-open: `[start, end)`
 * where `end` is the day AFTER the last day, so a timestamp on the last day
 * still counts. DATE columns (assignments, honors, ecclesiastical years) are
 * UTC midnights; timestamptz columns (activities) use the zoned instants.
 */

export const PERIODIC_REPORTS_TIMEZONE = DEFAULT_AGE_TIMEZONE;

const DAY_MS = 24 * 60 * 60 * 1000;

export type YearMonth = { year: number; month: number };

export interface ReportPeriod {
  /** First day, UTC midnight (compare against DATE columns). */
  startDate: Date;
  /** Last day (inclusive), UTC midnight. */
  endDate: Date;
  /** Day after the last day, UTC midnight: exclusive bound for DATE columns. */
  endExclusiveDate: Date;
  /** Local midnight of the first day: inclusive bound for timestamps. */
  startInstant: Date;
  /** Local midnight of the day after the last day: exclusive bound for timestamps. */
  endExclusiveInstant: Date;
  /** Calendar months touched by the period, oldest first. */
  months: YearMonth[];
}

export function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Offset (ms) of `timeZone` from UTC at the instant `at`. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant a civil day starts (00:00) in `timeZone`. */
export function startOfDayInTimeZone(
  year: number,
  month: number,
  day: number,
  timeZone: string = PERIODIC_REPORTS_TIMEZONE,
): Date {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - zoneOffsetMs(new Date(guess), timeZone);
  // A second pass settles days where the offset changes (DST).
  return new Date(guess - zoneOffsetMs(new Date(first), timeZone));
}

/** Today's civil date in the project time zone, as a UTC midnight. */
export function reportsToday(now: Date = new Date()): Date {
  return calendarDateIn(PERIODIC_REPORTS_TIMEZONE, now);
}

function monthsBetween(start: Date, end: Date): YearMonth[] {
  const months: YearMonth[] = [];
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth() + 1;
  const lastKey = end.getUTCFullYear() * 12 + end.getUTCMonth();
  while (year * 12 + (month - 1) <= lastKey) {
    months.push({ year, month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/** Builds the period from its first and last day (UTC-midnight dates, inclusive). */
export function buildReportPeriod(
  startDate: Date,
  endDate: Date,
): ReportPeriod {
  const endExclusiveDate = addDaysUtc(endDate, 1);
  return {
    startDate,
    endDate,
    endExclusiveDate,
    startInstant: startOfDayInTimeZone(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth() + 1,
      startDate.getUTCDate(),
    ),
    endExclusiveInstant: startOfDayInTimeZone(
      endExclusiveDate.getUTCFullYear(),
      endExclusiveDate.getUTCMonth() + 1,
      endExclusiveDate.getUTCDate(),
    ),
    months: monthsBetween(startDate, endDate),
  };
}

export function quarterPeriod(year: number, quarter: number): ReportPeriod {
  return buildReportPeriod(
    new Date(Date.UTC(year, (quarter - 1) * 3, 1)),
    new Date(Date.UTC(year, quarter * 3, 0)),
  );
}

/** The ecclesiastical year (DATE columns, UTC midnights) as a period. */
export function ecclesiasticalYearPeriod(year: {
  start_date: Date;
  end_date: Date;
}): ReportPeriod {
  return buildReportPeriod(year.start_date, year.end_date);
}

/**
 * True when the period ended more than `graceDays` days before `today`
 * (`periodEnd < today - graceDays`): the last monthly report had its window to
 * be submitted and the report can freeze.
 */
export function isPastGrace(
  periodEnd: Date,
  today: Date,
  graceDays: number,
): boolean {
  return periodEnd.getTime() < addDaysUtc(today, -graceDays).getTime();
}

export function quarterOf(date: Date): { year: number; quarter: number } {
  return {
    year: date.getUTCFullYear(),
    quarter: Math.floor(date.getUTCMonth() / 3) + 1,
  };
}

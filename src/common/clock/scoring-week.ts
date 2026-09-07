/**
 * Unit scoring week: Sunday 00:00 → Saturday 23:59 in America/Mexico_City.
 * No cron. The open period is derived from the instant at read/write time.
 *
 * `year` and `week` belong to the Saturday that closes the period so a
 * Saturday meeting stays in that calendar year/month for Member of the Month.
 */

export const SCORING_WEEK_TIMEZONE = 'America/Mexico_City';

export type ScoringWeekPeriod = {
  week: number;
  year: number;
  startDate: string;
  endDate: string;
};

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDate(date: CalendarDate): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

function diffCalendarDays(from: CalendarDate, to: CalendarDate): number {
  const fromUtc = Date.UTC(from.year, from.month - 1, from.day);
  const toUtc = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

function utcWeekday(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function calendarDateInScoringZone(now: Date): CalendarDate & {
  weekday: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SCORING_WEEK_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now);

  const read = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((part) => part.type === type)?.value;
    if (!value) {
      throw new Error(`Scoring week formatter omitted ${type}`);
    }
    return value;
  };

  const weekday = WEEKDAY_INDEX[read('weekday')];
  if (weekday === undefined) {
    throw new Error(`Unexpected weekday token for scoring week`);
  }

  return {
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    weekday,
  };
}

function firstSaturdayOfYear(year: number): CalendarDate {
  const jan1: CalendarDate = { year, month: 1, day: 1 };
  const daysUntilSaturday = (6 - utcWeekday(jan1) + 7) % 7;
  return addCalendarDays(jan1, daysUntilSaturday);
}

function weekNumberForSaturday(saturday: CalendarDate): number {
  const firstSaturday = firstSaturdayOfYear(saturday.year);
  return 1 + diffCalendarDays(firstSaturday, saturday) / 7;
}

export function getScoringWeekPeriod(now = new Date()): ScoringWeekPeriod {
  const today = calendarDateInScoringZone(now);
  const startDate = addCalendarDays(today, -today.weekday);
  const endDate = addCalendarDays(startDate, 6);

  return {
    week: weekNumberForSaturday(endDate),
    year: endDate.year,
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
  };
}

export function getScoringWeekRangeForMonth(
  year: number,
  month: number,
): { startWeek: number; endWeek: number } {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weeks: number[] = [];

  for (let day = 1; day <= lastDay; day++) {
    const date: CalendarDate = { year, month, day };
    if (utcWeekday(date) !== 6) {
      continue;
    }
    weeks.push(weekNumberForSaturday(date));
  }

  if (weeks.length === 0) {
    return { startWeek: 1, endWeek: 52 };
  }

  return {
    startWeek: Math.min(...weeks),
    endWeek: Math.max(...weeks),
  };
}

export const ACTIVITY_SERIES_TIMEZONE = 'America/Mexico_City';
export const ACTIVITY_SERIES_MAX_OCCURRENCES = 366;

export type ActivitySeriesKind = 'interval' | 'weekly';

export type RecurrenceRule = {
  kind: ActivitySeriesKind;
  intervalDays?: number | null;
  weekdays?: number[];
};

export function calendarDateInTimeZone(
  now: Date,
  timeZone = ACTIVITY_SERIES_TIMEZONE,
): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** ISO-8601 weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(dateIso: string): number {
  const utcDay = new Date(`${dateIso}T12:00:00.000Z`).getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

export function addCalendarDays(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function durationDays(
  startIso: string,
  endIso: string | undefined,
): number {
  if (!endIso || endIso <= startIso) {
    return 0;
  }
  const start = new Date(`${startIso}T12:00:00.000Z`).getTime();
  const end = new Date(`${endIso}T12:00:00.000Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

export function addDuration(dateIso: string, days: number): string {
  return days <= 0 ? dateIso : addCalendarDays(dateIso, days);
}

export function toUtcDate(dateIso: string): Date {
  return new Date(`${dateIso}T00:00:00.000Z`);
}

export function isoDateFromDb(value: Date | string): string {
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

export function expandActivitySeriesDates(input: {
  start: string;
  until: string;
  rule: RecurrenceRule;
}): string[] {
  const { start, until, rule } = input;
  if (until < start) {
    return [];
  }

  const dates: string[] = [];

  if (rule.kind === 'interval') {
    const step = rule.intervalDays ?? 0;
    if (!Number.isInteger(step) || step < 1) {
      return [];
    }
    let cursor = start;
    while (cursor <= until) {
      dates.push(cursor);
      if (dates.length > ACTIVITY_SERIES_MAX_OCCURRENCES) {
        return dates;
      }
      cursor = addCalendarDays(cursor, step);
    }
    return dates;
  }

  const weekdays = [...new Set(rule.weekdays ?? [])].filter(
    (day) => Number.isInteger(day) && day >= 1 && day <= 7,
  );
  if (weekdays.length === 0) {
    return [];
  }

  let cursor = start;
  while (cursor <= until) {
    if (weekdays.includes(isoWeekday(cursor))) {
      dates.push(cursor);
      if (dates.length > ACTIVITY_SERIES_MAX_OCCURRENCES) {
        return dates;
      }
    }
    cursor = addCalendarDays(cursor, 1);
  }
  return dates;
}

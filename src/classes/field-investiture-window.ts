import { localCivilStamp } from './field-class-threshold';

export function defaultInvestitureWindow(
  yearStart: string,
  yearEnd: string,
): { start_date: string; end_date: string } | null {
  const startYear = Number(yearStart.slice(0, 4));
  const endYear = Number(yearEnd.slice(0, 4));
  let best: { start_date: string; end_date: string; span: number } | null =
    null;

  for (let year = startYear; year <= endYear; year += 1) {
    const clippedStart = maxDate(`${year}-10-01`, yearStart);
    const clippedEnd = minDate(`${year}-12-20`, yearEnd);
    if (clippedStart > clippedEnd) {
      continue;
    }
    const span = dayNumber(clippedEnd) - dayNumber(clippedStart);
    if (!best || span > best.span) {
      best = { start_date: clippedStart, end_date: clippedEnd, span };
    }
  }

  if (best) {
    return { start_date: best.start_date, end_date: best.end_date };
  }
  return null;
}

export function investitureWindowAllowsOperation(params: {
  now: Date;
  timeZone: string;
  yearStart: string;
  yearEnd: string;
  yearActive: boolean;
  windowStart: string | null;
  windowEnd: string | null;
}): boolean {
  if (!params.yearActive || !params.windowStart || !params.windowEnd) {
    return false;
  }
  const day = localCivilStamp(params.now, params.timeZone).slice(0, 10);
  return (
    day >= params.yearStart &&
    day <= params.yearEnd &&
    day >= params.windowStart &&
    day <= params.windowEnd
  );
}

export function canEditInvestitureWindow(params: {
  roles: string[];
  now: Date;
  timeZone: string;
  yearStart: string;
  yearEnd: string;
  yearActive: boolean;
  editsOwnField: boolean;
  editsByAdminScope: boolean;
}): boolean {
  if (!params.yearActive) {
    return false;
  }
  const day = localCivilStamp(params.now, params.timeZone).slice(0, 10);
  if (day < params.yearStart || day > params.yearEnd) {
    return false;
  }
  const roles = new Set(params.roles.map((role) => role.toLowerCase()));
  if (roles.has('super-admin')) {
    return true;
  }
  if (params.editsByAdminScope && hasAny(roles, ['admin', 'assistant-admin'])) {
    return true;
  }
  if (params.editsOwnField && hasAny(roles, ['director-lf', 'assistant-lf'])) {
    return true;
  }
  return false;
}

export function isCivilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function hasAny(roles: Set<string>, allowed: string[]): boolean {
  return allowed.some((role) => roles.has(role));
}

function maxDate(left: string, right: string): string {
  return left > right ? left : right;
}

function minDate(left: string, right: string): string {
  return left < right ? left : right;
}

function dayNumber(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

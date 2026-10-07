export const DEFAULT_CLASS_THRESHOLD_PERCENT = 80;

const FIELD_EDITOR_ROLES = new Set(['director-lf', 'assistant-lf']);

export function june30InsideYear(
  startDate: string,
  endDate: string,
): string | null {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  for (let year = startYear; year <= endYear; year += 1) {
    const june30 = `${year}-06-30`;
    if (june30 >= startDate && june30 <= endDate) {
      return june30;
    }
  }
  return null;
}

export function localCivilStamp(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return `${pick('year')}-${pick('month')}-${pick('day')}T${pick('hour')}:${pick('minute')}:${pick('second')}`;
}

export function canEditFieldClassThreshold(params: {
  roles: string[];
  now: Date;
  timeZone: string;
  yearStart: string;
  yearEnd: string;
}): boolean {
  const roles = new Set(params.roles.map((role) => role.toLowerCase()));
  const stamp = localCivilStamp(params.now, params.timeZone);
  const insideYear =
    stamp.slice(0, 10) >= params.yearStart &&
    stamp.slice(0, 10) <= params.yearEnd;
  if (!insideYear) {
    return false;
  }
  if (roles.has('super-admin')) {
    return true;
  }
  const deadline = june30InsideYear(params.yearStart, params.yearEnd);
  if (!deadline) {
    return false;
  }
  const fieldEditor = [...roles].some((role) => FIELD_EDITOR_ROLES.has(role));
  return fieldEditor && stamp <= `${deadline}T23:59:59`;
}

export function sectionMeetsThreshold(params: {
  status: string;
  score: number | null | undefined;
  threshold: number;
}): boolean {
  if (params.status === 'REJECTED') {
    return false;
  }
  if (params.status === 'VALIDATED') {
    return true;
  }
  return (params.score ?? 0) >= params.threshold;
}

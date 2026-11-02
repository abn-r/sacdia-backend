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

/**
 * A requirement counts as complete only when a reviewer validated it
 * (decision 2026-11-02). The score is self-reported through the owner's
 * progress PATCH, so a score at or above the field percentage no longer
 * completes a requirement on its own.
 */
export function sectionCountsAsComplete(params: { status: string }): boolean {
  return params.status === 'VALIDATED';
}

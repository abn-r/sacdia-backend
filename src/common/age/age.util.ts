/** Time zone used when a country has no `age_reference_timezone`. */
export const DEFAULT_AGE_TIMEZONE = 'America/Mexico_City';

/**
 * Whole years between `birthday` and `reference`, comparing the UTC calendar
 * date of both. `users.birthday` is `@db.Date` (a UTC-midnight instant), so
 * the UTC getters are the only ones that read the stored calendar date back
 * without drifting with the server time zone.
 *
 * The result is negative when the birthday is after the reference date.
 */
export function ageAt(birthday: Date, reference: Date): number {
  let age = reference.getUTCFullYear() - birthday.getUTCFullYear();
  const monthDiff = reference.getUTCMonth() - birthday.getUTCMonth();
  const dayDiff = reference.getUTCDate() - birthday.getUTCDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }

  return age;
}

/**
 * The calendar date it is right now in `timeZone`, expressed as a UTC-midnight
 * Date so it can be fed straight into {@link ageAt}.
 */
export function calendarDateIn(timeZone: string, at: Date = new Date()): Date {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(at);
  } catch {
    // Unknown IANA name: fall back to the default instead of failing the request.
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_AGE_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(at);
  }

  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);

  return new Date(Date.UTC(read('year'), read('month') - 1, read('day')));
}

/** Age today in the given time zone (the country's reference zone). */
export function ageToday(
  birthday: Date,
  timeZone: string,
  now: Date = new Date(),
): number {
  return ageAt(birthday, calendarDateIn(timeZone, now));
}

/** True when `birthday` is after today's calendar date in `timeZone`. */
export function isBirthdayInFuture(
  birthday: Date,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  return birthday.getTime() > calendarDateIn(timeZone, now).getTime();
}

import { AppBadRequestException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

export const INVESTITURE_REQUEST_TIME_ZONE_FALLBACK = 'America/Mexico_City';

export function normalizeInvestitureTimeZone(
  value: string | null | undefined,
): string {
  const zone = value?.trim() || INVESTITURE_REQUEST_TIME_ZONE_FALLBACK;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(0));
  } catch (error) {
    if (error instanceof AppBadRequestException) {
      throw error;
    }
    throw new AppBadRequestException(
      ErrorCode.INVESTITURE_REQUEST_TIME_ZONE_INVALID,
    );
  }
  return zone;
}

export function localCivilDay(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function investitureRequestYearEnded(input: {
  active: boolean;
  endDate: Date | string | null | undefined;
  now: Date;
  timeZone: string;
}): boolean {
  if (input.active === false) return true;
  if (input.endDate == null || input.endDate === '') return false;
  const end =
    input.endDate instanceof Date
      ? input.endDate.toISOString().slice(0, 10)
      : String(input.endDate).slice(0, 10);
  return localCivilDay(input.now, input.timeZone) > end;
}

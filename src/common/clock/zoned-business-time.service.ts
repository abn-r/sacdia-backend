import { Injectable } from '@nestjs/common';

export type BusinessDate = `${string}-${string}-${string}`;

type DateParts = { year: number; month: number; day: number };

function compareBusinessDates(left: BusinessDate, right: BusinessDate): number {
  return left.localeCompare(right);
}

function parseBusinessDate(value: BusinessDate): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid business date: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar business date: ${value}`);
  }
  return { year, month, day };
}

function formatParts(now: Date, timezone: string): DateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value;
    if (!value) throw new Error(`Timezone formatter omitted ${type}`);
    return Number(value);
  };
  return { year: read('year'), month: read('month'), day: read('day') };
}

function toBusinessDate({ year, month, day }: DateParts): BusinessDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Converts instants and date-only database values through a named IANA zone.
 * It deliberately never uses the process timezone or a fixed UTC offset.
 */
@Injectable()
export class ZonedBusinessTimeService {
  businessDate(now: Date, timezone: string): BusinessDate {
    return toBusinessDate(formatParts(now, timezone));
  }

  startOfBusinessDate(date: BusinessDate, timezone: string): Date {
    const { year, month, day } = parseBusinessDate(date);
    const center = Date.UTC(year, month - 1, day);
    let low = center - 3 * 86_400_000;
    let high = center + 3 * 86_400_000;

    if (
      compareBusinessDates(this.businessDate(new Date(low), timezone), date) >=
      0
    ) {
      throw new Error(`Could not bracket start of ${date} in ${timezone}`);
    }
    if (
      compareBusinessDates(this.businessDate(new Date(high), timezone), date) <=
      0
    ) {
      throw new Error(`Could not bracket end of ${date} in ${timezone}`);
    }

    while (high - low > 1) {
      const middle = low + Math.floor((high - low) / 2);
      if (
        compareBusinessDates(
          this.businessDate(new Date(middle), timezone),
          date,
        ) < 0
      ) {
        low = middle;
      } else {
        high = middle;
      }
    }

    const start = new Date(high);
    if (this.businessDate(start, timezone) !== date) {
      throw new Error(`Business date ${date} does not exist in ${timezone}`);
    }
    return start;
  }

  startOfNextBusinessDate(date: BusinessDate, timezone: string): Date {
    const { year, month, day } = parseBusinessDate(date);
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    return this.startOfBusinessDate(
      toBusinessDate({
        year: next.getUTCFullYear(),
        month: next.getUTCMonth() + 1,
        day: next.getUTCDate(),
      }),
      timezone,
    );
  }
}

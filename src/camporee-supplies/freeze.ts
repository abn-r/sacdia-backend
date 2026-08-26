export type SupplyPlanStatus = 'DRAFT' | 'SUBMITTED';

export const SUPPLY_HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseCutoffMinutes(cutoffHm: string): number {
  const match = SUPPLY_HHMM_PATTERN.exec(cutoffHm.trim());
  if (!match) {
    throw new Error('CAMPOREE_SUPPLIES_CUTOFF_INVALID');
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function zonedParts(
  instant: Date,
  timeZone: string,
): { ymd: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return {
    ymd: `${value('year')}-${value('month')}-${value('day')}`,
    minutes: Number(value('hour')) * 60 + Number(value('minute')),
  };
}

function addUtcDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const utc = Date.UTC(year, month - 1, day + days);
  const shifted = new Date(utc);
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${mm}-${dd}`;
}

export function canClubEditSupplyDate(input: {
  planStatus: SupplyPlanStatus;
  supplyDate: string;
  now: Date;
  timeZone: string;
  cutoffHm: string;
}): boolean {
  if (input.planStatus === 'DRAFT') {
    return true;
  }
  const zone = input.timeZone.trim() || 'America/Mexico_City';
  const { ymd: today, minutes: nowMinutes } = zonedParts(input.now, zone);
  if (input.supplyDate <= today) {
    return false;
  }
  const tomorrow = addUtcDays(today, 1);
  if (input.supplyDate > tomorrow) {
    return true;
  }
  return nowMinutes < parseCutoffMinutes(input.cutoffHm);
}

export function lineTotalCentavos(
  qty: string | number,
  unitCostCentavos: number,
): number {
  const quantity = typeof qty === 'number' ? qty : Number(qty);
  if (!Number.isFinite(quantity) || quantity < 0) {
    return 0;
  }
  return Math.round(quantity * unitCostCentavos);
}

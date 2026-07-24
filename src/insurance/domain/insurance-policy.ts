export type InsurancePurchaseClassification = 'ORDINARY' | 'EXTRAORDINARY';

export interface InsuranceTimelinessInput {
  ordinaryQuantity: number;
  extraordinaryQuantity: number;
}

export interface InsuranceSectionReference {
  main_club_id: number;
}

export interface EventInsuranceValidityConfig {
  validityMode: 'EVENT_DATES';
}

export interface FixedMonthsInsuranceValidityConfig {
  validityMode: 'FIXED_MONTHS';
  startsAt: Date;
  durationMonths: number;
}

export interface InsuranceEventDates {
  startsAt: Date;
  endsAt: Date;
}

export interface InsuranceValidity {
  startsAt: Date;
  endsAt: Date;
}

function toUtcDateOnlyTimestamp(value: Date): number {
  return Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  );
}

function addUtcMonthsClamped(value: Date, months: number): Date {
  const result = new Date(value);
  const originalDay = result.getUTCDate();

  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);

  const lastDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));

  return result;
}

export function classifyInsurancePurchase(
  receiptDate: Date,
  deadline: Date,
): InsurancePurchaseClassification {
  return toUtcDateOnlyTimestamp(receiptDate) <= toUtcDateOnlyTimestamp(deadline)
    ? 'ORDINARY'
    : 'EXTRAORDINARY';
}

export function calculateInsuranceTimelinessScore({
  ordinaryQuantity,
  extraordinaryQuantity,
}: InsuranceTimelinessInput): number {
  const totalQuantity = ordinaryQuantity + extraordinaryQuantity;

  if (totalQuantity === 0) {
    return 0;
  }

  return Math.round((ordinaryQuantity / totalQuantity) * 10000) / 100;
}

export function assertSameClubTransfer(
  source: InsuranceSectionReference,
  destination: InsuranceSectionReference,
): void {
  if (source.main_club_id !== destination.main_club_id) {
    throw new Error(
      'Insurance slots can only be transferred within the same main club',
    );
  }
}

export function resolveInsuranceValidity(
  config: EventInsuranceValidityConfig,
  event: InsuranceEventDates,
): InsuranceValidity;
export function resolveInsuranceValidity(
  config: FixedMonthsInsuranceValidityConfig,
): InsuranceValidity;
export function resolveInsuranceValidity(
  config: EventInsuranceValidityConfig | FixedMonthsInsuranceValidityConfig,
  event?: InsuranceEventDates,
): InsuranceValidity {
  if (config.validityMode === 'EVENT_DATES') {
    if (!event) {
      throw new Error('Event dates are required for event insurance coverage');
    }

    return {
      startsAt: new Date(event.startsAt),
      endsAt: new Date(event.endsAt),
    };
  }

  const startsAt = new Date(config.startsAt);
  const endsAt = addUtcMonthsClamped(config.startsAt, config.durationMonths);

  return { startsAt, endsAt };
}

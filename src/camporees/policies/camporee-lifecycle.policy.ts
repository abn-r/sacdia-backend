import { Inject, Injectable, Optional } from '@nestjs/common';

export type CamporeePhase =
  | 'preparation'
  | 'registration_open'
  | 'registration_closed'
  | 'in_progress'
  | 'finished';

export type ClubRegistrationDisposition =
  | 'not_open_yet'
  | 'open'
  | 'late_approval_required'
  | 'manually_frozen';

export interface CamporeeLifecycleContext {
  startDate: string;
  endDate: string;
  clubRegistrationOpensAt: Date | null;
  clubRegistrationDeadline: Date | null;
  memberRegistrationDeadline: Date | null;
  paymentDeadline: Date | null;
  clubRegistrationClosedAt: Date | null;
  timezone: string;
  timezoneVerifiedAt: Date | null;
}

type LifecycleDates = Pick<
  CamporeeLifecycleContext,
  | 'startDate'
  | 'endDate'
  | 'clubRegistrationOpensAt'
  | 'clubRegistrationDeadline'
  | 'memberRegistrationDeadline'
  | 'paymentDeadline'
  | 'timezone'
>;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OFFSET_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export const CAMPOREE_LIFECYCLE_NOW = Symbol('CAMPOREE_LIFECYCLE_NOW');

@Injectable()
export class CamporeeLifecyclePolicy {
  constructor(
    @Optional()
    @Inject(CAMPOREE_LIFECYCLE_NOW)
    private readonly now: () => Date = () => new Date(),
  ) {}

  resolve(context: CamporeeLifecycleContext): CamporeePhase {
    const now = this.now();
    const localToday = this.localDate(now, context.timezone);

    if (localToday > context.endDate) {
      return 'finished';
    }

    if (localToday >= context.startDate) {
      return 'in_progress';
    }

    if (
      context.clubRegistrationClosedAt ||
      this.resolveClubRegistrationDisposition(context) ===
        'late_approval_required'
    ) {
      return 'registration_closed';
    }

    if (
      context.clubRegistrationOpensAt &&
      now < context.clubRegistrationOpensAt
    ) {
      return 'preparation';
    }

    return 'registration_open';
  }

  resolvePhase(context: CamporeeLifecycleContext): CamporeePhase {
    return this.resolve(context);
  }

  resolveClubRegistrationDisposition(
    context: CamporeeLifecycleContext,
  ): ClubRegistrationDisposition {
    if (context.clubRegistrationClosedAt) {
      return 'manually_frozen';
    }

    const now = this.now();
    if (
      context.clubRegistrationOpensAt &&
      now < context.clubRegistrationOpensAt
    ) {
      return 'not_open_yet';
    }

    if (
      context.clubRegistrationDeadline &&
      now > context.clubRegistrationDeadline
    ) {
      return 'late_approval_required';
    }

    return 'open';
  }

  isClubRegistrationClosed(context: CamporeeLifecycleContext): boolean {
    return this.resolveClubRegistrationDisposition(context) !== 'open';
  }

  isAfterDeadline(deadline: Date | null | undefined): boolean {
    return !!deadline && this.now() > deadline;
  }

  readiness(context: CamporeeLifecycleContext): string[] {
    const blockers: string[] = [];
    if (!context.timezoneVerifiedAt) {
      blockers.push('timezone_unverified');
    }
    return blockers;
  }

  assertDateOnly(value: string): void {
    if (!DATE_ONLY_PATTERN.test(value)) {
      throw new Error('Expected YYYY-MM-DD local calendar date');
    }

    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new Error('Expected a valid YYYY-MM-DD local calendar date');
    }
  }

  assertOffsetTimestamp(value: string): void {
    if (
      !OFFSET_TIMESTAMP_PATTERN.test(value) ||
      Number.isNaN(Date.parse(value))
    ) {
      throw new Error('Expected ISO-8601 timestamp with an explicit offset');
    }
  }

  assertIanaTimezone(value: unknown): void {
    if (typeof value !== 'string') {
      throw new Error('Expected an IANA timezone');
    }

    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    } catch {
      throw new Error('Expected a supported IANA timezone');
    }
  }

  assertDateOrder(context: LifecycleDates): void {
    this.assertDateOnly(context.startDate);
    this.assertDateOnly(context.endDate);
    this.assertIanaTimezone(context.timezone);

    if (context.startDate > context.endDate) {
      throw new Error('start_date must be before or equal to end_date');
    }

    if (
      context.clubRegistrationOpensAt &&
      context.clubRegistrationDeadline &&
      context.clubRegistrationOpensAt > context.clubRegistrationDeadline
    ) {
      throw new Error(
        'club_registration_opens_at must be before or equal to club_registration_deadline',
      );
    }

    for (const deadline of [
      context.clubRegistrationDeadline,
      context.memberRegistrationDeadline,
      context.paymentDeadline,
    ]) {
      if (
        deadline &&
        this.localDate(deadline, context.timezone) > context.startDate
      ) {
        throw new Error(
          'Deadlines must not be after start_date in the camporee timezone',
        );
      }
    }
  }

  private localDate(value: Date, timezone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value;

    return `${part('year')}-${part('month')}-${part('day')}`;
  }
}

import { Prisma } from '@prisma/client';
import { Client } from 'pg';
import { LocalFieldTimezoneResolver } from './local-field-timezone.resolver';
import { TestingClock } from '../clock/testing-clock';
import { TemporalContextFactory } from '../clock/temporal-context.factory';
import {
  type BusinessDate,
  ZonedBusinessTimeService,
} from '../clock/zoned-business-time.service';
import {
  CLUB_ASSIGNMENT_NON_AUTHORITY_ALLOWLIST,
  ClubAssignmentEffectivityPolicy,
  type ClubAssignmentTemporalRecord,
} from './club-assignment-effectivity.policy';

const now = new Date('2026-01-01T07:30:00.000Z');
const zonedTime = new ZonedBusinessTimeService();
const timezoneResolver = new LocalFieldTimezoneResolver({} as never);
const contextFactory = new TemporalContextFactory(
  new TestingClock(now),
  zonedTime,
);
const policy = new ClubAssignmentEffectivityPolicy(zonedTime);
const businessDate = (value: string) => value as BusinessDate;
const context = (timezone: string) =>
  contextFactory.forLocalField({
    local_field_id: 7,
    timezone: timezoneResolver.assertTimezone(timezone),
  });
const base: ClubAssignmentTemporalRecord = {
  active: true,
  status: 'active',
  start_date: '2025-01-01',
  end_date: null,
  expires_at: null,
};
const cases = [
  ['open', 'America/Tijuana', {}, true],
  ['start today', 'America/Cancun', { start_date: '2026-01-01' }, true],
  ['end today', 'America/Cancun', { end_date: '2026-01-01' }, true],
  ['future', 'America/Tijuana', { start_date: '2026-01-01' }, false],
  ['ended', 'America/Cancun', { end_date: '2025-12-31' }, false],
  ['expires exact', 'America/Cancun', { expires_at: now }, false],
  ['inactive', 'America/Cancun', { active: false }, false],
  ['revoked', 'America/Cancun', { status: 'revoked' }, false],
] as const;

function dateOnly(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString().slice(0, 10);
}

function matchesPrisma(
  row: ClubAssignmentTemporalRecord,
  where: Prisma.club_role_assignmentsWhereInput,
): boolean {
  const clauses = where.AND as Prisma.club_role_assignmentsWhereInput[];
  const end = clauses[0].OR as Prisma.club_role_assignmentsWhereInput[];
  const expiry = clauses[1].OR as Prisma.club_role_assignmentsWhereInput[];
  return (
    row.active === where.active &&
    row.status === where.status &&
    dateOnly(row.start_date) <=
      dateOnly((where.start_date as Prisma.DateTimeFilter).lte as Date) &&
    (row.end_date === null ||
      dateOnly(row.end_date) >=
        dateOnly(
          (end[1].end_date as Prisma.DateTimeNullableFilter).gte as Date,
        )) &&
    (row.expires_at === null ||
      row.expires_at >
        ((expiry[1].expires_at as Prisma.DateTimeNullableFilter).gt as Date))
  );
}

describe('ClubAssignmentEffectivityPolicy', () => {
  it.each(cases)(
    '%s has memory/Prisma parity',
    (_name, zone, patch, expected) => {
      const row = { ...base, ...patch };
      const temporalContext = context(zone);

      expect(policy.isEffective(row, temporalContext)).toBe(expected);
      expect(matchesPrisma(row, policy.toPrismaWhere(temporalContext))).toBe(
        expected,
      );
    },
  );

  it.each([
    ['America/Tijuana', '2026-03-09T07:00:00.000Z'],
    ['America/Cancun', '2026-03-09T05:00:00.000Z'],
  ])('uses the real next local boundary in %s', (zone, expected) => {
    const temporalContext = new TemporalContextFactory(
      new TestingClock(new Date('2026-03-08T12:00:00.000Z')),
      zonedTime,
    ).forLocalField({
      local_field_id: 7,
      timezone: timezoneResolver.assertTimezone(zone),
    });

    expect(
      policy
        .nextBoundary(
          { ...base, end_date: temporalContext.businessDate },
          temporalContext,
        )
        ?.toISOString(),
    ).toBe(expected);
  });

  it('uses expires_at when it is the earliest future boundary', () => {
    const expiresAt = new Date('2026-01-01T08:00:00.000Z');
    expect(
      policy.nextBoundary(
        { ...base, end_date: '2026-01-01', expires_at: expiresAt },
        context('America/Cancun'),
      ),
    ).toEqual(expiresAt);
  });

  it.each([
    [
      { ...base, start_date: businessDate('2026-01-01') },
      '2026-01-01T08:00:00.000Z',
    ],
    [{ ...base, end_date: businessDate('2026-02-01'), expires_at: now }, null],
    [{ ...base, active: false, end_date: businessDate('2026-02-01') }, null],
    [
      {
        ...base,
        start_date: businessDate('2026-01-02'),
        expires_at: new Date('2026-01-01T08:00:00.000Z'),
      },
      null,
    ],
    [
      {
        ...base,
        start_date: businessDate('2026-01-02'),
        end_date: businessDate('2026-01-01'),
      },
      null,
    ],
  ])('returns only boundaries that can change authority', (row, expected) => {
    expect(
      policy.nextBoundary(row, context('America/Tijuana'))?.toISOString() ??
        null,
    ).toBe(expected);
  });

  it('names workflow/history intents as non-authority only', () => {
    expect(CLUB_ASSIGNMENT_NON_AUTHORITY_ALLOWLIST).toEqual({
      workflowWhere: { grantsAuthority: false },
      historicalWhere: { grantsAuthority: false },
    });
  });
});

const databaseUrl = process.env.EFFECTIVITY_POLICY_TEST_DATABASE_URL;
const pgIt = databaseUrl ? it : it.skip;
pgIt('has SQL parity against PostgreSQL', async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const [_name, zone, patch, expected] of cases) {
      const row = { ...base, ...patch };
      const fragment = policy.toSql(context(zone));
      const query = Prisma.sql`
        SELECT (${fragment}) AS effective
        FROM (VALUES (
          ${row.active}::boolean, ${row.status}::text,
          ${dateOnly(row.start_date)}::date,
          ${row.end_date ? dateOnly(row.end_date) : null}::date,
          ${row.expires_at}::timestamptz
        )) AS assignment(active, status, start_date, end_date, expires_at)`;
      const result = await client.query<{ effective: boolean }>(
        query.text,
        query.values,
      );
      expect(result.rows[0].effective).toBe(expected);
    }
  } finally {
    await client.end();
  }
});

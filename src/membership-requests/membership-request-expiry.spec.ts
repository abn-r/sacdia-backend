import {
  DEFAULT_PENDING_TIMEOUT_DAYS,
  effectiveMembershipExpiry,
  isMembershipRequestExpired,
  parsePendingTimeoutDays,
} from './membership-request-expiry';

const created = new Date('2026-10-01T00:00:00.000Z');
const day = (n: number) => new Date(created.getTime() + n * 86_400_000);

describe('membership request expiry rule', () => {
  it('adult: base timeout from creation', () => {
    expect(
      effectiveMembershipExpiry({
        createdAt: created,
        timeoutDays: 8,
        consent: undefined,
      }),
    ).toEqual(day(8));
  });

  it('unverified minor: max(base, 30) days from creation, even with a larger base', () => {
    const consent = { verifiedAt: null };
    expect(
      effectiveMembershipExpiry({
        createdAt: created,
        timeoutDays: 8,
        consent,
      }),
    ).toEqual(day(30));
    expect(
      effectiveMembershipExpiry({
        createdAt: created,
        timeoutDays: 45,
        consent,
      }),
    ).toEqual(day(45));
  });

  it('verified minor: base timeout from max(created_at, verified_at)', () => {
    expect(
      effectiveMembershipExpiry({
        createdAt: created,
        timeoutDays: 8,
        consent: { verifiedAt: day(20) },
      }),
    ).toEqual(day(28));
    expect(
      effectiveMembershipExpiry({
        createdAt: created,
        timeoutDays: 8,
        consent: { verifiedAt: day(-3) },
      }),
    ).toEqual(day(8));
  });

  it('is expired only strictly after the effective instant', () => {
    const input = { createdAt: created, timeoutDays: 8, consent: undefined };
    expect(isMembershipRequestExpired(input, day(8))).toBe(false);
    expect(
      isMembershipRequestExpired(input, new Date(day(8).getTime() + 1)),
    ).toBe(true);
  });

  it('parses the system_config value and falls back to the default on garbage', () => {
    expect(parsePendingTimeoutDays('12')).toBe(12);
    expect(parsePendingTimeoutDays(undefined)).toBe(
      DEFAULT_PENDING_TIMEOUT_DAYS,
    );
    expect(parsePendingTimeoutDays('abc')).toBe(DEFAULT_PENDING_TIMEOUT_DAYS);
  });
});

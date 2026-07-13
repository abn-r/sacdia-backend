import {
  CamporeeLifecyclePolicy,
  type CamporeeLifecycleContext,
} from './camporee-lifecycle.policy';

describe('CamporeeLifecyclePolicy', () => {
  const context: CamporeeLifecycleContext = {
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    clubRegistrationOpensAt: new Date('2026-07-01T15:00:00.000Z'),
    clubRegistrationDeadline: new Date('2026-07-09T23:59:59.000Z'),
    memberRegistrationDeadline: new Date('2026-07-09T23:59:59.000Z'),
    paymentDeadline: new Date('2026-07-09T23:59:59.000Z'),
    clubRegistrationClosedAt: null,
    timezone: 'America/Mexico_City',
    timezoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const resolveAt = (
    now: string,
    overrides: Partial<CamporeeLifecycleContext> = {},
  ) =>
    new CamporeeLifecyclePolicy(() => new Date(now)).resolve({
      ...context,
      ...overrides,
    });

  const dispositionAt = (
    now: string,
    overrides: Partial<CamporeeLifecycleContext> = {},
  ) =>
    new CamporeeLifecyclePolicy(
      () => new Date(now),
    ).resolveClubRegistrationDisposition({
      ...context,
      ...overrides,
    });

  it('resolves preparation before club registration opens', () => {
    expect(resolveAt('2026-07-01T14:59:59.999Z')).toBe('preparation');
  });

  it('opens registration at the exact opening instant', () => {
    expect(resolveAt('2026-07-01T15:00:00.000Z')).toBe('registration_open');
  });

  it('keeps registration open at the exact deadline instant', () => {
    expect(resolveAt('2026-07-09T23:59:59.000Z')).toBe('registration_open');
  });

  it('closes registration only after the deadline', () => {
    expect(resolveAt('2026-07-09T23:59:59.001Z')).toBe('registration_closed');
  });

  it('prioritizes the local calendar phase while the camporee is in progress', () => {
    expect(resolveAt('2026-07-10T06:00:00.000Z')).toBe('in_progress');
  });

  it('resolves finished after the end date in the camporee timezone', () => {
    expect(resolveAt('2026-07-13T06:00:00.000Z')).toBe('finished');
  });

  it('keeps the local calendar phase across the 2026 New York DST spring jump', () => {
    const dstContext = {
      ...context,
      startDate: '2026-03-08',
      endDate: '2026-03-08',
      timezone: 'America/New_York',
    };
    expect(resolveAt('2026-03-08T06:59:59.000Z', dstContext)).toBe(
      'in_progress',
    );
    expect(resolveAt('2026-03-08T07:00:00.000Z', dstContext)).toBe(
      'in_progress',
    );
  });

  it('keeps a manual close ahead of every other registration disposition', () => {
    expect(
      dispositionAt('2026-07-01T14:00:00.000Z', {
        clubRegistrationClosedAt: new Date('2026-06-30T00:00:00.000Z'),
      }),
    ).toBe('manually_frozen');
  });

  it('blocks normal and late registration before opening', () => {
    expect(dispositionAt('2026-07-01T14:59:59.999Z')).toBe('not_open_yet');
  });

  it('requires late approval only after the club deadline', () => {
    expect(dispositionAt('2026-07-09T23:59:59.000Z')).toBe('open');
    expect(dispositionAt('2026-07-09T23:59:59.001Z')).toBe(
      'late_approval_required',
    );
  });

  it('opens immediately when club registration opening is null', () => {
    expect(
      dispositionAt('2026-06-01T00:00:00.000Z', {
        clubRegistrationOpensAt: null,
      }),
    ).toBe('open');
  });

  it('treats manual close as closed', () => {
    const policy = new CamporeeLifecyclePolicy(
      () => new Date('2026-07-01T00:00:00.000Z'),
    );
    expect(
      policy.isClubRegistrationClosed({
        ...context,
        clubRegistrationClosedAt: new Date('2026-06-30T00:00:00.000Z'),
      }),
    ).toBe(true);
  });

  it('rejects timestamps where a local calendar date is required', () => {
    const policy = new CamporeeLifecyclePolicy();
    expect(() => policy.assertDateOnly('2026-07-09T00:00:00Z')).toThrow();
    expect(() => policy.assertDateOnly('2026-02-30')).toThrow();
  });

  it('requires explicit offsets for timestamp deadlines', () => {
    const policy = new CamporeeLifecyclePolicy();
    expect(() => policy.assertOffsetTimestamp('2026-07-09')).toThrow();
    expect(() => policy.assertOffsetTimestamp('2026-07-09T12:00:00')).toThrow();
    expect(() =>
      policy.assertOffsetTimestamp('2026-07-09T12:00:00Z'),
    ).not.toThrow();
  });

  it('rejects non-IANA timezones', () => {
    expect(() =>
      new CamporeeLifecyclePolicy().assertIanaTimezone('GMT-6'),
    ).toThrow();
  });

  it('accepts the IANA UTC special zone', () => {
    expect(() =>
      new CamporeeLifecyclePolicy().assertIanaTimezone('UTC'),
    ).not.toThrow();
  });

  it('accepts supported IANA zones with signs and hyphenated names', () => {
    const policy = new CamporeeLifecyclePolicy();
    expect(() => policy.assertIanaTimezone('Etc/GMT+5')).not.toThrow();
    expect(() =>
      policy.assertIanaTimezone('America/Port-au-Prince'),
    ).not.toThrow();
  });

  it('treats member and payment deadlines as late only after the exact instant', () => {
    const deadline = new Date('2026-07-09T23:59:59.000Z');
    expect(
      new CamporeeLifecyclePolicy(
        () => new Date('2026-07-09T23:59:59.000Z'),
      ).isAfterDeadline(deadline),
    ).toBe(false);
    expect(
      new CamporeeLifecyclePolicy(
        () => new Date('2026-07-09T23:59:59.001Z'),
      ).isAfterDeadline(deadline),
    ).toBe(true);
  });

  it('validates calendar order and deadline constraints without inventing midnight', () => {
    const policy = new CamporeeLifecyclePolicy();
    expect(() =>
      policy.assertDateOrder({
        ...context,
        startDate: '2026-07-12',
        endDate: '2026-07-10',
      }),
    ).toThrow();
    expect(() =>
      policy.assertDateOrder({
        ...context,
        clubRegistrationOpensAt: new Date('2026-07-10T00:00:00.000Z'),
      }),
    ).toThrow();
  });

  it('reports an unverified timezone as not ready for time-window scoring', () => {
    expect(
      new CamporeeLifecyclePolicy().readiness({
        ...context,
        timezoneVerifiedAt: null,
      }),
    ).toContain('timezone_unverified');
  });
});

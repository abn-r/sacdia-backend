import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { LocalFieldTimezoneResolver } from '../authorization/local-field-timezone.resolver';
import { TestingClock } from './testing-clock';
import { TemporalContextFactory } from './temporal-context.factory';
import { ZonedBusinessTimeService } from './zoned-business-time.service';

type ZoneArgument = Parameters<ZonedBusinessTimeService['businessDate']>[1];
const rawTimezoneIsRejected: string extends ZoneArgument ? false : true = true;
const timezoneResolver = new LocalFieldTimezoneResolver({} as never);
const zone = (value: string) => timezoneResolver.assertTimezone(value);

describe('ZonedBusinessTimeService', () => {
  const service = new ZonedBusinessTimeService();

  it('uses the target local-field zone at one shared instant', () => {
    const now = new Date('2026-01-01T07:30:00.000Z');

    expect(rawTimezoneIsRejected).toBe(true);
    expect(service.businessDate(now, zone('America/Tijuana'))).toBe(
      '2025-12-31',
    );
    expect(service.businessDate(now, zone('America/Cancun'))).toBe(
      '2026-01-01',
    );
    expect(
      service.businessDate(now, zone('America/Argentina/Buenos_Aires')),
    ).toBe('2026-01-01');
  });

  it.each([
    [zone('America/Tijuana'), '2026-03-08', 23],
    [zone('America/Santiago'), '2026-09-06', 23],
    [zone('America/Tijuana'), '2026-11-01', 25],
    [zone('America/Bogota'), '2026-03-08', 24],
    [zone('America/Cancun'), '2026-03-08', 24],
  ])(
    'derives local midnight across DST and non-DST zones: %s',
    (zone, date, hours) => {
      const start = service.startOfBusinessDate(
        date as `${number}-${number}-${number}`,
        zone,
      );
      const next = service.startOfNextBusinessDate(
        date as `${number}-${number}-${number}`,
        zone,
      );

      expect(service.businessDate(start, zone)).toBe(date);
      expect(next.getTime() - start.getTime()).toBe(hours * 3_600_000);
    },
  );

  it('captures one clock instant for the whole temporal context', () => {
    const clock = new TestingClock(new Date('2026-01-01T07:30:00.000Z'));
    const factory = new TemporalContextFactory(clock, service);

    const context = factory.forLocalField({
      local_field_id: 71,
      timezone: zone('America/Tijuana'),
    });

    clock.set(new Date('2026-01-01T08:30:00.000Z'));
    expect(context.now.toISOString()).toBe('2026-01-01T07:30:00.000Z');
    expect(context.businessDate).toBe('2025-12-31');
    expect(context.businessTimeZone).toBe('America/Tijuana');
    expect(context.localFieldId).toBe(71);
  });

  it('clones the TestingClock constructor input', () => {
    const input = new Date('2026-01-01T07:30:00.000Z');
    const clock = new TestingClock(input);

    input.setUTCFullYear(2030);

    expect(clock.now().toISOString()).toBe('2026-01-01T07:30:00.000Z');
  });
});

describe('LocalFieldTimezoneResolver', () => {
  it('resolves section → club → local field and preserves the canonical zone', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      clubs: {
        local_fields: {
          local_field_id: 7,
          active: true,
          timezone: 'America/Cancun',
        },
      },
    });
    const resolver = new LocalFieldTimezoneResolver({
      club_sections: { findUnique },
    } as never);

    await expect(resolver.forClubSection(44)).resolves.toEqual({
      local_field_id: 7,
      active: true,
      timezone: 'America/Cancun',
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { club_section_id: 44 } }),
    );
  });

  it('fails closed with the stable timezone code and reason', () => {
    const resolver = new LocalFieldTimezoneResolver({} as never);

    try {
      resolver.assertTimezone('US/Eastern');
      fail('expected timezone validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).getStatus()).toBe(503);
      expect((error as AppException).code).toBe(
        ErrorCode.LOCAL_FIELD_TIMEZONE_UNAVAILABLE,
      );
      expect((error as AppException).getResponse()).toMatchObject({
        namedArgs: { reason: 'NON_CANONICAL' },
      });
    }
  });
});

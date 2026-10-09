import { ErrorCode } from '../common/errors/error-codes';
import {
  assertClassCertificateHistoricalAge,
  evaluateClassCertificateHistoricalAge,
} from './class-certificate-historical-age';

function year(yearId: number, start: string, end: string) {
  return {
    year_id: yearId,
    start_date: new Date(`${start}T00:00:00.000Z`),
    end_date: new Date(`${end}T00:00:00.000Z`),
    active: false,
  };
}

describe('evaluateClassCertificateHistoricalAge', () => {
  const januaryYears = [
    year(2025, '2025-01-01', '2025-12-31'),
    year(2026, '2026-01-01', '2026-12-31'),
  ];

  it('blocks Amigo 2025 when birth is 2016-01-01 and the minimum is 10', () => {
    expect(() =>
      evaluateClassCertificateHistoricalAge({
        completedAt: '2025-06-01',
        birthday: '2016-01-01',
        minimumAge: 10,
        years: januaryYears,
      }),
    ).toThrow(
      expect.objectContaining({
        code: ErrorCode.CERTIFICATE_IMPORT_AGE_BELOW_MINIMUM,
      }),
    );
  });

  it('allows the same person to accredit Amigo in 2026', () => {
    expect(
      evaluateClassCertificateHistoricalAge({
        completedAt: '2026-03-01',
        birthday: '2016-01-01',
        minimumAge: 10,
        years: januaryYears,
      }),
    ).toMatchObject({ yearId: 2026, age: 10, minimumAge: 10 });
  });

  it('keeps a younger class admissible when historical age meets its minimum', () => {
    expect(
      evaluateClassCertificateHistoricalAge({
        completedAt: '2025-06-01',
        birthday: '2016-01-01',
        minimumAge: 9,
        years: januaryYears,
      }),
    ).toMatchObject({ age: 9, minimumAge: 9 });
  });

  it.each([
    ['2015-12-31', 10],
    ['2016-01-01', 10],
    ['2016-01-02', 9],
  ])('uses the full birth date %s against 2026-01-01', (birthday, age) => {
    const result = () =>
      evaluateClassCertificateHistoricalAge({
        completedAt: '2026-08-01',
        birthday,
        minimumAge: 10,
        years: januaryYears,
      });
    if (age >= 10) {
      expect(result()).toMatchObject({ age });
    } else {
      expect(result).toThrow(
        expect.objectContaining({
          code: ErrorCode.CERTIFICATE_IMPORT_AGE_BELOW_MINIMUM,
        }),
      );
    }
  });

  it('uses a non-January ecclesiastical start, not the calendar year number', () => {
    const years = [year(2025, '2025-09-01', '2026-08-31')];
    expect(
      evaluateClassCertificateHistoricalAge({
        completedAt: '2026-01-15',
        birthday: '2015-09-01',
        minimumAge: 10,
        years,
      }),
    ).toMatchObject({ age: 10 });

    expect(() =>
      evaluateClassCertificateHistoricalAge({
        completedAt: '2026-01-15',
        birthday: '2015-09-02',
        minimumAge: 10,
        years,
      }),
    ).toThrow(
      expect.objectContaining({
        code: ErrorCode.CERTIFICATE_IMPORT_AGE_BELOW_MINIMUM,
      }),
    );
  });

  it('rejects a missing birth date, minimum age, or unequivocal year', () => {
    expect(() =>
      evaluateClassCertificateHistoricalAge({
        completedAt: '2026-01-15',
        birthday: null,
        minimumAge: 10,
        years: januaryYears,
      }),
    ).toThrow(
      expect.objectContaining({
        code: ErrorCode.CERTIFICATE_IMPORT_BIRTHDAY_REQUIRED,
      }),
    );
    expect(() =>
      evaluateClassCertificateHistoricalAge({
        completedAt: '2026-01-15',
        birthday: '2016-01-01',
        minimumAge: null,
        years: januaryYears,
      }),
    ).toThrow(
      expect.objectContaining({
        code: ErrorCode.CERTIFICATE_IMPORT_CLASS_MINIMUM_AGE_REQUIRED,
      }),
    );
    expect(() =>
      evaluateClassCertificateHistoricalAge({
        completedAt: '2026-01-15',
        birthday: '2016-01-01',
        minimumAge: 10,
        years: [],
      }),
    ).toThrow(
      expect.objectContaining({
        code: ErrorCode.CERTIFICATE_IMPORT_YEAR_NOT_FOUND,
      }),
    );
    expect(() =>
      evaluateClassCertificateHistoricalAge({
        completedAt: '2026-06-01',
        birthday: '2016-01-01',
        minimumAge: 10,
        years: [
          year(1, '2026-01-01', '2026-12-31'),
          year(2, '2026-01-01', '2026-12-31'),
        ],
      }),
    ).toThrow(
      expect.objectContaining({
        code: ErrorCode.CERTIFICATE_IMPORT_YEAR_AMBIGUOUS,
      }),
    );
  });
});

describe('assertClassCertificateHistoricalAge locks', () => {
  it('C-1 shares the birthday, class and year rows instead of locking them for update', async () => {
    const queries: string[] = [];
    await assertClassCertificateHistoricalAge(
      {
        $queryRawUnsafe: async (query: string) => {
          queries.push(query);
          return [];
        },
        users: {
          findUnique: async () => ({
            birthday: new Date('1990-01-01T00:00:00.000Z'),
          }),
        },
        classes: {
          findUnique: async () => ({ minimum_age: 10 }),
        },
        ecclesiastical_years: {
          findMany: async () => [
            {
              year_id: 2026,
              start_date: new Date('2026-01-01T00:00:00.000Z'),
              end_date: new Date('2026-12-31T00:00:00.000Z'),
              active: true,
            },
          ],
        },
      },
      {
        userId: 'member-1',
        classId: 4,
        completedAt: '2026-06-01',
      },
    );

    expect(queries.length).toBeGreaterThan(0);
    expect(queries.join('\n')).toContain('FOR SHARE');
    expect(queries.join('\n')).not.toContain('FOR UPDATE');
  });

  it('C1-H2 takes the year advisory before sharing the year row', async () => {
    const order: string[] = [];
    await assertClassCertificateHistoricalAge(
      {
        $executeRaw: async () => {
          order.push('advisory');
          return 1;
        },
        $queryRawUnsafe: async (query: string) => {
          order.push(
            query.includes('ecclesiastical_years') ? 'share-year' : 'share',
          );
          return [];
        },
        users: {
          findUnique: async () => ({
            birthday: new Date('1990-01-01T00:00:00.000Z'),
          }),
        },
        classes: {
          findUnique: async () => ({ minimum_age: 10 }),
        },
        ecclesiastical_years: {
          findMany: async () => [
            {
              year_id: 2026,
              start_date: new Date('2026-01-01T00:00:00.000Z'),
              end_date: new Date('2026-12-31T00:00:00.000Z'),
              active: true,
            },
          ],
        },
      },
      {
        userId: 'member-1',
        classId: 4,
        completedAt: '2026-06-01',
      },
    );

    expect(order.indexOf('advisory')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('advisory')).toBeLessThan(order.indexOf('share-year'));
  });

  it('C1R-N1 does not take a year advisory when the caller already locked the years', async () => {
    const order: string[] = [];
    await assertClassCertificateHistoricalAge(
      {
        $executeRaw: async () => {
          order.push('advisory');
          return 1;
        },
        $queryRawUnsafe: async () => [],
        users: {
          findUnique: async () => ({
            birthday: new Date('1990-01-01T00:00:00.000Z'),
          }),
        },
        classes: {
          findUnique: async () => ({ minimum_age: 10 }),
        },
        ecclesiastical_years: {
          findMany: async () => [
            {
              year_id: 2026,
              start_date: new Date('2026-01-01T00:00:00.000Z'),
              end_date: new Date('2026-12-31T00:00:00.000Z'),
              active: true,
            },
          ],
        },
      },
      {
        userId: 'member-1',
        classId: 4,
        completedAt: '2026-06-01',
      },
      { skipYearAdvisory: true },
    );

    expect(order).not.toContain('advisory');
  });
});

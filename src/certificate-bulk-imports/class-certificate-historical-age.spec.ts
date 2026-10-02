import { ErrorCode } from '../common/errors/error-codes';
import { evaluateClassCertificateHistoricalAge } from './class-certificate-historical-age';

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

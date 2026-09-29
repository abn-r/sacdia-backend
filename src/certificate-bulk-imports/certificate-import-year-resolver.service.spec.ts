import { ZonedBusinessTimeService } from '../common/clock/zoned-business-time.service';
import { ECCLESIASTICAL_YEAR_TIMEZONE } from '../common/services/ecclesiastical-year.service';
import {
  CertificateImportYearResolver,
  classifyCertificateImportYear,
  utcCivilDate,
} from './certificate-import-year-resolver.service';

const INACTIVE_2004 = {
  year_id: 4,
  start_date: new Date('2004-01-01T00:00:00.000Z'),
  end_date: new Date('2004-12-31T00:00:00.000Z'),
  active: false,
};

describe('classifyCertificateImportYear', () => {
  it('reports a missing period without choosing the current year', () => {
    expect(classifyCertificateImportYear('1999-06-01', [INACTIVE_2004])).toEqual(
      {
        status: 'missing',
        code: 'CERTIFICATE_IMPORT_YEAR_NOT_FOUND',
        civilDate: '1999-06-01',
      },
    );
  });

  it('accepts one inactive period', () => {
    expect(classifyCertificateImportYear('2004-06-01', [INACTIVE_2004])).toEqual(
      {
        status: 'resolved',
        yearId: 4,
        active: false,
        civilDate: '2004-06-01',
      },
    );
  });

  it('reports two covering periods instead of picking the first', () => {
    const other = {
      ...INACTIVE_2004,
      year_id: 5,
      active: true,
    };
    expect(classifyCertificateImportYear('2004-06-01', [INACTIVE_2004, other]))
      .toEqual({
        status: 'ambiguous',
        code: 'CERTIFICATE_IMPORT_YEAR_AMBIGUOUS',
        civilDate: '2004-06-01',
        yearIds: [4, 5],
      });
  });

  it('includes both inclusive boundaries and excludes the days outside', () => {
    expect(classifyCertificateImportYear('2004-01-01', [INACTIVE_2004]).status)
      .toBe('resolved');
    expect(classifyCertificateImportYear('2004-12-31', [INACTIVE_2004]).status)
      .toBe('resolved');
    expect(classifyCertificateImportYear('2003-12-31', [INACTIVE_2004]).status)
      .toBe('missing');
    expect(classifyCertificateImportYear('2005-01-01', [INACTIVE_2004]).status)
      .toBe('missing');
  });

  it('keeps the civil date when Mexico City would move UTC midnight to the previous day', () => {
    const zoned = new ZonedBusinessTimeService();
    const utcMidnight = new Date('2004-01-01T00:00:00.000Z');
    expect(
      zoned.businessDate(utcMidnight, ECCLESIASTICAL_YEAR_TIMEZONE),
    ).toBe('2003-12-31');
    expect(classifyCertificateImportYear('2004-01-01', [INACTIVE_2004])).toMatchObject(
      { status: 'resolved', yearId: 4 },
    );
  });
});

describe('CertificateImportYearResolver', () => {
  it('queries the civil UTC date and does not require the period to be active', async () => {
    const findMany = jest.fn().mockResolvedValue([INACTIVE_2004]);
    const resolver = new CertificateImportYearResolver({
      ecclesiastical_years: { findMany },
    } as never);

    const blockers = await resolver.blockersForItems([
      {
        item_id: 'item-1',
        item_type: 'CLASS',
        completed_at: new Date('2004-03-15T00:00:00.000Z'),
      },
    ]);

    expect(findMany).toHaveBeenCalledWith({
      select: {
        year_id: true,
        start_date: true,
        end_date: true,
        active: true,
      },
    });
    expect(utcCivilDate('2004-03-15').toISOString()).toBe(
      '2004-03-15T00:00:00.000Z',
    );
    expect(blockers.get('item-1')).toEqual([]);
  });

  it('keeps a missing period as a row blocker', async () => {
    const resolver = new CertificateImportYearResolver({
      ecclesiastical_years: { findMany: jest.fn().mockResolvedValue([]) },
    } as never);

    const blockers = await resolver.blockersForItems([
      {
        item_id: 'item-1',
        item_type: 'CLASS',
        completed_at: new Date('2004-03-15T00:00:00.000Z'),
      },
    ]);

    expect(blockers.get('item-1')).toEqual([
      { code: 'CERTIFICATE_IMPORT_YEAR_NOT_FOUND' },
    ]);
  });
});

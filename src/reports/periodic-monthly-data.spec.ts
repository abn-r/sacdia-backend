import {
  aggregateMonthlyData,
  type MonthlyManualRow,
  type SubmittedMonthlyReportRow,
} from './periodic-monthly-data';

const manual = (over: Partial<MonthlyManualRow> = {}): MonthlyManualRow => ({
  planning_meetings: 0,
  parent_meetings: 0,
  youth_council_attendance: 0,
  church_board_attendance: 0,
  soul_target: 0,
  baptized_this_month: 0,
  total_baptized: 0,
  club_participation_description: null,
  community_service_description: null,
  certificates_delivered: false,
  ...over,
});

const row = (
  year: number,
  month: number,
  over: Partial<MonthlyManualRow> | null = {},
): SubmittedMonthlyReportRow => ({
  year,
  month,
  manual_data: over === null ? null : manual(over),
});

describe('aggregateMonthlyData', () => {
  it('returns null for every figure when no monthly report was submitted', () => {
    expect(aggregateMonthlyData([])).toEqual({
      months_submitted: 0,
      months_covered: [],
      planning_meetings: null,
      parent_meetings: null,
      youth_council_attendance: null,
      church_board_attendance: null,
      soul_target: null,
      baptized: null,
      total_baptized: null,
      club_participation_description: null,
      community_service_description: null,
      certificates_delivered: null,
    });
  });

  it('sums meetings, attendance and baptisms over the submitted months', () => {
    const data = aggregateMonthlyData([
      row(2026, 4, {
        planning_meetings: 2,
        parent_meetings: 1,
        youth_council_attendance: 3,
        church_board_attendance: 4,
        baptized_this_month: 1,
      }),
      row(2026, 5, {
        planning_meetings: 3,
        parent_meetings: 0,
        youth_council_attendance: 1,
        church_board_attendance: 2,
        baptized_this_month: 2,
      }),
    ]);

    expect(data).toMatchObject({
      months_submitted: 2,
      planning_meetings: 5,
      parent_meetings: 1,
      youth_council_attendance: 4,
      church_board_attendance: 6,
      baptized: 3,
    });
  });

  it('keeps zero (not null) when months were submitted with zero values', () => {
    const data = aggregateMonthlyData([row(2026, 4)]);
    expect(data.planning_meetings).toBe(0);
    expect(data.baptized).toBe(0);
    expect(data.certificates_delivered).toBe(false);
  });

  it('takes soul_target and total_baptized from the LATEST submitted month, whatever the input order', () => {
    const data = aggregateMonthlyData([
      row(2026, 6, { soul_target: 12, total_baptized: 30 }),
      row(2026, 4, { soul_target: 5, total_baptized: 10 }),
      row(2026, 5, { soul_target: 8, total_baptized: 20 }),
    ]);

    expect(data.soul_target).toBe(12);
    expect(data.total_baptized).toBe(30);
  });

  it('adds the sections of the latest month together', () => {
    const data = aggregateMonthlyData([
      row(2026, 5, { soul_target: 4, total_baptized: 7 }),
      row(2026, 6, { soul_target: 3, total_baptized: 5 }),
      row(2026, 6, { soul_target: 2, total_baptized: 1 }),
    ]);

    expect(data.soul_target).toBe(5);
    expect(data.total_baptized).toBe(6);
    // Two sections in June still cover two distinct months.
    expect(data.months_submitted).toBe(2);
    expect(data.months_covered).toEqual([
      { year: 2026, month: 5 },
      { year: 2026, month: 6 },
    ]);
  });

  it('orders months across a year boundary by year first', () => {
    const data = aggregateMonthlyData([
      row(2027, 1, { soul_target: 9 }),
      row(2026, 12, { soul_target: 4 }),
    ]);
    expect(data.soul_target).toBe(9);
    expect(data.months_covered).toEqual([
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
    ]);
  });

  it('certificates_delivered is true when ANY month is true, false when none', () => {
    expect(
      aggregateMonthlyData([
        row(2026, 4, { certificates_delivered: false }),
        row(2026, 5, { certificates_delivered: true }),
      ]).certificates_delivered,
    ).toBe(true);
    expect(
      aggregateMonthlyData([row(2026, 4, { certificates_delivered: false })])
        .certificates_delivered,
    ).toBe(false);
  });

  it('lists each month with non-empty text, trimmed and in month order', () => {
    const data = aggregateMonthlyData([
      row(2026, 5, {
        club_participation_description: '  Campamento  ',
        community_service_description: '   ',
      }),
      row(2026, 4, {
        club_participation_description: 'Feria',
        community_service_description: 'Limpieza',
      }),
      row(2026, 6, { club_participation_description: null }),
    ]);

    expect(data.club_participation_description).toEqual([
      { year: 2026, month: 4, text: 'Feria' },
      { year: 2026, month: 5, text: 'Campamento' },
    ]);
    expect(data.community_service_description).toEqual([
      { year: 2026, month: 4, text: 'Limpieza' },
    ]);
  });

  it('gives an empty list (not null) when months were submitted without text', () => {
    expect(
      aggregateMonthlyData([row(2026, 4)]).club_participation_description,
    ).toEqual([]);
  });

  it('counts a submitted report without manual data as a covered month with no values', () => {
    const data = aggregateMonthlyData([
      row(2026, 4, null),
      row(2026, 5, { planning_meetings: 2, soul_target: 6 }),
    ]);
    expect(data.months_submitted).toBe(2);
    expect(data.planning_meetings).toBe(2);
    expect(data.soul_target).toBe(6);

    const onlyEmpty = aggregateMonthlyData([row(2026, 4, null)]);
    expect(onlyEmpty.months_submitted).toBe(1);
    expect(onlyEmpty.planning_meetings).toBe(0);
    expect(onlyEmpty.soul_target).toBe(0);
  });
});

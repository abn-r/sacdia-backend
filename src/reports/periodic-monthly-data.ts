import type { YearMonth } from './periodic-report-period';

/** One line of narrative text taken from a submitted monthly report. */
export interface MonthlyTextEntry {
  year: number;
  month: number;
  text: string;
}

/** Manual data of one submitted monthly report (null when the row has none). */
export interface MonthlyManualRow {
  planning_meetings: number;
  parent_meetings: number;
  youth_council_attendance: number;
  church_board_attendance: number;
  soul_target: number;
  baptized_this_month: number;
  total_baptized: number;
  club_participation_description: string | null;
  community_service_description: string | null;
  certificates_delivered: boolean;
}

export interface SubmittedMonthlyReportRow {
  year: number;
  month: number;
  manual_data: MonthlyManualRow | null;
}

/**
 * What the quarterly and annual reports read from the SUBMITTED monthly
 * reports of the period. Every value is null when no monthly report of the
 * period was submitted (never 0), so the report shows "—" instead of a false
 * zero.
 */
export interface PeriodicMonthlyAggregate {
  /** Distinct months of the period with at least one submitted report. */
  months_submitted: number;
  /** Those months, oldest first. */
  months_covered: YearMonth[];
  planning_meetings: number | null;
  parent_meetings: number | null;
  youth_council_attendance: number | null;
  church_board_attendance: number | null;
  /** Value of the latest submitted month. */
  soul_target: number | null;
  /** Sum of `baptized_this_month`. */
  baptized: number | null;
  /** Value of the latest submitted month. */
  total_baptized: number | null;
  club_participation_description: MonthlyTextEntry[] | null;
  community_service_description: MonthlyTextEntry[] | null;
  certificates_delivered: boolean | null;
}

const periodKey = (row: YearMonth): number => row.year * 100 + row.month;

function textEntries(
  rows: SubmittedMonthlyReportRow[],
  pick: (manual: MonthlyManualRow) => string | null,
): MonthlyTextEntry[] {
  const entries: MonthlyTextEntry[] = [];
  for (const row of rows) {
    const text = row.manual_data ? pick(row.manual_data)?.trim() : '';
    if (text) entries.push({ year: row.year, month: row.month, text });
  }
  return entries;
}

/**
 * Aggregates the submitted monthly reports of a period (all sections of the
 * club). The caller already filtered by `status = 'submitted'` and by the
 * months of the period.
 */
export function aggregateMonthlyData(
  rows: SubmittedMonthlyReportRow[],
): PeriodicMonthlyAggregate {
  if (rows.length === 0) {
    return {
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
    };
  }

  const sorted = [...rows].sort((a, b) => periodKey(a) - periodKey(b));
  const covered = new Map<number, YearMonth>();
  for (const row of sorted) {
    covered.set(periodKey(row), { year: row.year, month: row.month });
  }

  const withData = sorted.filter(
    (
      row,
    ): row is SubmittedMonthlyReportRow & { manual_data: MonthlyManualRow } =>
      row.manual_data !== null,
  );
  const sum = (pick: (manual: MonthlyManualRow) => number): number =>
    withData.reduce((total, row) => total + pick(row.manual_data), 0);

  // "Latest" = the most recent month with data; sections of that month add up.
  const latestKey = withData.length
    ? periodKey(withData[withData.length - 1])
    : null;
  const latestSum = (pick: (manual: MonthlyManualRow) => number): number =>
    latestKey === null
      ? 0
      : withData
          .filter((row) => periodKey(row) === latestKey)
          .reduce((total, row) => total + pick(row.manual_data), 0);

  return {
    months_submitted: covered.size,
    months_covered: [...covered.values()],
    planning_meetings: sum((m) => m.planning_meetings),
    parent_meetings: sum((m) => m.parent_meetings),
    youth_council_attendance: sum((m) => m.youth_council_attendance),
    church_board_attendance: sum((m) => m.church_board_attendance),
    soul_target: latestSum((m) => m.soul_target),
    baptized: sum((m) => m.baptized_this_month),
    total_baptized: latestSum((m) => m.total_baptized),
    club_participation_description: textEntries(
      sorted,
      (m) => m.club_participation_description,
    ),
    community_service_description: textEntries(
      sorted,
      (m) => m.community_service_description,
    ),
    certificates_delivered: withData.some(
      (row) => row.manual_data.certificates_delivered === true,
    ),
  };
}

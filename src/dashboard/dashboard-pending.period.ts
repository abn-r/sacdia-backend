/**
 * Pure date helpers for the "Pendientes" monthly-report item.
 *
 * Period rule (follows MonthlyReportsService.resolveReminderSchedule: reminder
 * on day 27 of the period month, then days 1/4/5/6 of the next month; the
 * report of month M is due on `dueDay` of month M+1):
 *  - today's day >= 27: the period is the CURRENT month (about to be due,
 *    due next month);
 *  - day 1..26: the period is the PREVIOUS month, due this month. After the
 *    due day it is OVERDUE (negative days_left) and keeps showing until the
 *    report is submitted/approved.
 */
const PERIOD_CLOSING_DAY = 27;

/** Same zone as MONTHLY_REPORT_REMINDER_TIME_ZONE in monthly-reports.service.ts. */
export const PENDING_REPORTS_TIME_ZONE = 'America/Mexico_City';

export interface CalendarDate {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
}

export interface MonthlyReportDue {
  period_month: number;
  period_year: number;
  /** YYYY-MM-DD */
  due_date: string;
  days_left: number;
}

export function calendarDateInZone(
  now: Date,
  timeZone: string = PENDING_REPORTS_TIME_ZONE,
): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(now);
  const read = (type: 'day' | 'month' | 'year'): number =>
    parseInt(parts.find((part) => part.type === type)?.value ?? '', 10);
  return { year: read('year'), month: read('month'), day: read('day') };
}

const pad = (value: number): string => String(value).padStart(2, '0');

export function resolveMonthlyReportDue(
  today: CalendarDate,
  dueDay: number,
): MonthlyReportDue {
  let periodYear = today.year;
  let periodMonth = today.month;
  if (today.day < PERIOD_CLOSING_DAY) {
    periodMonth = today.month === 1 ? 12 : today.month - 1;
    periodYear = today.month === 1 ? today.year - 1 : today.year;
  }
  // Due date: dueDay of the month after the period (Date.UTC rolls the year).
  const due = new Date(Date.UTC(periodYear, periodMonth, dueDay));
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  return {
    period_month: periodMonth,
    period_year: periodYear,
    due_date: `${due.getUTCFullYear()}-${pad(due.getUTCMonth() + 1)}-${pad(due.getUTCDate())}`,
    days_left: Math.round((due.getTime() - todayUtc) / 86_400_000),
  };
}

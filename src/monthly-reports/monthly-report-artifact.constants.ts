export const MONTHLY_REPORT_PDF_TEMPLATE_VERSION =
  'monthly-report-v2-three-page';

export function buildMonthlyReportPdfKey(input: {
  reportId: string;
  enrollmentId: string;
  month: number;
  year: number;
}): string {
  return [
    String(input.year),
    String(input.month).padStart(2, '0'),
    input.enrollmentId,
    `${input.reportId}.pdf`,
  ].join('/');
}

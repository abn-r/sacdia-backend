import { QuarterlyReportsPdfService } from './quarterly-reports-pdf.service';

const countPages = (pdf: Buffer): number =>
  (pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;

function buildService(report: Record<string, unknown>) {
  const prisma = {
    quarterly_reports: { findUnique: jest.fn().mockResolvedValue(report) },
  };
  const i18n = {
    translate: jest.fn(
      (key: string, opts?: { args?: Record<string, unknown> }) =>
        opts?.args ? `${key} ${JSON.stringify(opts.args)}` : key,
    ),
  };
  const translationService = { getCurrentLocale: () => 'es' };
  const service = new QuarterlyReportsPdfService(
    prisma as any,
    i18n as any,
    translationService as any,
  );
  return { service, i18n };
}

const baseReport = (overrides: Record<string, unknown> = {}) => ({
  quarterly_report_id: 1,
  quarter: 1,
  year: 2026,
  club: {
    name: 'Club',
    churches: { name: 'Iglesia' },
    districts: { name: 'Distrito' },
  },
  finalized_by_user: null,
  manual_data: {},
  computed_data: {
    member_count: 10,
    months_in_quarter: ['Enero', 'Febrero', 'Marzo'],
    directiva: [],
    honors: { started: 1, completed: 2 },
    activities: { total: 3 },
    finances: { income: 10, expenses: 5, balance: 5, transactions: 2 },
    missionary: { baptized_this_quarter: 0 },
  },
  ...overrides,
});

describe('QuarterlyReportsPdfService pagination', () => {
  it('keeps a short report on a single page instead of forcing a break before finances', async () => {
    const { service } = buildService(baseReport());

    const pdf = await service.generatePdf(1);

    expect(countPages(pdf)).toBe(1);
  });

  it('numbers the footer on every page', async () => {
    const directiva = Array.from({ length: 60 }, (_, i) => ({
      role: 'director',
      user_id: String(i),
      name: `Persona ${i}`,
    }));
    const report = baseReport();
    (report.computed_data as any).directiva = directiva;
    const { service, i18n } = buildService(report);

    const pdf = await service.generatePdf(1);

    expect(countPages(pdf)).toBe(2);
    const footerArgs = i18n.translate.mock.calls
      .filter(([key]) => key === 'quarterly_reports.footer')
      .map(([, opts]) => opts.args);
    expect(footerArgs).toEqual([
      { current: 1, total: 2 },
      { current: 2, total: 2 },
    ]);
  });
});

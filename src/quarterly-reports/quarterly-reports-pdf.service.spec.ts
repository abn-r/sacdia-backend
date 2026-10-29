import { QuarterlyReportsPdfService } from './quarterly-reports-pdf.service';
import { loadPdfKit } from '../common/utils/pdfkit-loader';

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

/** Records every string passed to `doc.text` while `run` generates the PDF. */
async function captureText(run: () => Promise<unknown>): Promise<string[]> {
  const proto = loadPdfKit().prototype;
  const original = proto.text;
  const lines: string[] = [];
  proto.text = function (this: unknown, text: unknown, ...rest: unknown[]) {
    if (typeof text === 'string') lines.push(text);
    return original.call(this, text, ...rest);
  };
  try {
    await run();
  } finally {
    proto.text = original;
  }
  return lines;
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
    const directiva = Array.from({ length: 45 }, (_, i) => ({
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

describe('QuarterlyReportsPdfService directiva roles', () => {
  it('prints Spanish role labels and falls back to the slug for unknown roles', async () => {
    const report = baseReport();
    (report.computed_data as any).directiva = [
      { role: 'director', user_id: '1', name: 'Ana' },
      { role: 'deputy-director', user_id: '2', name: 'Beto' },
      { role: 'secretary-treasurer', user_id: '3', name: 'Carla' },
      { role: 'counselor', user_id: '4', name: 'Dani' },
    ];
    const { service } = buildService(report);

    const lines = await captureText(() => service.generatePdf(1));

    expect(lines).toEqual(
      expect.arrayContaining([
        '  Director: Ana',
        '  Subdirector: Beto',
        '  Secretario tesorero: Carla',
        '  counselor: Dani',
      ]),
    );
  });
});

describe('QuarterlyReportsPdfService club director block', () => {
  it('prints the club directors from the directiva, not the user who finalized it', async () => {
    const report = baseReport({
      finalized_by_user: {
        name: 'Super',
        paternal_last_name: 'Admin',
        email: 'admin@example.com',
      },
    });
    (report.computed_data as any).directiva = [
      { role: 'director', user_id: '1', name: 'Ana Director' },
      { role: 'treasurer', user_id: '2', name: 'Tomas Tesorero' },
      { role: 'director', user_id: '3', name: 'Beto Director' },
    ];
    const { service } = buildService(report);

    const lines = await captureText(() => service.generatePdf(1));

    expect(lines).toEqual(
      expect.arrayContaining([
        'quarterly_reports.club_director.header',
        'Ana Director',
        'Beto Director',
      ]),
    );
    expect(lines).not.toContain('Tomas Tesorero');
    expect(lines.join('\n')).not.toMatch(/admin@example\.com|Super/);
    expect(lines).not.toContain('quarterly_reports.club_director.fallback');
  });

  it('prints the fallback when no director is assigned', async () => {
    const { service } = buildService(baseReport());

    const lines = await captureText(() => service.generatePdf(1));

    expect(lines).toContain('quarterly_reports.club_director.fallback');
  });
});

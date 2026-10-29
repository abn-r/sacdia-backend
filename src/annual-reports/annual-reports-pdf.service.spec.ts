import { AnnualReportsPdfService } from './annual-reports-pdf.service';
import { loadPdfKit } from '../common/utils/pdfkit-loader';

describe('AnnualReportsPdfService year label fallback', () => {
  it('labels the PDF by the UTC start year when computed data has no label, whatever the server timezone', async () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'America/Mexico_City';
    try {
      const prisma = {
        annual_reports: {
          findUnique: jest.fn().mockResolvedValue({
            annual_report_id: 1,
            computed_data: {},
            manual_data: {},
            club: { name: 'Club' },
            ecclesiastical_year: {
              start_date: new Date('2026-01-01T00:00:00.000Z'),
              end_date: new Date('2026-12-31T00:00:00.000Z'),
            },
            finalized_by_user: null,
          }),
        },
      };
      const i18n = { translate: jest.fn((key: string) => key) };
      const translationService = { getCurrentLocale: () => 'es' };
      const service = new AnnualReportsPdfService(
        prisma as any,
        i18n as any,
        translationService as any,
      );
      const drawHeader = jest
        .spyOn(service as any, 'drawHeader')
        .mockImplementation(() => undefined);
      for (const method of [
        'drawSectionTitle',
        'drawSummary',
        'drawTeachings',
        'drawActivities',
        'drawFinances',
        'drawMissionary',
        'drawRanking',
        'drawDirectorInfo',
        'drawFooter',
      ]) {
        jest.spyOn(service as any, method).mockImplementation(() => undefined);
      }

      await service.generatePdf(1);

      expect(drawHeader.mock.calls[0][4]).toBe('2026');
    } finally {
      process.env.TZ = originalTz;
    }
  });
});

const countPages = (pdf: Buffer): number =>
  (pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;

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

function buildRealService(computedOverrides: Record<string, unknown> = {}) {
  const report = {
    annual_report_id: 1,
    computed_data: {
      year_label: '2026',
      member_count: 10,
      months_reported: 4,
      directiva: [] as { role: string; user_id: string; name: string }[],
      honors: { started: 1, completed: 2 },
      activities: { total: 3 },
      finances: { income: 10, expenses: 5, balance: 5, transactions: 2 },
      missionary: { baptized_total: 0 },
      ranking_percentile: null,
      top_achievers: [],
      ...computedOverrides,
    },
    manual_data: {},
    club: {
      name: 'Club',
      churches: { name: 'Iglesia' },
      districts: { name: 'Distrito' },
    },
    ecclesiastical_year: null,
    finalized_by_user: null,
  };
  const prisma = {
    annual_reports: { findUnique: jest.fn().mockResolvedValue(report) },
  };
  const i18n = {
    translate: jest.fn(
      (key: string, opts?: { args?: Record<string, unknown> }) => key,
    ),
  };
  const service = new AnnualReportsPdfService(
    prisma as any,
    i18n as any,
    { getCurrentLocale: () => 'es' } as any,
  );
  return { service, i18n };
}

describe('AnnualReportsPdfService pagination', () => {
  it('keeps a short report on a single page instead of forcing a break before finances', async () => {
    const { service } = buildRealService();

    expect(countPages(await service.generatePdf(1))).toBe(1);
  });

  it('numbers the footer on every page', async () => {
    const directiva = Array.from({ length: 35 }, (_, i) => ({
      role: 'director',
      user_id: String(i),
      name: `Persona ${i}`,
    }));
    const { service, i18n } = buildRealService({ directiva });

    const pdf = await service.generatePdf(1);

    expect(countPages(pdf)).toBe(2);
    const footers = i18n.translate.mock.calls.filter(
      ([key]) => key === 'annual_reports.footer',
    );
    expect(footers.map(([, opts]: any) => opts.args)).toEqual([
      { current: 1, total: 2 },
      { current: 2, total: 2 },
    ]);
  });
});

describe('AnnualReportsPdfService directiva roles', () => {
  it('prints Spanish role labels and falls back to the slug for unknown roles', async () => {
    const { service } = buildRealService({
      directiva: [
        { role: 'treasurer', user_id: '1', name: 'Ana' },
        { role: 'secretary', user_id: '2', name: 'Beto' },
        { role: 'counselor', user_id: '3', name: 'Dani' },
      ],
    });

    const lines = await captureText(() => service.generatePdf(1));

    expect(lines).toEqual(
      expect.arrayContaining([
        '  Tesorero: Ana',
        '  Secretario: Beto',
        '  counselor: Dani',
      ]),
    );
  });
});

describe('AnnualReportsPdfService club director block', () => {
  it('prints the club directors from the directiva, not the user who finalized it', async () => {
    const { service } = buildRealService({
      directiva: [
        { role: 'director', user_id: '1', name: 'Ana Director' },
        { role: 'treasurer', user_id: '2', name: 'Tomas Tesorero' },
      ],
    });

    const lines = await captureText(() => service.generatePdf(1));

    expect(lines).toEqual(
      expect.arrayContaining([
        'annual_reports.club_director.header',
        'Ana Director',
      ]),
    );
    expect(lines).not.toContain('Tomas Tesorero');
    expect(lines).not.toContain('annual_reports.club_director.fallback');
  });

  it('prints the fallback when no director is assigned', async () => {
    const { service } = buildRealService();

    const lines = await captureText(() => service.generatePdf(1));

    expect(lines).toContain('annual_reports.club_director.fallback');
  });
});

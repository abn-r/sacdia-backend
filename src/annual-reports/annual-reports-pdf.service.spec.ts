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
        'drawTopAchievers',
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

const emptyMonthly = (): Record<string, unknown> => ({
  months_submitted: 0,
  months_covered: [],
  planning_meetings: null,
  parent_meetings: null,
  baptized_this_year: null,
  total_baptized: null,
  annual_achievements_description: null,
  community_service_description: null,
  all_investitures_completed: null,
  camporees_attended: 0,
});

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
      finances: {
        income: 10,
        expenses: 5,
        balance: 5,
        total_balance: 40,
        transactions: 2,
      },
      missionary: { baptized_total: null },
      top_achievers: [],
      monthly_data: emptyMonthly(),
      ...computedOverrides,
    },
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
    translate: jest.fn((key: string) => key),
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
  it('localizes the role labels through i18n and falls back to the slug for unknown roles', async () => {
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
        '  annual_reports.roles.treasurer: Ana',
        '  annual_reports.roles.secretary: Beto',
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

describe('AnnualReportsPdfService figures from monthly reports', () => {
  it('prints every figure, with "Month: text" lines in the report locale', async () => {
    const { service } = buildRealService({
      monthly_data: {
        months_submitted: 3,
        months_covered: [],
        planning_meetings: 21,
        parent_meetings: 22,
        baptized_this_year: 23,
        total_baptized: 24,
        annual_achievements_description: [
          { year: 2026, month: 3, text: 'Medalla distrital' },
        ],
        community_service_description: [
          { year: 2026, month: 2, text: 'Jornadas de limpieza' },
        ],
        all_investitures_completed: true,
        camporees_attended: 25,
      },
    });

    const lines = await captureText(() => service.generatePdf(1));

    expect(lines).toEqual(
      expect.arrayContaining([
        'annual_reports.summary.planning_meetings: ',
        '21',
        'annual_reports.summary.parent_meetings: ',
        '22',
        'annual_reports.missionary.baptized_this_year: ',
        '23',
        'annual_reports.missionary.total_baptized: ',
        '24',
        'annual_reports.missionary.camporees_attended: ',
        '25',
        'annual_reports.missionary.all_investitures_completed: ',
        'annual_reports.bool.true',
        'Marzo: Medalla distrital',
        'Febrero: Jornadas de limpieza',
      ]),
    );
    expect(lines).not.toContain('—');
  });

  it('prints a dash for every figure when no monthly report was submitted', async () => {
    const { service } = buildRealService();

    const lines = await captureText(() => service.generatePdf(1));

    // planning, parent, achievements, baptized, total baptized,
    // investitures, community service
    // (camporees come from registrations and print 0, not a dash)
    expect(lines.filter((line) => line === '—')).toHaveLength(7);
    expect(lines).toContain('annual_reports.summary.monthly_basis_none');
  });

  it('still renders a legacy report that has no monthly_data', async () => {
    const { service } = buildRealService({ monthly_data: undefined });

    await expect(service.generatePdf(1)).resolves.toBeInstanceOf(Buffer);
  });

  it('prints honors and activities totals only in their own sections', async () => {
    const { service } = buildRealService();

    const lines = await captureText(() => service.generatePdf(1));

    for (const label of [
      'annual_reports.summary.total_activities: ',
      'annual_reports.summary.honors_started: ',
      'annual_reports.summary.honors_completed: ',
    ]) {
      expect(lines.filter((line) => line === label)).toHaveLength(1);
    }
  });
});

describe('AnnualReportsPdfService finances', () => {
  it('prints the period net AND the cumulative balance at the end of the year', async () => {
    const { service } = buildRealService();

    const lines = await captureText(() => service.generatePdf(1));

    expect(lines).toEqual(
      expect.arrayContaining([
        'annual_reports.finances.annual_balance',
        '$5.00',
        'annual_reports.finances.total_balance',
        '$40.00',
      ]),
    );
  });
});

describe('AnnualReportsPdfService top achievers', () => {
  it('has no ranking percentile and keeps the top achievers list under its own title', async () => {
    const { service, i18n } = buildRealService({
      ranking_percentile: 80,
      top_achievers: [{ user_id: 'u1', name: 'Ana P', honors_count: 3 }],
    });

    const lines = await captureText(() => service.generatePdf(1));

    const keys = i18n.translate.mock.calls.map(([key]: any[]) => key);
    expect(keys).not.toContain('annual_reports.ranking.percentile');
    expect(keys).not.toContain('annual_reports.section_titles.ranking');
    expect(keys).toContain('annual_reports.section_titles.top_achievers');
    expect(lines).toEqual(
      expect.arrayContaining([
        'annual_reports.ranking.member',
        'annual_reports.ranking.honors',
        'Ana P',
        '3',
      ]),
    );
    expect(lines.join('\n')).not.toContain('80%');
  });
});

describe('AnnualReportsPdfService labels', () => {
  it('has no hard-coded Spanish: every label goes through i18n', async () => {
    const { service } = buildRealService({
      directiva: [{ role: 'director', user_id: '1', name: 'Ana' }],
      top_achievers: [{ user_id: 'u1', name: 'Ana P', honors_count: 3 }],
    });

    const text = (await captureText(() => service.generatePdf(1))).join('\n');

    for (const hardCoded of [
      'Bautizados en el año',
      'Campamentos asistidos',
      'Reuniones de',
      'Servicio comunitario',
      'Directiva',
      'Miembro',
      'Especialidades',
      'Logros del año',
      'investiduras',
    ]) {
      expect(text).not.toContain(hardCoded);
    }
  });
});

describe('AnnualReportsPdfService header year label', () => {
  const headerYear = async (yearLabel: string) => {
    const { service } = buildRealService({ year_label: yearLabel });
    const drawHeader = jest.spyOn(service as any, 'drawHeader');
    await service.generatePdf(1);
    return drawHeader.mock.calls[0][4];
  };

  it('shows a single year for reports stored with an equal range', async () => {
    expect(await headerYear('2026–2026')).toBe('2026');
  });

  it('keeps a real range', async () => {
    expect(await headerYear('2025–2026')).toBe('2025–2026');
  });
});

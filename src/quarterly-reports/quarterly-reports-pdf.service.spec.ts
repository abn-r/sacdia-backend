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

const emptyMonthly = (): Record<string, unknown> => ({
  months_submitted: 0,
  months_covered: [],
  planning_meetings: null,
  parent_meetings: null,
  youth_council_attendance: null,
  church_board_attendance: null,
  soul_target: null,
  baptized_this_quarter: null,
  club_participation_description: null,
  community_service_description: null,
  certificates_delivered: null,
  camporees_attended: 0,
});

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
  computed_data: {
    member_count: 10,
    months_in_quarter: [1, 2, 3],
    directiva: [],
    honors: { started: 1, completed: 2 },
    activities: { total: 3 },
    finances: {
      income: 10,
      expenses: 5,
      balance: 5,
      total_balance: 40,
      transactions: 2,
    },
    missionary: { baptized_this_quarter: null },
    monthly_data: emptyMonthly(),
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
    const directiva = Array.from({ length: 35 }, (_, i) => ({
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
  it('localizes the role labels through i18n and falls back to the slug for unknown roles', async () => {
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
        '  quarterly_reports.roles.director: Ana',
        '  quarterly_reports.roles.deputy-director: Beto',
        '  quarterly_reports.roles.secretary-treasurer: Carla',
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

describe('QuarterlyReportsPdfService figures from monthly reports', () => {
  const filled = (over: Record<string, unknown> = {}) => ({
    months_submitted: 2,
    months_covered: [
      { year: 2026, month: 1 },
      { year: 2026, month: 3 },
    ],
    planning_meetings: 11,
    parent_meetings: 12,
    youth_council_attendance: 13,
    church_board_attendance: 14,
    soul_target: 15,
    baptized_this_quarter: 16,
    club_participation_description: [
      { year: 2026, month: 1, text: 'Participó en el campamento' },
    ],
    community_service_description: [
      { year: 2026, month: 3, text: 'Limpieza de parques' },
    ],
    certificates_delivered: true,
    camporees_attended: 17,
    ...over,
  });
  const withMonthly = (monthly: Record<string, unknown>) => {
    const report = baseReport();
    (report.computed_data as any).monthly_data = monthly;
    return report;
  };

  it('prints every figure, with "Month: text" lines in the report locale', async () => {
    const { service } = buildService(withMonthly(filled()));

    const lines = await captureText(() => service.generatePdf(1));

    expect(lines).toEqual(
      expect.arrayContaining([
        'quarterly_reports.summary.planning_meetings: ',
        '11',
        'quarterly_reports.summary.parent_meetings: ',
        '12',
        'quarterly_reports.summary.youth_council_attendance: ',
        '13',
        'quarterly_reports.summary.church_board_attendance: ',
        '14',
        'quarterly_reports.missionary.soul_target: ',
        '15',
        'quarterly_reports.missionary.baptized_this_quarter: ',
        '16',
        'quarterly_reports.missionary.camporees_attended: ',
        '17',
        'quarterly_reports.teachings.certificates_delivered: ',
        'quarterly_reports.bool.true',
        'Enero: Participó en el campamento',
        'Marzo: Limpieza de parques',
      ]),
    );
    expect(lines).not.toContain('—');
  });

  it('names the covered months in the report locale', async () => {
    const { service } = buildService(withMonthly(filled()));

    const lines = await captureText(() => service.generatePdf(1));

    expect(lines).toContain('Enero, Febrero, Marzo');
  });

  it('says how many monthly reports it is based on', async () => {
    const { service, i18n } = buildService(withMonthly(filled()));

    await service.generatePdf(1);

    expect(i18n.translate).toHaveBeenCalledWith(
      'quarterly_reports.summary.monthly_basis',
      expect.objectContaining({ args: { count: 2 } }),
    );
  });

  it('prints a dash for every figure when no monthly report was submitted', async () => {
    const { service } = buildService(baseReport());

    const lines = await captureText(() => service.generatePdf(1));

    // planning, parent, youth council, church board, participation,
    // certificates, soul target, baptized, community service
    // (camporees come from registrations and print 0, not a dash)
    expect(lines.filter((line) => line === '—')).toHaveLength(9);
    expect(lines).toContain('quarterly_reports.summary.monthly_basis_none');
  });

  it('prints the localized No for certificates delivered when false', async () => {
    const { service } = buildService(
      withMonthly(filled({ certificates_delivered: false })),
    );

    const lines = await captureText(() => service.generatePdf(1));

    expect(lines).toContain('quarterly_reports.bool.false');
  });

  it('still renders a legacy report that has no monthly_data', async () => {
    const report = baseReport();
    delete (report.computed_data as any).monthly_data;
    const { service } = buildService(report);

    await expect(service.generatePdf(1)).resolves.toBeInstanceOf(Buffer);
  });

  it('prints honors and activities totals only in their own sections', async () => {
    const { service } = buildService(baseReport());

    const lines = await captureText(() => service.generatePdf(1));

    for (const label of [
      'quarterly_reports.summary.total_activities: ',
      'quarterly_reports.summary.honors_started: ',
      'quarterly_reports.summary.honors_completed: ',
    ]) {
      expect(lines.filter((line) => line === label)).toHaveLength(1);
    }
  });
});

describe('QuarterlyReportsPdfService finances', () => {
  it('prints the period net AND the cumulative balance at the end of the quarter', async () => {
    const { service } = buildService(baseReport());

    const lines = await captureText(() => service.generatePdf(1));

    expect(lines).toEqual(
      expect.arrayContaining([
        'quarterly_reports.finances.quarter_balance',
        '$5.00',
        'quarterly_reports.finances.total_balance',
        '$40.00',
      ]),
    );
  });
});

describe('QuarterlyReportsPdfService labels', () => {
  it('has no hard-coded Spanish: every label goes through i18n', async () => {
    const report = baseReport();
    (report.computed_data as any).directiva = [
      { role: 'director', user_id: '1', name: 'Ana' },
    ];
    const { service } = buildService(report);

    const lines = await captureText(() => service.generatePdf(1));
    const text = lines.join('\n');

    for (const hardCoded of [
      'Meta de almas',
      'Bautizados en el trimestre',
      'Campamentos asistidos',
      'Reuniones de',
      'Servicio comunitario',
      'Directiva',
      'Certificados entregados',
    ]) {
      expect(text).not.toContain(hardCoded);
    }
  });
});

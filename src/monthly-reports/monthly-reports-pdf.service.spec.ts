import { I18nService } from 'nestjs-i18n';
import { TranslationService } from '../common/services/translation.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildMonthlyReportPdfKey,
  MONTHLY_REPORT_PDF_TEMPLATE_VERSION,
} from './monthly-report-artifact.constants';
import { MonthlyReportsPdfService } from './monthly-reports-pdf.service';

const REPORT_ID = '11111111-1111-4111-8111-111111111111';

function buildReportFixture() {
  return {
    monthly_report_id: REPORT_ID,
    club_enrollment_id: '22222222-2222-4222-8222-222222222222',
    month: 8,
    year: 2026,
    status: 'generated',
    snapshot_data: {
      member_count: 28,
      directiva: [
        {
          role: 'director',
          user_id: '33333333-3333-4333-8333-333333333333',
          name: 'Alex Director',
        },
      ],
      honors: {
        started: 3,
        completed: 2,
        details: [
          {
            honor_name: 'Campismo',
            user_name: 'Miembro Uno',
            validated: true,
            date: '2026-08-10',
          },
        ],
      },
      activities: {
        total: 1,
        list: [
          {
            activity_id: 1,
            name: 'Caminata',
            type: 'club',
            date: '2026-08-15',
          },
        ],
      },
      finances: {
        income: 1500,
        expenses: 750,
        balance: 750,
        total_balance: 2100,
        transactions: 6,
      },
      meeting_days: 'Sábados',
    },
    manual_data: {
      planning_meetings: 1,
      parent_meetings: 1,
      youth_council_attendance: 2,
      church_board_attendance: 1,
      soul_target: 4,
      unbaptized_members: 3,
      bible_studies_receiving: 2,
      has_weekly_bible_instruction: true,
      bible_studies_given: true,
      literature_distributed: false,
      baptized_this_month: 1,
      total_baptized: 3,
      club_participation_description: 'Participación mensual',
      community_service_description: 'Servicio comunitario',
      certificates_delivered: true,
      members_have_booklet: true,
      booklet_requirements_signed: false,
    },
    club_enrollment: {
      club_section: {
        club_types: { name: 'Conquistadores' },
        clubs: {
          name: 'Orión',
          churches: { name: 'Central' },
          districts: { name: 'Norte' },
        },
      },
    },
    submitter: {
      user_id: '44444444-4444-4444-8444-444444444444',
      name: 'Sara',
      paternal_last_name: 'Secretaria',
      maternal_last_name: null,
      email: 'sara@example.com',
    },
  };
}

function countPdfPages(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
}

describe('MonthlyReportsPdfService', () => {
  const findUnique = jest.fn();
  const prisma = {
    monthly_reports: { findUnique },
  } as unknown as PrismaService;
  const i18n = {
    translate: jest.fn((key: string) => key.split('.').at(-1) ?? key),
  } as unknown as I18nService;
  const translationService = {
    getCurrentLocale: jest.fn(() => 'es'),
  } as unknown as TranslationService;

  const service = new MonthlyReportsPdfService(
    prisma,
    i18n,
    translationService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the frozen report as exactly three selectable-text pages', async () => {
    findUnique.mockResolvedValueOnce(buildReportFixture());

    const pdf = await service.generatePdf(REPORT_ID);

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(countPdfPages(pdf)).toBe(3);
  });

  it('keeps unavailable historical values blank and still renders three pages', async () => {
    const fixture = buildReportFixture();
    fixture.snapshot_data.meeting_days = null as unknown as string;
    fixture.snapshot_data.honors.details = [];
    fixture.snapshot_data.activities.list = [];
    fixture.manual_data.club_participation_description = null as unknown as string;
    fixture.manual_data.community_service_description = null as unknown as string;
    fixture.club_enrollment.club_section.clubs.churches = null as unknown as {
      name: string;
    };
    fixture.club_enrollment.club_section.clubs.districts = null as unknown as {
      name: string;
    };
    fixture.submitter = null as unknown as typeof fixture.submitter;
    findUnique.mockResolvedValueOnce(fixture);

    const pdf = await service.generatePdf(REPORT_ID);

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(countPdfPages(pdf)).toBe(3);
  });
});

describe('monthly report artifact constants', () => {
  it('builds the deterministic relative R2 key without duplicating the prefix', () => {
    expect(
      buildMonthlyReportPdfKey({
        reportId: REPORT_ID,
        enrollmentId: '22222222-2222-4222-8222-222222222222',
        month: 8,
        year: 2026,
      }),
    ).toBe(
      '2026/08/22222222-2222-4222-8222-222222222222/' +
        `${REPORT_ID}.pdf`,
    );
    expect(MONTHLY_REPORT_PDF_TEMPLATE_VERSION).toBe(
      'monthly-report-v2-three-page',
    );
  });
});

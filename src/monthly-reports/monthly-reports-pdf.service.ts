import { Injectable, Logger } from '@nestjs/common';
import {
  AppNotFoundException,
  AppBadRequestException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { I18nService } from 'nestjs-i18n';
import { TranslationService } from '../common/services/translation.service';
import PDFDocument from 'pdfkit';

// ============================================================
// Types for snapshot_data (mirrors preview() return shape)
// ============================================================

interface DirectivaMember {
  role: string;
  user_id: string;
  name: string;
}

interface HonorDetail {
  honor_name: string;
  user_name: string;
  validated: boolean;
  date: string;
}

interface ActivityItem {
  activity_id: number;
  name: string;
  type: string;
  date: string;
}

interface SnapshotData {
  member_count: number;
  directiva: DirectivaMember[];
  honors: {
    started: number;
    completed: number;
    details: HonorDetail[];
  };
  activities: {
    total: number;
    list: ActivityItem[];
  };
  finances: {
    income: number;
    expenses: number;
    balance: number;
    transactions: number;
  };
  meeting_days: string | null;
}

interface ManualData {
  planning_meetings: number;
  parent_meetings: number;
  youth_council_attendance: number;
  church_board_attendance: number;
  soul_target: number;
  unbaptized_members: number;
  bible_studies_receiving: number;
  has_weekly_bible_instruction: boolean;
  bible_studies_given: boolean;
  literature_distributed: boolean;
  baptized_this_month: number;
  total_baptized: number;
  club_participation_description: string | null;
  community_service_description: string | null;
  certificates_delivered: boolean;
  members_have_booklet: boolean;
  booklet_requirements_signed: boolean;
}

// ============================================================
// Constants
// ============================================================

/**
 * Maps SACDIA locale codes to BCP-47 locale tags used by Intl APIs.
 */
const BCP47: Record<string, string> = {
  es: 'es-MX',
  'pt-BR': 'pt-BR',
  en: 'en-US',
  fr: 'fr-FR',
};

const PAGE_MARGIN = 40;
const CONTENT_WIDTH = 612 - PAGE_MARGIN * 2; // Letter width minus margins

@Injectable()
export class MonthlyReportsPdfService {
  private readonly logger = new Logger(MonthlyReportsPdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
    private readonly translationService: TranslationService,
  ) {}

  /**
   * Generates a PDF buffer for the given monthly report.
   * Only works for reports with status 'generated' or 'submitted'.
   * The PDF locale is determined by the active I18nContext (Accept-Language header
   * or ?lang= query param), falling back to 'es'.
   */
  async generatePdf(reportId: string): Promise<Buffer> {
    const report = await this.prisma.monthly_reports.findUnique({
      where: { monthly_report_id: reportId },
      include: {
        manual_data: true,
        club_enrollment: {
          include: {
            club_section: {
              include: {
                club_types: { select: { name: true } },
                clubs: {
                  include: {
                    churches: { select: { name: true } },
                    districts: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
        submitter: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
            email: true,
          },
        },
      },
    });

    if (!report) {
      throw new AppNotFoundException(ErrorCode.REPORT_PDF_NOT_FOUND);
    }

    if (!['generated', 'submitted'].includes(report.status)) {
      throw new AppBadRequestException(ErrorCode.REPORT_PDF_NOT_GENERATED);
    }

    if (!report.snapshot_data) {
      throw new AppBadRequestException(ErrorCode.REPORT_PDF_NO_SNAPSHOT);
    }

    // ======== Locale resolution ========
    const locale = this.translationService.getCurrentLocale(); // 'es' | 'pt-BR' | 'en' | 'fr'
    const intlLocale = BCP47[locale] ?? 'es-MX';

    /**
     * Shorthand translation helper scoped to the monthly_reports namespace.
     * Interpolation tokens use nestjs-i18n args format: {key} in JSON.
     */
    const t = (key: string, args?: Record<string, unknown>): string =>
      this.i18n.translate(`monthly_reports.${key}`, {
        lang: locale,
        args,
      });

    // Cast to any to access include relations (Prisma types are inferred at compile time)
    const reportData = report as any;

    const snapshot = reportData.snapshot_data as SnapshotData;
    const manual = (reportData.manual_data ?? {}) as Partial<ManualData>;
    const enrollment = reportData.club_enrollment;
    const section = enrollment?.club_section;
    const club = section?.clubs;

    const clubName = (club?.name as string) ?? 'N/A';
    const clubType = (section?.club_types?.name as string) ?? 'N/A';
    const churchName = (club?.churches?.name as string) ?? 'N/A';
    const districtName = (club?.districts?.name as string) ?? 'N/A';
    const monthName = t(`month_names.${report.month}`);

    // ========================================
    // Build PDF
    // ========================================

    const doc = new PDFDocument({
      size: 'LETTER',
      margins: {
        top: PAGE_MARGIN,
        bottom: PAGE_MARGIN,
        left: PAGE_MARGIN,
        right: PAGE_MARGIN,
      },
      info: {
        Title: `${t('header.title')} - ${clubName} - ${monthName} ${report.year}`,
        Author: 'SACDIA',
        Subject: t('header.title'),
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    const pdfReady = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    // ======== PAGE 1 (FRONT) ========

    this.drawHeader(
      doc,
      clubName,
      clubType,
      districtName,
      churchName,
      monthName,
      report.year,
      t,
    );

    // Section 1: Administration
    this.drawSectionTitle(doc, t('section_titles.administration'));
    this.drawAdministracion(doc, snapshot, manual, t);

    // Section 2: Teachings
    this.drawSectionTitle(doc, t('section_titles.teachings'));
    this.drawEnsenanzas(doc, snapshot, t);

    // Section 3: Club Activities
    this.drawSectionTitle(doc, t('section_titles.activities'));
    this.drawActividades(doc, snapshot, intlLocale, t);

    // ======== PAGE 2 (BACK) ========
    doc.addPage();

    // Section 4: Finances
    this.drawSectionTitle(doc, t('section_titles.finances'));
    this.drawFinanzas(doc, snapshot, intlLocale, t);

    // Section 5: Missionary Activity
    this.drawSectionTitle(doc, t('section_titles.missionary'));
    this.drawActividadMisionera(doc, manual, t);

    // Section 6: Service
    this.drawSectionTitle(doc, t('section_titles.service'));
    this.drawServicio(doc, manual, t);

    // Secretary info
    this.drawSecretaryInfo(doc, reportData.submitter, t);

    // Footer on both pages
    this.drawFooter(doc, t);

    doc.end();

    return pdfReady;
  }

  // ========================================
  // PRIVATE — Drawing helpers
  // ========================================

  private drawHeader(
    doc: PDFKit.PDFDocument,
    clubName: string,
    clubType: string,
    districtName: string,
    churchName: string,
    monthName: string,
    year: number,
    t: (key: string, args?: Record<string, unknown>) => string,
  ) {
    // Title
    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .text(t('header.title'), PAGE_MARGIN, PAGE_MARGIN, {
        width: CONTENT_WIDTH,
        align: 'center',
      });

    doc.moveDown(0.3);

    // Club type subtitle
    doc
      .fontSize(12)
      .font('Helvetica')
      .text(t('header.club_type', { type: clubType }), {
        width: CONTENT_WIDTH,
        align: 'center',
      });

    doc.moveDown(0.8);

    // Info grid
    const y = doc.y;
    const col1X = PAGE_MARGIN;
    const col2X = PAGE_MARGIN + CONTENT_WIDTH / 2 + 10;

    doc.fontSize(10).font('Helvetica-Bold');

    doc.text(`${t('header.district')}: `, col1X, y, { continued: true });
    doc.font('Helvetica').text(districtName);

    doc
      .font('Helvetica-Bold')
      .text(`${t('header.church')}: `, col2X, y, { continued: true });
    doc.font('Helvetica').text(churchName);

    const y2 = doc.y + 2;
    doc
      .font('Helvetica-Bold')
      .text(`${t('header.club')}: `, col1X, y2, { continued: true });
    doc.font('Helvetica').text(clubName);

    doc
      .font('Helvetica-Bold')
      .text(`${t('header.month')}: `, col2X, y2, { continued: true });
    doc.font('Helvetica').text(`${monthName} ${year}`);

    doc.moveDown(1);

    // Horizontal line
    this.drawHorizontalLine(doc);
  }

  private drawSectionTitle(doc: PDFKit.PDFDocument, title: string) {
    // Check if we need more space
    if (doc.y > 680) {
      doc.addPage();
    }

    doc.moveDown(0.5);
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#1a365d')
      .text(title, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.fillColor('#000000');
    doc.moveDown(0.3);

    // Thin line under section title
    const y = doc.y;
    doc
      .strokeColor('#1a365d')
      .lineWidth(0.5)
      .moveTo(PAGE_MARGIN, y)
      .lineTo(PAGE_MARGIN + CONTENT_WIDTH, y)
      .stroke();
    doc.strokeColor('#000000');
    doc.moveDown(0.3);
  }

  private drawAdministracion(
    doc: PDFKit.PDFDocument,
    snapshot: SnapshotData,
    manual: Partial<ManualData>,
    t: (key: string, args?: Record<string, unknown>) => string,
  ) {
    const fontSize = 9;
    doc.fontSize(fontSize).font('Helvetica');

    // Directiva
    doc
      .font('Helvetica-Bold')
      .text(`${t('administration.directiva')}:`, PAGE_MARGIN, doc.y);
    doc.font('Helvetica');

    if (snapshot.directiva && snapshot.directiva.length > 0) {
      for (const member of snapshot.directiva) {
        const label = t(`role_labels.${member.role}`) ?? member.role;
        this.drawKeyValue(doc, `  ${label}`, member.name);
      }
    } else {
      doc.text(
        `  ${t('administration.no_directiva')}`,
        PAGE_MARGIN + 10,
        doc.y,
      );
    }

    doc.moveDown(0.3);

    // Member count & meeting days
    this.drawKeyValue(
      doc,
      t('administration.member_count'),
      String(snapshot.member_count),
    );
    this.drawKeyValue(
      doc,
      t('administration.meeting_days'),
      snapshot.meeting_days ?? t('administration.not_specified'),
    );

    doc.moveDown(0.3);

    // Manual fields
    doc
      .font('Helvetica-Bold')
      .text(`${t('administration.meetings_header')}:`, PAGE_MARGIN, doc.y);
    doc.font('Helvetica');
    this.drawKeyValue(
      doc,
      `  ${t('administration.planning_meetings')}`,
      String(manual.planning_meetings ?? 0),
    );
    this.drawKeyValue(
      doc,
      `  ${t('administration.parent_meetings')}`,
      String(manual.parent_meetings ?? 0),
    );
    this.drawKeyValue(
      doc,
      `  ${t('administration.youth_council_attendance')}`,
      String(manual.youth_council_attendance ?? 0),
    );
    this.drawKeyValue(
      doc,
      `  ${t('administration.church_board_attendance')}`,
      String(manual.church_board_attendance ?? 0),
    );
  }

  private drawEnsenanzas(
    doc: PDFKit.PDFDocument,
    snapshot: SnapshotData,
    t: (key: string, args?: Record<string, unknown>) => string,
  ) {
    doc.fontSize(9).font('Helvetica');

    this.drawKeyValue(
      doc,
      t('teachings.honors_started'),
      String(snapshot.honors?.started ?? 0),
    );
    this.drawKeyValue(
      doc,
      t('teachings.honors_completed'),
      String(snapshot.honors?.completed ?? 0),
    );

    if (snapshot.honors?.details && snapshot.honors.details.length > 0) {
      doc.moveDown(0.3);
      doc
        .font('Helvetica-Bold')
        .text(`${t('teachings.detail_header')}:`, PAGE_MARGIN, doc.y);
      doc.font('Helvetica');

      // Table header
      const tableY = doc.y + 2;
      const colWidths = [
        CONTENT_WIDTH * 0.4,
        CONTENT_WIDTH * 0.35,
        CONTENT_WIDTH * 0.25,
      ];
      const colX = [
        PAGE_MARGIN,
        PAGE_MARGIN + colWidths[0],
        PAGE_MARGIN + colWidths[0] + colWidths[1],
      ];

      doc.font('Helvetica-Bold').fontSize(8);
      doc.text(t('teachings.honor_column'), colX[0], tableY);
      doc.text(t('teachings.member_column'), colX[1], tableY);
      doc.text(t('teachings.status_column'), colX[2], tableY);
      doc.font('Helvetica').fontSize(8);

      let rowY = tableY + 12;
      const maxRows = Math.min(snapshot.honors.details.length, 10); // Limit to 10 rows

      for (let i = 0; i < maxRows; i++) {
        const h = snapshot.honors.details[i];
        doc.text(h.honor_name ?? '', colX[0], rowY, {
          width: colWidths[0] - 5,
        });
        doc.text(h.user_name ?? '', colX[1], rowY, { width: colWidths[1] - 5 });
        doc.text(
          h.validated ? t('teachings.completed') : t('teachings.in_progress'),
          colX[2],
          rowY,
          { width: colWidths[2] - 5 },
        );
        rowY += 12;
      }

      if (snapshot.honors.details.length > 10) {
        doc.text(
          t('teachings.more_rows', {
            count: snapshot.honors.details.length - 10,
          }),
          colX[0],
          rowY,
        );
        rowY += 12;
      }

      doc.y = rowY;
    }
  }

  private drawActividades(
    doc: PDFKit.PDFDocument,
    snapshot: SnapshotData,
    intlLocale: string,
    t: (key: string, args?: Record<string, unknown>) => string,
  ) {
    doc.fontSize(9).font('Helvetica');

    this.drawKeyValue(
      doc,
      t('activities.total'),
      String(snapshot.activities?.total ?? 0),
    );

    if (snapshot.activities?.list && snapshot.activities.list.length > 0) {
      doc.moveDown(0.3);

      // Table header
      const tableY = doc.y;
      const colWidths = [
        CONTENT_WIDTH * 0.2,
        CONTENT_WIDTH * 0.5,
        CONTENT_WIDTH * 0.3,
      ];
      const colX = [
        PAGE_MARGIN,
        PAGE_MARGIN + colWidths[0],
        PAGE_MARGIN + colWidths[0] + colWidths[1],
      ];

      doc.font('Helvetica-Bold').fontSize(8);
      doc.text(t('activities.date_column'), colX[0], tableY);
      doc.text(t('activities.activity_column'), colX[1], tableY);
      doc.text(t('activities.type_column'), colX[2], tableY);
      doc.font('Helvetica').fontSize(8);

      let rowY = tableY + 12;
      const maxRows = Math.min(snapshot.activities.list.length, 12);

      for (let i = 0; i < maxRows; i++) {
        const a = snapshot.activities.list[i];
        const dateStr = a.date
          ? new Date(a.date).toLocaleDateString(intlLocale)
          : 'N/A';
        doc.text(dateStr, colX[0], rowY, { width: colWidths[0] - 5 });
        doc.text(a.name ?? '', colX[1], rowY, { width: colWidths[1] - 5 });
        doc.text(a.type ?? '', colX[2], rowY, { width: colWidths[2] - 5 });
        rowY += 12;
      }

      if (snapshot.activities.list.length > 12) {
        doc.text(
          t('activities.more_rows', {
            count: snapshot.activities.list.length - 12,
          }),
          colX[0],
          rowY,
        );
        rowY += 12;
      }

      doc.y = rowY;
    }
  }

  private drawFinanzas(
    doc: PDFKit.PDFDocument,
    snapshot: SnapshotData,
    intlLocale: string,
    t: (key: string, args?: Record<string, unknown>) => string,
  ) {
    doc.fontSize(9).font('Helvetica');

    const finances = snapshot.finances ?? {
      income: 0,
      expenses: 0,
      balance: 0,
      transactions: 0,
    };

    // Keep same shape (decimal, not currency style) — just swap locale for number formatting.
    const formatMoney = (amount: number) =>
      `$${amount.toLocaleString(intlLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Financial summary table
    const tableX = PAGE_MARGIN;
    const labelWidth = CONTENT_WIDTH * 0.6;
    const valueWidth = CONTENT_WIDTH * 0.4;

    const rows = [
      {
        label: t('finances.total_income'),
        value: formatMoney(finances.income),
        bold: false,
      },
      {
        label: t('finances.total_expenses'),
        value: formatMoney(finances.expenses),
        bold: false,
      },
      {
        label: t('finances.month_balance'),
        value: formatMoney(finances.balance),
        bold: true,
      },
      {
        label: t('finances.transaction_count'),
        value: String(finances.transactions),
        bold: false,
      },
    ];

    let rowY = doc.y;
    for (const row of rows) {
      if (row.bold) {
        doc.font('Helvetica-Bold');
      } else {
        doc.font('Helvetica');
      }
      doc.text(row.label, tableX, rowY, { width: labelWidth });
      doc.text(row.value, tableX + labelWidth, rowY, {
        width: valueWidth,
        align: 'right',
      });
      rowY += 14;
    }

    doc.font('Helvetica');
    doc.y = rowY;
  }

  private drawActividadMisionera(
    doc: PDFKit.PDFDocument,
    manual: Partial<ManualData>,
    t: (key: string, args?: Record<string, unknown>) => string,
  ) {
    doc.fontSize(9).font('Helvetica');

    this.drawKeyValue(
      doc,
      t('missionary.soul_target'),
      String(manual.soul_target ?? 0),
    );
    this.drawKeyValue(
      doc,
      t('missionary.unbaptized_members'),
      String(manual.unbaptized_members ?? 0),
    );
    this.drawKeyValue(
      doc,
      t('missionary.receiving_bible_studies'),
      String(manual.bible_studies_receiving ?? 0),
    );
    this.drawKeyValue(
      doc,
      t('missionary.weekly_bible_instruction'),
      this.boolLabel(manual.has_weekly_bible_instruction, t),
    );
    this.drawKeyValue(
      doc,
      t('missionary.bible_studies_given'),
      this.boolLabel(manual.bible_studies_given, t),
    );
    this.drawKeyValue(
      doc,
      t('missionary.literature_distributed'),
      this.boolLabel(manual.literature_distributed, t),
    );
    this.drawKeyValue(
      doc,
      t('missionary.baptized_this_month'),
      String(manual.baptized_this_month ?? 0),
    );
    this.drawKeyValue(
      doc,
      t('missionary.baptized_total'),
      String(manual.total_baptized ?? 0),
    );

    doc.moveDown(0.3);

    // Booklet / certificates
    this.drawKeyValue(
      doc,
      t('missionary.certificates_delivered'),
      this.boolLabel(manual.certificates_delivered, t),
    );
    this.drawKeyValue(
      doc,
      t('missionary.members_have_booklet'),
      this.boolLabel(manual.members_have_booklet, t),
    );
    this.drawKeyValue(
      doc,
      t('missionary.booklet_requirements_signed'),
      this.boolLabel(manual.booklet_requirements_signed, t),
    );

    // Club participation
    if (manual.club_participation_description) {
      doc.moveDown(0.3);
      doc
        .font('Helvetica-Bold')
        .text(`${t('missionary.club_participation')}:`, PAGE_MARGIN, doc.y);
      doc
        .font('Helvetica')
        .text(manual.club_participation_description, PAGE_MARGIN + 10, doc.y, {
          width: CONTENT_WIDTH - 10,
        });
    }
  }

  private drawServicio(
    doc: PDFKit.PDFDocument,
    manual: Partial<ManualData>,
    t: (key: string, args?: Record<string, unknown>) => string,
  ) {
    doc.fontSize(9).font('Helvetica');

    if (manual.community_service_description) {
      doc
        .font('Helvetica-Bold')
        .text(`${t('service.header')}:`, PAGE_MARGIN, doc.y);
      doc
        .font('Helvetica')
        .text(manual.community_service_description, PAGE_MARGIN + 10, doc.y, {
          width: CONTENT_WIDTH - 10,
        });
    } else {
      doc.text(t('service.fallback'), PAGE_MARGIN, doc.y);
    }
  }

  private drawSecretaryInfo(
    doc: PDFKit.PDFDocument,
    submitter: {
      user_id: string;
      name: string | null;
      paternal_last_name: string | null;
      maternal_last_name: string | null;
      email: string | null;
    } | null,
    t: (key: string, args?: Record<string, unknown>) => string,
  ) {
    doc.moveDown(1.5);
    this.drawHorizontalLine(doc);
    doc.moveDown(0.5);

    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .text(t('secretary.header'), PAGE_MARGIN, doc.y);
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica');

    if (submitter) {
      const fullName = [
        submitter.name,
        submitter.paternal_last_name,
        submitter.maternal_last_name,
      ]
        .filter(Boolean)
        .join(' ');
      this.drawKeyValue(doc, t('secretary.name'), fullName || 'N/A');
      this.drawKeyValue(doc, t('secretary.email'), submitter.email ?? 'N/A');
    } else {
      doc.text(t('secretary.fallback'), PAGE_MARGIN, doc.y);
    }
  }

  private drawFooter(
    doc: PDFKit.PDFDocument,
    t: (key: string, args?: Record<string, unknown>) => string,
  ) {
    // Go to each page and draw footer
    const range = (doc as any).bufferedPageRange?.() ?? { start: 0, count: 1 };
    for (let i = range.start; i < range.start + range.count; i++) {
      (doc as any).switchToPage?.(i);

      doc
        .fontSize(7)
        .font('Helvetica')
        .fillColor('#666666')
        .text(
          t('footer', { current: i + 1, total: range.count }),
          PAGE_MARGIN,
          740,
          { width: CONTENT_WIDTH, align: 'center' },
        );
    }
    doc.fillColor('#000000');
  }

  // ========================================
  // PRIVATE — Utility helpers
  // ========================================

  private drawKeyValue(doc: PDFKit.PDFDocument, label: string, value: string) {
    const y = doc.y;
    doc
      .font('Helvetica-Bold')
      .text(`${label}: `, PAGE_MARGIN, y, { continued: true });
    doc.font('Helvetica').text(value);
  }

  private drawHorizontalLine(doc: PDFKit.PDFDocument) {
    const y = doc.y;
    doc
      .lineWidth(1)
      .moveTo(PAGE_MARGIN, y)
      .lineTo(PAGE_MARGIN + CONTENT_WIDTH, y)
      .stroke();
    doc.moveDown(0.3);
  }

  private boolLabel(
    value: boolean | null | undefined,
    t: (key: string, args?: Record<string, unknown>) => string,
  ): string {
    if (value === true) return t('bool.true');
    if (value === false) return t('bool.false');
    return t('bool.null');
  }
}

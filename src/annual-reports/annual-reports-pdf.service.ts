import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { I18nService } from 'nestjs-i18n';
import { TranslationService } from '../common/services/translation.service';
import {
  AppNotFoundException,
  AppBadRequestException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { CLUB_DIRECTIVA_ROLES } from '../common/constants/club-directiva-roles';
import { loadPdfKit } from '../common/utils/pdfkit-loader';
import {
  EMPTY_FIELD,
  drawPageFooters,
  ensureSpace,
  formatFigure,
  formatFlag,
  monthlyTextLines,
  type PdfTranslate,
} from '../common/pdf/report-pdf-helpers';
import { collapseYearLabel } from './year-label';
import { AnnualComputedData } from './annual-reports.service';
import { buildAnnualReportDownloadFilename } from '../monthly-reports/monthly-report-download-filename';
import { ClubRole } from '../common/authorization/roles';

// ============================================================
// Constants
// ============================================================

const BCP47: Record<string, string> = {
  es: 'es-MX',
  'pt-BR': 'pt-BR',
  en: 'en-US',
  fr: 'fr-FR',
};

const PAGE_MARGIN = 40;
const CONTENT_WIDTH = 612 - PAGE_MARGIN * 2;

function annualYearLabel(report: {
  computed_data: unknown;
  ecclesiastical_year: { start_date: Date; end_date: Date } | null;
}): string | null {
  const computed = report.computed_data;
  if (computed && typeof computed === 'object' && !Array.isArray(computed)) {
    const label = (computed as { year_label?: unknown }).year_label;
    if (typeof label === 'string' && label.trim()) {
      return collapseYearLabel(label);
    }
  }

  const start = report.ecclesiastical_year?.start_date;
  const end = report.ecclesiastical_year?.end_date;
  if (!(start instanceof Date) || !(end instanceof Date)) return null;

  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  return startYear === endYear ? String(startYear) : `${startYear}-${endYear}`;
}

@Injectable()
export class AnnualReportsPdfService {
  private readonly logger = new Logger(AnnualReportsPdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
    private readonly translationService: TranslationService,
  ) {}

  /**
   * Generates a PDF buffer for the given annual report.
   * Only works for reports with computed_data present.
   */
  async generatePdf(reportId: number): Promise<Buffer> {
    const report = await this.prisma.annual_reports.findUnique({
      where: { annual_report_id: reportId },
      include: {
        club: {
          include: {
            churches: { select: { name: true } },
            districts: { select: { name: true } },
          },
        },
        ecclesiastical_year: true,
      },
    });

    if (!report) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_REPORT_NOT_FOUND);
    }

    if (!report.computed_data) {
      throw new AppBadRequestException(ErrorCode.ANNUAL_REPORT_PDF_NOT_READY);
    }

    const locale = this.translationService.getCurrentLocale();
    const intlLocale = BCP47[locale] ?? 'es-MX';

    const t = (key: string, args?: Record<string, unknown>): string =>
      this.i18n.translate(`annual_reports.${key}`, {
        lang: locale,
        args,
      });

    const reportData = report as any;
    const computed = reportData.computed_data as AnnualComputedData;
    const club = reportData.club;
    const churchName = (club?.churches?.name as string) ?? 'N/A';
    const districtName = (club?.districts?.name as string) ?? 'N/A';
    const clubName = (club?.name as string) ?? 'N/A';
    const yearLabel = computed.year_label
      ? collapseYearLabel(computed.year_label)
      : String(
          reportData.ecclesiastical_year?.start_date?.getUTCFullYear() ?? 'N/A',
        );

    const PDFDocument = loadPdfKit();
    const doc = new PDFDocument({
      size: 'LETTER',
      bufferPages: true,
      margins: {
        top: PAGE_MARGIN,
        bottom: PAGE_MARGIN,
        left: PAGE_MARGIN,
        right: PAGE_MARGIN,
      },
      info: {
        Title: `${t('header.title')} - ${clubName} - ${yearLabel}`,
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

    // ── Header ──
    this.drawHeader(doc, clubName, districtName, churchName, yearLabel, t);

    // ── Section 1: Annual Summary ──
    this.drawSectionTitle(doc, t('section_titles.summary'));
    this.drawSummary(doc, computed, intlLocale, t);

    // ── Section 2: Teachings ──
    this.drawSectionTitle(doc, t('section_titles.teachings'));
    this.drawTeachings(doc, computed, t);

    // ── Section 3: Activities ──
    this.drawSectionTitle(doc, t('section_titles.activities'));
    this.drawActivities(doc, computed, t);

    // ── Section 4: Finances ──
    this.drawSectionTitle(doc, t('section_titles.finances'), 70);
    this.drawFinances(doc, computed, intlLocale, t);

    // ── Section 5: Missionary ──
    this.drawSectionTitle(doc, t('section_titles.missionary'));
    this.drawMissionary(doc, computed, intlLocale, t);

    // ── Section 6: Top achievers ──
    this.drawSectionTitle(doc, t('section_titles.top_achievers'));
    this.drawTopAchievers(doc, computed, t);

    this.drawDirectorInfo(doc, computed.directiva, t);
    this.drawFooter(doc, t);

    doc.end();
    return pdfReady;
  }

  async resolveDownloadFilename(reportId: number): Promise<string> {
    const report = await this.prisma.annual_reports.findUnique({
      where: { annual_report_id: reportId },
      select: {
        computed_data: true,
        ecclesiastical_year: {
          select: { start_date: true, end_date: true },
        },
        club: {
          select: {
            name: true,
            club_sections: {
              select: { club_types: { select: { name: true } } },
            },
          },
        },
      },
    });

    if (!report) {
      return `informe-anual-${reportId}.pdf`;
    }

    return buildAnnualReportDownloadFilename({
      clubName: report.club?.name,
      clubTypes: report.club?.club_sections.map(
        (section) => section.club_types.name,
      ),
      yearLabel: annualYearLabel(report),
    });
  }

  // ========================================
  // Private drawing helpers
  // ========================================

  private drawHeader(
    doc: PDFKit.PDFDocument,
    clubName: string,
    districtName: string,
    churchName: string,
    yearLabel: string,
    t: PdfTranslate,
  ) {
    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .text(t('header.title'), PAGE_MARGIN, PAGE_MARGIN, {
        width: CONTENT_WIDTH,
        align: 'center',
      });

    doc.moveDown(0.8);

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
      .text(`${t('header.year')}: `, col2X, y2, { continued: true });
    doc.font('Helvetica').text(yearLabel);

    doc.moveDown(1);
    this.drawHorizontalLine(doc);
  }

  /**
   * `minContentHeight` is the room the section body needs below the title, so
   * the title is never stranded at the bottom of a page.
   */
  private drawSectionTitle(
    doc: PDFKit.PDFDocument,
    title: string,
    minContentHeight = 60,
  ) {
    ensureSpace(doc, 40 + minContentHeight);

    doc.moveDown(0.5);
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#1a365d')
      .text(title, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.fillColor('#000000');
    doc.moveDown(0.3);

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

  private roleLabel(role: string, t: PdfTranslate): string {
    return (CLUB_DIRECTIVA_ROLES as readonly string[]).includes(role)
      ? t(`roles.${role}`)
      : role;
  }

  private drawSummary(
    doc: PDFKit.PDFDocument,
    computed: AnnualComputedData,
    intlLocale: string,
    t: PdfTranslate,
  ) {
    doc.fontSize(9).font('Helvetica');
    const monthly = computed.monthly_data;

    this.drawKeyValue(
      doc,
      t('summary.member_count'),
      String(computed.member_count ?? 0),
    );
    this.drawKeyValue(
      doc,
      t('summary.months_reported'),
      String(computed.months_reported ?? 0),
    );
    if (monthly) {
      this.drawKeyValue(
        doc,
        t('summary.monthly_basis_label'),
        monthly.months_submitted > 0
          ? monthly.months_submitted === 1
            ? t('summary.monthly_basis_one')
            : t('summary.monthly_basis', { count: monthly.months_submitted })
          : t('summary.monthly_basis_none'),
      );
    }

    if (computed.directiva && computed.directiva.length > 0) {
      doc.moveDown(0.3);
      doc
        .font('Helvetica-Bold')
        .text(`${t('summary.directiva')}:`, PAGE_MARGIN, doc.y);
      doc.font('Helvetica');
      for (const m of computed.directiva) {
        doc.text(
          `  ${this.roleLabel(m.role, t)}: ${m.name}`,
          PAGE_MARGIN + 10,
          doc.y,
        );
      }
    }

    doc.moveDown(0.3);
    doc
      .font('Helvetica-Bold')
      .text(`${t('summary.meetings_header')}:`, PAGE_MARGIN, doc.y);
    doc.font('Helvetica');
    this.drawKeyValue(
      doc,
      t('summary.planning_meetings'),
      formatFigure(monthly?.planning_meetings),
    );
    this.drawKeyValue(
      doc,
      t('summary.parent_meetings'),
      formatFigure(monthly?.parent_meetings),
    );

    this.drawTextLines(
      doc,
      `${t('summary.annual_achievements')}:`,
      monthlyTextLines(monthly?.annual_achievements_description, intlLocale),
    );
  }

  private drawTeachings(
    doc: PDFKit.PDFDocument,
    computed: AnnualComputedData,
    t: PdfTranslate,
  ) {
    doc.fontSize(9).font('Helvetica');
    this.drawKeyValue(
      doc,
      t('summary.honors_started'),
      String(computed.honors?.started ?? 0),
    );
    this.drawKeyValue(
      doc,
      t('summary.honors_completed'),
      String(computed.honors?.completed ?? 0),
    );
  }

  private drawActivities(
    doc: PDFKit.PDFDocument,
    computed: AnnualComputedData,
    t: PdfTranslate,
  ) {
    doc.fontSize(9).font('Helvetica');
    this.drawKeyValue(
      doc,
      t('summary.total_activities'),
      String(computed.activities?.total ?? 0),
    );
  }

  private drawFinances(
    doc: PDFKit.PDFDocument,
    computed: AnnualComputedData,
    intlLocale: string,
    t: PdfTranslate,
  ) {
    doc.fontSize(9).font('Helvetica');

    const finances = computed.finances ?? {
      income: 0,
      expenses: 0,
      balance: 0,
      total_balance: 0,
      transactions: 0,
    };
    const fmt = (n: number) =>
      `$${n.toLocaleString(intlLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const labelWidth = CONTENT_WIDTH * 0.6;
    const valueWidth = CONTENT_WIDTH * 0.4;

    const rows = [
      {
        label: t('finances.total_income'),
        value: fmt(finances.income),
        bold: false,
      },
      {
        label: t('finances.total_expenses'),
        value: fmt(finances.expenses),
        bold: false,
      },
      {
        label: t('finances.annual_balance'),
        value: fmt(finances.balance),
        bold: true,
      },
      {
        label: t('finances.total_balance'),
        value: fmt(finances.total_balance ?? 0),
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
      doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(row.label, PAGE_MARGIN, rowY, { width: labelWidth });
      doc.text(row.value, PAGE_MARGIN + labelWidth, rowY, {
        width: valueWidth,
        align: 'right',
      });
      rowY += 14;
    }

    doc.y = rowY;
  }

  private drawMissionary(
    doc: PDFKit.PDFDocument,
    computed: AnnualComputedData,
    intlLocale: string,
    t: PdfTranslate,
  ) {
    doc.fontSize(9).font('Helvetica');
    const monthly = computed.monthly_data;

    this.drawKeyValue(
      doc,
      t('missionary.baptized_this_year'),
      formatFigure(
        monthly?.baptized_this_year ?? computed.missionary?.baptized_total,
      ),
    );
    this.drawKeyValue(
      doc,
      t('missionary.total_baptized'),
      formatFigure(monthly?.total_baptized),
    );
    this.drawKeyValue(
      doc,
      t('missionary.camporees_attended'),
      formatFigure(monthly?.camporees_attended),
    );
    this.drawKeyValue(
      doc,
      t('missionary.all_investitures_completed'),
      formatFlag(monthly?.all_investitures_completed, t),
    );
    this.drawTextLines(
      doc,
      `${t('missionary.community_service')}:`,
      monthlyTextLines(monthly?.community_service_description, intlLocale),
    );
  }

  private drawTopAchievers(
    doc: PDFKit.PDFDocument,
    computed: AnnualComputedData,
    t: PdfTranslate,
  ) {
    doc.fontSize(9).font('Helvetica');

    if (computed.top_achievers && computed.top_achievers.length > 0) {
      doc.moveDown(0.3);
      doc
        .font('Helvetica-Bold')
        .text(`${t('ranking.top_achievers_header')}:`, PAGE_MARGIN, doc.y);
      doc.font('Helvetica');

      const tableY = doc.y + 4;
      const colWidths = [CONTENT_WIDTH * 0.6, CONTENT_WIDTH * 0.4];
      const colX = [PAGE_MARGIN, PAGE_MARGIN + colWidths[0]];

      doc.font('Helvetica-Bold').fontSize(8);
      doc.text(t('ranking.member'), colX[0], tableY);
      doc.text(t('ranking.honors'), colX[1], tableY);
      doc.font('Helvetica').fontSize(8);

      let rowY = tableY + 12;
      for (const achiever of computed.top_achievers.slice(0, 10)) {
        if (rowY + 12 > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          rowY = doc.y;
        }
        doc.text(achiever.name, colX[0], rowY, { width: colWidths[0] - 5 });
        doc.text(String(achiever.honors_count), colX[1], rowY, {
          width: colWidths[1] - 5,
        });
        rowY += 12;
      }

      doc.y = rowY;
    }
  }

  /** Names of the directiva members whose role is `director`, in order. */
  private directorNames(
    directiva: { role: string; name: string }[] | null | undefined,
  ): string[] {
    return (directiva ?? [])
      .filter((member) => member.role === ClubRole.DIRECTOR && member.name)
      .map((member) => member.name);
  }

  private drawDirectorInfo(
    doc: PDFKit.PDFDocument,
    directiva: { role: string; name: string }[] | null | undefined,
    t: PdfTranslate,
  ) {
    ensureSpace(doc, 90);
    doc.moveDown(1.5);
    this.drawHorizontalLine(doc);
    doc.moveDown(0.5);

    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .text(t('club_director.header'), PAGE_MARGIN, doc.y);
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica');

    const names = this.directorNames(directiva);
    if (names.length === 0) {
      doc.text(t('club_director.fallback'), PAGE_MARGIN, doc.y);
      return;
    }
    for (const name of names) {
      doc.text(name, PAGE_MARGIN, doc.y);
    }
  }

  private drawFooter(doc: PDFKit.PDFDocument, t: PdfTranslate) {
    drawPageFooters(doc, (current, total) => t('footer', { current, total }), {
      x: PAGE_MARGIN,
      width: CONTENT_WIDTH,
    });
  }

  /** A label followed by one line per entry, or a dash when there are none. */
  private drawTextLines(
    doc: PDFKit.PDFDocument,
    label: string,
    lines: string[],
  ) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').text(label, PAGE_MARGIN, doc.y);
    doc.font('Helvetica');
    for (const line of lines.length > 0 ? lines : [EMPTY_FIELD]) {
      doc.text(line, PAGE_MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
    }
  }

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
}

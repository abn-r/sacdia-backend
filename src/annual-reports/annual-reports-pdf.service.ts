import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { I18nService } from 'nestjs-i18n';
import { TranslationService } from '../common/services/translation.service';
import {
  AppNotFoundException,
  AppBadRequestException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import PDFDocument from 'pdfkit';
import { AnnualComputedData } from './annual-reports.service';

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
        finalized_by_user: {
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
      }) as string;

    const reportData = report as any;
    const computed = reportData.computed_data as AnnualComputedData;
    const manual = (reportData.manual_data ?? {}) as Record<string, unknown>;
    const club = reportData.club;
    const churchName = (club?.churches?.name as string) ?? 'N/A';
    const districtName = (club?.districts?.name as string) ?? 'N/A';
    const clubName = (club?.name as string) ?? 'N/A';
    const yearLabel =
      computed.year_label ??
      String(
        reportData.ecclesiastical_year?.start_date?.getFullYear() ?? 'N/A',
      );

    const doc = new PDFDocument({
      size: 'LETTER',
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
    this.drawSummary(doc, computed, manual, t);

    // ── Section 2: Teachings ──
    this.drawSectionTitle(doc, t('section_titles.teachings'));
    this.drawTeachings(doc, computed, t);

    // ── Section 3: Activities ──
    this.drawSectionTitle(doc, t('section_titles.activities'));
    this.drawActivities(doc, computed, t);

    doc.addPage();

    // ── Section 4: Finances ──
    this.drawSectionTitle(doc, t('section_titles.finances'));
    this.drawFinances(doc, computed, intlLocale, t);

    // ── Section 5: Missionary ──
    this.drawSectionTitle(doc, t('section_titles.missionary'));
    this.drawMissionary(doc, computed, manual, t);

    // ── Section 6: Ranking ──
    this.drawSectionTitle(doc, t('section_titles.ranking'));
    this.drawRanking(doc, computed, t);

    this.drawDirectorInfo(doc, reportData.finalized_by_user, t);
    this.drawFooter(doc, t);

    doc.end();
    return pdfReady;
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
    t: (key: string, args?: Record<string, unknown>) => string,
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

  private drawSectionTitle(doc: PDFKit.PDFDocument, title: string) {
    if (doc.y > 680) doc.addPage();

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

  private drawSummary(
    doc: PDFKit.PDFDocument,
    computed: AnnualComputedData,
    manual: Record<string, unknown>,
    t: (key: string, args?: Record<string, unknown>) => string,
  ) {
    doc.fontSize(9).font('Helvetica');

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
    this.drawKeyValue(
      doc,
      t('summary.total_activities'),
      String(computed.activities?.total ?? 0),
    );
    this.drawKeyValue(
      doc,
      t('summary.honors_completed'),
      String(computed.honors?.completed ?? 0),
    );
    this.drawKeyValue(
      doc,
      t('summary.honors_started'),
      String(computed.honors?.started ?? 0),
    );

    const baptized =
      (manual['baptized_this_year'] as number | undefined) ??
      computed.missionary?.baptized_total ??
      0;
    this.drawKeyValue(doc, t('summary.baptized_total'), String(baptized));

    if (computed.directiva && computed.directiva.length > 0) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').text('Directiva:', PAGE_MARGIN, doc.y);
      doc.font('Helvetica');
      for (const m of computed.directiva) {
        doc.text(`  ${m.role}: ${m.name}`, PAGE_MARGIN + 10, doc.y);
      }
    }

    if (manual['annual_achievements_description']) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').text('Logros del año:', PAGE_MARGIN, doc.y);
      doc
        .font('Helvetica')
        .text(
          String(manual['annual_achievements_description']),
          PAGE_MARGIN + 10,
          doc.y,
          { width: CONTENT_WIDTH - 10 },
        );
    }
  }

  private drawTeachings(
    doc: PDFKit.PDFDocument,
    computed: AnnualComputedData,
    t: (key: string, args?: Record<string, unknown>) => string,
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
    t: (key: string, args?: Record<string, unknown>) => string,
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
    t: (key: string, args?: Record<string, unknown>) => string,
  ) {
    doc.fontSize(9).font('Helvetica');

    const finances = computed.finances ?? {
      income: 0,
      expenses: 0,
      balance: 0,
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
    manual: Record<string, unknown>,
    t: (key: string, args?: Record<string, unknown>) => string,
  ) {
    doc.fontSize(9).font('Helvetica');

    const baptized =
      (manual['baptized_this_year'] as number | undefined) ??
      computed.missionary?.baptized_total ??
      0;
    const totalBaptized = manual['total_baptized'] as number | undefined;

    this.drawKeyValue(doc, 'Bautizados en el año', String(baptized));
    if (totalBaptized !== undefined) {
      this.drawKeyValue(
        doc,
        'Total bautizados acumulado',
        String(totalBaptized),
      );
    }

    const camporees = manual['camporees_attended'] as number | undefined;
    if (camporees !== undefined) {
      this.drawKeyValue(doc, 'Campamentos asistidos', String(camporees));
    }

    const allInvestitures = manual['all_investitures_completed'];
    if (allInvestitures !== undefined) {
      this.drawKeyValue(
        doc,
        'Todas las investiduras completadas',
        allInvestitures ? 'Sí' : 'No',
      );
    }

    if (manual['community_service_description']) {
      doc.moveDown(0.3);
      doc
        .font('Helvetica-Bold')
        .text('Servicio comunitario:', PAGE_MARGIN, doc.y);
      doc
        .font('Helvetica')
        .text(
          String(manual['community_service_description']),
          PAGE_MARGIN + 10,
          doc.y,
          { width: CONTENT_WIDTH - 10 },
        );
    }
  }

  private drawRanking(
    doc: PDFKit.PDFDocument,
    computed: AnnualComputedData,
    t: (key: string, args?: Record<string, unknown>) => string,
  ) {
    doc.fontSize(9).font('Helvetica');

    if (
      computed.ranking_percentile !== null &&
      computed.ranking_percentile !== undefined
    ) {
      this.drawKeyValue(
        doc,
        t('ranking.percentile'),
        `${computed.ranking_percentile}%`,
      );
    }

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
      doc.text('Miembro', colX[0], tableY);
      doc.text('Especialidades', colX[1], tableY);
      doc.font('Helvetica').fontSize(8);

      let rowY = tableY + 12;
      for (const achiever of computed.top_achievers.slice(0, 10)) {
        doc.text(achiever.name, colX[0], rowY, { width: colWidths[0] - 5 });
        doc.text(String(achiever.honors_count), colX[1], rowY, {
          width: colWidths[1] - 5,
        });
        rowY += 12;
      }

      doc.y = rowY;
    }
  }

  private drawDirectorInfo(
    doc: PDFKit.PDFDocument,
    finalizer: {
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

    if (finalizer) {
      const fullName = [
        finalizer.name,
        finalizer.paternal_last_name,
        finalizer.maternal_last_name,
      ]
        .filter(Boolean)
        .join(' ');
      this.drawKeyValue(doc, t('secretary.name'), fullName || 'N/A');
      this.drawKeyValue(doc, t('secretary.email'), finalizer.email ?? 'N/A');
    } else {
      doc.text(t('secretary.fallback'), PAGE_MARGIN, doc.y);
    }
  }

  private drawFooter(
    doc: PDFKit.PDFDocument,
    t: (key: string, args?: Record<string, unknown>) => string,
  ) {
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

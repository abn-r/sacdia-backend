import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import PDFDocument from 'pdfkit';
import { Prisma } from '@prisma/client';
import {
  AppBadRequestException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { TranslationService } from '../common/services/translation.service';
import { PrismaService } from '../prisma/prisma.service';

interface DirectivaMember {
  role?: string | null;
  user_id?: string | null;
  name?: string | null;
}

interface HonorDetail {
  honor_name?: string | null;
  user_name?: string | null;
  validated?: boolean | null;
  date?: string | null;
}

interface ActivityItem {
  activity_id?: number | string | null;
  name?: string | null;
  type?: string | null;
  date?: string | null;
}

export interface MonthlyReportSnapshotData {
  member_count?: number | null;
  directiva?: DirectivaMember[] | null;
  honors?: {
    started?: number | null;
    completed?: number | null;
    details?: HonorDetail[] | null;
  } | null;
  activities?: {
    total?: number | null;
    list?: ActivityItem[] | null;
  } | null;
  finances?: {
    income?: number | null;
    expenses?: number | null;
    balance?: number | null;
    total_balance?: number | null;
    transactions?: number | null;
  } | null;
  meeting_days?: string | null;
}

export interface MonthlyReportManualData {
  planning_meetings?: number | null;
  parent_meetings?: number | null;
  youth_council_attendance?: number | null;
  church_board_attendance?: number | null;
  soul_target?: number | null;
  unbaptized_members?: number | null;
  bible_studies_receiving?: number | null;
  has_weekly_bible_instruction?: boolean | null;
  bible_studies_given?: boolean | null;
  literature_distributed?: boolean | null;
  baptized_this_month?: number | null;
  total_baptized?: number | null;
  club_participation_description?: string | null;
  community_service_description?: string | null;
  certificates_delivered?: boolean | null;
  members_have_booklet?: boolean | null;
  booklet_requirements_signed?: boolean | null;
}

interface MonthlyReportPdfRecord {
  monthly_report_id: string;
  club_enrollment_id: string;
  month: number;
  year: number;
  status: string;
  snapshot_data: Prisma.JsonValue | null;
  manual_data?: MonthlyReportManualData | null;
  club_enrollment?: {
    club_section?: {
      club_types?: { name?: string | null } | null;
      clubs?: {
        name?: string | null;
        churches?: { name?: string | null } | null;
        districts?: { name?: string | null } | null;
      } | null;
    } | null;
  } | null;
  submitter?: {
    user_id: string;
    name?: string | null;
    paternal_last_name?: string | null;
    maternal_last_name?: string | null;
    email?: string | null;
  } | null;
}

interface PdfModel {
  monthName: string;
  year: string;
  clubName: string;
  clubType: string;
  churchName: string;
  districtName: string;
  snapshot: MonthlyReportSnapshotData;
  manual: MonthlyReportManualData;
  submitterName: string;
  submitterEmail: string;
}

type Translate = (key: string, args?: Record<string, unknown>) => string;

const LETTER_WIDTH = 612;
const LETTER_HEIGHT = 792;
const PAGE_X = 32;
const CONTENT_WIDTH = LETTER_WIDTH - PAGE_X * 2;
const FOOTER_Y = 750;

const PDF_COLORS = {
  primary: '#D94A3B',
  primarySoft: '#FDE8E6',
  secondary: '#4FBF9F',
  accent: '#FBBD5E',
  ink: '#0F172A',
  muted: '#64748B',
  tertiary: '#94A3B8',
  border: '#E2E8F0',
  surface: '#F8FAFC',
  white: '#FFFFFF',
};

const BCP47: Record<string, string> = {
  es: 'es-MX',
  'pt-BR': 'pt-BR',
  en: 'en-US',
  fr: 'fr-FR',
};

@Injectable()
export class MonthlyReportsPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
    private readonly translationService: TranslationService,
  ) {}

  async generatePdf(
    reportId: string,
    snapshotOverride?: MonthlyReportSnapshotData,
  ): Promise<Buffer> {
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

    if (
      !snapshotOverride &&
      !['generated', 'submitted'].includes(report.status)
    ) {
      throw new AppBadRequestException(ErrorCode.REPORT_PDF_NOT_GENERATED);
    }

    const snapshotData = snapshotOverride ?? report.snapshot_data;
    if (!snapshotData) {
      throw new AppBadRequestException(ErrorCode.REPORT_PDF_NO_SNAPSHOT);
    }

    const locale = this.translationService.getCurrentLocale();
    const t: Translate = (key, args) =>
      String(
        this.i18n.translate(`monthly_reports.${key}`, {
          lang: locale,
          args,
        }),
      );
    const model = this.toPdfModel(
      {
        ...report,
        snapshot_data: snapshotData,
      },
      t,
    );

    return this.renderPdf(model, BCP47[locale] ?? 'es-MX', t);
  }

  private toPdfModel(report: MonthlyReportPdfRecord, t: Translate): PdfModel {
    const section = report.club_enrollment?.club_section;
    const club = section?.clubs;
    const submitterName = [
      report.submitter?.name,
      report.submitter?.paternal_last_name,
      report.submitter?.maternal_last_name,
    ]
      .map((value) => this.blank(value))
      .filter(Boolean)
      .join(' ');

    return {
      monthName: t(`month_names.${report.month}`),
      year: this.blank(report.year),
      clubName: this.blank(club?.name),
      clubType: this.blank(section?.club_types?.name),
      churchName: this.blank(club?.churches?.name),
      districtName: this.blank(club?.districts?.name),
      snapshot: this.normalizeSnapshotData(report.snapshot_data),
      manual: report.manual_data ?? {},
      submitterName,
      submitterEmail: this.blank(report.submitter?.email),
    };
  }

  private normalizeSnapshotData(
    snapshot: Prisma.JsonValue | null,
  ): MonthlyReportSnapshotData {
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot)
    ) {
      return {};
    }

    return snapshot;
  }

  private async renderPdf(
    model: PdfModel,
    intlLocale: string,
    t: Translate,
  ): Promise<Buffer> {
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 0,
      bufferPages: true,
      autoFirstPage: false,
      info: {
        Title: `${t('header.title')} - ${model.clubName} - ${model.monthName} ${model.year}`,
        Author: 'SACDIA',
        Subject: t('header.title'),
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const ready = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    doc.addPage({ size: 'LETTER', margin: 0 });
    this.drawPageOne(doc, model, t);
    doc.addPage({ size: 'LETTER', margin: 0 });
    this.drawPageTwo(doc, model, intlLocale, t);
    doc.addPage({ size: 'LETTER', margin: 0 });
    this.drawPageThree(doc, model, t);
    this.drawFooters(doc, t);
    doc.end();

    return ready;
  }

  private drawPageOne(
    doc: PDFKit.PDFDocument,
    model: PdfModel,
    t: Translate,
  ): void {
    this.drawDocumentHeader(doc, model, t);
    this.drawSectionHeader(doc, '1', t('section_titles.administration'), 154);
    this.drawAdministration(doc, model, t, 184);
    this.drawSectionHeader(doc, '2', t('section_titles.teachings'), 428);
    this.drawTeachings(doc, model, t, 458);
  }

  private drawPageTwo(
    doc: PDFKit.PDFDocument,
    model: PdfModel,
    intlLocale: string,
    t: Translate,
  ): void {
    this.drawCompactHeader(doc, model, t);
    this.drawSectionHeader(doc, '3', t('section_titles.activities'), 92);
    this.drawActivities(doc, model, intlLocale, t, 122);
    this.drawSectionHeader(doc, '4', t('section_titles.finances'), 402);
    this.drawFinances(doc, model, intlLocale, t, 432);
  }

  private drawPageThree(
    doc: PDFKit.PDFDocument,
    model: PdfModel,
    t: Translate,
  ): void {
    this.drawCompactHeader(doc, model, t);
    this.drawSectionHeader(doc, '5', t('section_titles.missionary'), 92);
    this.drawMissionary(doc, model, t, 122);
    this.drawSectionHeader(doc, '6', t('section_titles.service'), 420);
    this.drawService(doc, model, t, 450);
    this.drawSignatures(doc, model, t, 582);
  }

  private drawDocumentHeader(
    doc: PDFKit.PDFDocument,
    model: PdfModel,
    t: Translate,
  ): void {
    doc
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor(PDF_COLORS.primary)
      .text(t('header.title'), PAGE_X + 90, 28, {
        width: CONTENT_WIDTH - 180,
        align: 'center',
      });
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(PDF_COLORS.muted)
      .text(
        t('header.club_type', { type: model.clubType }),
        PAGE_X + 90,
        54,
        { width: CONTENT_WIDTH - 180, align: 'center' },
      );

    const fields = [
      [t('header.district'), model.districtName],
      [t('header.church'), model.churchName],
      [t('header.club'), model.clubName],
      [t('header.month'), `${model.monthName} ${model.year}`.trim()],
    ];
    fields.forEach(([label, value], index) => {
      const x = PAGE_X + (index % 2) * (CONTENT_WIDTH / 2);
      const y = 88 + Math.floor(index / 2) * 30;
      this.drawFieldLine(doc, label, value, x, y, CONTENT_WIDTH / 2 - 12);
    });
  }

  private drawCompactHeader(
    doc: PDFKit.PDFDocument,
    model: PdfModel,
    t: Translate,
  ): void {
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(PDF_COLORS.primary)
      .text(t('header.title'), PAGE_X, 28, { width: CONTENT_WIDTH * 0.6 });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(PDF_COLORS.muted)
      .text(
        `${model.clubName} · ${model.monthName} ${model.year}`,
        PAGE_X + CONTENT_WIDTH * 0.55,
        30,
        { width: CONTENT_WIDTH * 0.45, align: 'right' },
      );
    doc
      .moveTo(PAGE_X, 54)
      .lineTo(PAGE_X + CONTENT_WIDTH, 54)
      .lineWidth(1)
      .strokeColor(PDF_COLORS.primary)
      .stroke();
  }

  private drawSectionHeader(
    doc: PDFKit.PDFDocument,
    number: string,
    title: string,
    y: number,
  ): void {
    doc.circle(PAGE_X + 11, y + 11, 11).fill(PDF_COLORS.primary);
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(PDF_COLORS.white)
      .text(number, PAGE_X + 3, y + 6, { width: 16, align: 'center' });
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(PDF_COLORS.primary)
      .text(title.replace(/^\d+\.\s*/, ''), PAGE_X + 32, y + 4, {
        width: 220,
      });
    doc
      .moveTo(PAGE_X + 260, y + 11)
      .lineTo(PAGE_X + CONTENT_WIDTH, y + 11)
      .lineWidth(0.8)
      .strokeColor(PDF_COLORS.primary)
      .stroke();
  }

  private drawAdministration(
    doc: PDFKit.PDFDocument,
    model: PdfModel,
    t: Translate,
    y: number,
  ): void {
    const columnWidth = (CONTENT_WIDTH - 12) / 2;
    this.drawPanel(doc, PAGE_X, y, columnWidth, 224, t('administration.directiva'));
    const leaders = model.snapshot.directiva ?? [];
    for (let index = 0; index < 5; index += 1) {
      const leader = leaders[index];
      const role = leader?.role
        ? t(`role_labels.${leader.role}`)
        : '';
      this.drawFieldLine(
        doc,
        role,
        this.blank(leader?.name),
        PAGE_X + 10,
        y + 34 + index * 32,
        columnWidth - 20,
      );
    }
    if (leaders.length > 5) {
      this.drawOverflowNote(doc, PAGE_X + 10, y + 198, leaders.length - 5);
    }

    const rightX = PAGE_X + columnWidth + 12;
    const metrics: Array<[string, unknown]> = [
      [t('administration.member_count'), model.snapshot.member_count],
      [t('administration.meeting_days'), model.snapshot.meeting_days],
      [t('administration.planning_meetings'), model.manual.planning_meetings],
      [t('administration.parent_meetings'), model.manual.parent_meetings],
      [
        t('administration.youth_council_attendance'),
        model.manual.youth_council_attendance,
      ],
      [
        t('administration.church_board_attendance'),
        model.manual.church_board_attendance,
      ],
    ];
    metrics.forEach(([label, value], index) => {
      const cardX = rightX + (index % 2) * (columnWidth / 2 + 3);
      const cardY = y + Math.floor(index / 2) * 74;
      this.drawMetricCard(
        doc,
        cardX,
        cardY,
        columnWidth / 2 - 3,
        66,
        label,
        this.blank(value),
      );
    });
  }

  private drawTeachings(
    doc: PDFKit.PDFDocument,
    model: PdfModel,
    t: Translate,
    y: number,
  ): void {
    this.drawMetricCard(
      doc,
      PAGE_X,
      y,
      160,
      50,
      t('teachings.honors_started'),
      this.blank(model.snapshot.honors?.started),
    );
    this.drawMetricCard(
      doc,
      PAGE_X + 172,
      y,
      160,
      50,
      t('teachings.honors_completed'),
      this.blank(model.snapshot.honors?.completed),
    );

    const details = model.snapshot.honors?.details ?? [];
    this.drawTable(
      doc,
      PAGE_X,
      y + 62,
      CONTENT_WIDTH,
      [
        { label: t('teachings.honor_column'), width: 0.4 },
        { label: t('teachings.member_column'), width: 0.38 },
        { label: t('teachings.status_column'), width: 0.22 },
      ],
      details.map((detail) => [
        this.blank(detail.honor_name),
        this.blank(detail.user_name),
        detail.validated == null
          ? ''
          : detail.validated
            ? t('teachings.completed')
            : t('teachings.in_progress'),
      ]),
      6,
    );
  }

  private drawActivities(
    doc: PDFKit.PDFDocument,
    model: PdfModel,
    intlLocale: string,
    t: Translate,
    y: number,
  ): void {
    this.drawMetricCard(
      doc,
      PAGE_X,
      y,
      170,
      50,
      t('activities.total'),
      this.blank(model.snapshot.activities?.total),
    );
    const activities = model.snapshot.activities?.list ?? [];
    this.drawTable(
      doc,
      PAGE_X,
      y + 62,
      CONTENT_WIDTH,
      [
        { label: t('activities.date_column'), width: 0.2 },
        { label: t('activities.activity_column'), width: 0.5 },
        { label: t('activities.type_column'), width: 0.3 },
      ],
      activities.map((activity) => [
        this.formatDate(activity.date, intlLocale),
        this.blank(activity.name),
        this.blank(activity.type),
      ]),
      8,
    );
  }

  private drawFinances(
    doc: PDFKit.PDFDocument,
    model: PdfModel,
    intlLocale: string,
    t: Translate,
    y: number,
  ): void {
    const finances = model.snapshot.finances ?? {};
    const metrics: Array<[string, unknown]> = [
      [t('finances.total_income'), finances.income],
      [t('finances.total_expenses'), finances.expenses],
      [t('finances.month_balance'), finances.balance],
      [t('finances.club_total_balance'), finances.total_balance],
    ];
    metrics.forEach(([label, value], index) => {
      this.drawMetricCard(
        doc,
        PAGE_X + index * 138,
        y,
        126,
        62,
        label,
        this.formatMoney(value, intlLocale),
      );
    });
    this.drawPanel(
      doc,
      PAGE_X,
      y + 76,
      CONTENT_WIDTH,
      126,
      t('finances.transaction_count'),
    );
    this.drawFieldLine(
      doc,
      t('finances.transaction_count'),
      this.blank(finances.transactions),
      PAGE_X + 14,
      y + 116,
      220,
    );
  }

  private drawMissionary(
    doc: PDFKit.PDFDocument,
    model: PdfModel,
    t: Translate,
    y: number,
  ): void {
    const fields: Array<[string, string]> = [
      [t('missionary.soul_target'), this.blank(model.manual.soul_target)],
      [
        t('missionary.unbaptized_members'),
        this.blank(model.manual.unbaptized_members),
      ],
      [
        t('missionary.receiving_bible_studies'),
        this.blank(model.manual.bible_studies_receiving),
      ],
      [
        t('missionary.weekly_bible_instruction'),
        this.boolLabel(model.manual.has_weekly_bible_instruction, t),
      ],
      [
        t('missionary.bible_studies_given'),
        this.boolLabel(model.manual.bible_studies_given, t),
      ],
      [
        t('missionary.literature_distributed'),
        this.boolLabel(model.manual.literature_distributed, t),
      ],
      [
        t('missionary.baptized_this_month'),
        this.blank(model.manual.baptized_this_month),
      ],
      [
        t('missionary.baptized_total'),
        this.blank(model.manual.total_baptized),
      ],
    ];
    fields.forEach(([label, value], index) => {
      const x = PAGE_X + (index % 2) * (CONTENT_WIDTH / 2 + 4);
      const fieldY = y + Math.floor(index / 2) * 42;
      this.drawFieldLine(doc, label, value, x, fieldY, CONTENT_WIDTH / 2 - 8);
    });
    this.drawPanel(
      doc,
      PAGE_X,
      y + 176,
      CONTENT_WIDTH,
      92,
      t('missionary.club_participation'),
    );
    this.drawWrappedValue(
      doc,
      model.manual.club_participation_description,
      PAGE_X + 10,
      y + 207,
      CONTENT_WIDTH - 20,
      48,
    );
  }

  private drawService(
    doc: PDFKit.PDFDocument,
    model: PdfModel,
    t: Translate,
    y: number,
  ): void {
    this.drawPanel(
      doc,
      PAGE_X,
      y,
      CONTENT_WIDTH * 0.58,
      112,
      t('service.header'),
    );
    this.drawWrappedValue(
      doc,
      model.manual.community_service_description,
      PAGE_X + 10,
      y + 32,
      CONTENT_WIDTH * 0.58 - 20,
      70,
    );
    const rightX = PAGE_X + CONTENT_WIDTH * 0.61;
    const fields: Array<[string, string]> = [
      [
        t('missionary.certificates_delivered'),
        this.boolLabel(model.manual.certificates_delivered, t),
      ],
      [
        t('missionary.members_have_booklet'),
        this.boolLabel(model.manual.members_have_booklet, t),
      ],
      [
        t('missionary.booklet_requirements_signed'),
        this.boolLabel(model.manual.booklet_requirements_signed, t),
      ],
    ];
    fields.forEach(([label, value], index) => {
      this.drawFieldLine(
        doc,
        label,
        value,
        rightX,
        y + index * 37,
        CONTENT_WIDTH * 0.39,
      );
    });
  }

  private drawSignatures(
    doc: PDFKit.PDFDocument,
    model: PdfModel,
    t: Translate,
    y: number,
  ): void {
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(PDF_COLORS.ink)
      .text(t('secretary.header'), PAGE_X, y);
    this.drawFieldLine(
      doc,
      t('secretary.name'),
      model.submitterName,
      PAGE_X,
      y + 26,
      CONTENT_WIDTH / 2 - 10,
    );
    this.drawFieldLine(
      doc,
      t('secretary.email'),
      model.submitterEmail,
      PAGE_X + CONTENT_WIDTH / 2 + 10,
      y + 26,
      CONTENT_WIDTH / 2 - 10,
    );
    this.drawFieldLine(doc, '', '', PAGE_X, y + 82, CONTENT_WIDTH / 2 - 10);
    this.drawFieldLine(
      doc,
      '',
      '',
      PAGE_X + CONTENT_WIDTH / 2 + 10,
      y + 82,
      CONTENT_WIDTH / 2 - 10,
    );
  }

  private drawPanel(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    height: number,
    title: string,
  ): void {
    doc
      .roundedRect(x, y, width, height, 4)
      .lineWidth(0.8)
      .strokeColor(PDF_COLORS.border)
      .stroke();
    doc.rect(x, y, width, 24).fill(PDF_COLORS.primarySoft);
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(PDF_COLORS.ink)
      .text(title, x + 8, y + 8, { width: width - 16, height: 10 });
  }

  private drawMetricCard(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    value: string,
  ): void {
    doc
      .roundedRect(x, y, width, height, 4)
      .lineWidth(0.8)
      .strokeColor(PDF_COLORS.border)
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(PDF_COLORS.muted)
      .text(label, x + 8, y + 8, {
        width: width - 16,
        height: 20,
        ellipsis: true,
      });
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(PDF_COLORS.ink)
      .text(value, x + 8, y + height - 25, {
        width: width - 16,
        height: 18,
        ellipsis: true,
      });
  }

  private drawTable(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    columns: Array<{ label: string; width: number }>,
    rows: string[][],
    maxRows: number,
  ): void {
    const headerHeight = 22;
    const rowHeight = 22;
    let columnX = x;
    columns.forEach((column) => {
      const columnWidth = width * column.width;
      doc.rect(columnX, y, columnWidth, headerHeight).fill(PDF_COLORS.primarySoft);
      doc
        .rect(columnX, y, columnWidth, headerHeight)
        .lineWidth(0.6)
        .strokeColor(PDF_COLORS.border)
        .stroke();
      doc
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor(PDF_COLORS.ink)
        .text(column.label, columnX + 5, y + 7, {
          width: columnWidth - 10,
          height: 10,
          ellipsis: true,
        });
      columnX += columnWidth;
    });

    const visibleRows = rows.slice(0, maxRows);
    while (visibleRows.length < maxRows) visibleRows.push([]);
    visibleRows.forEach((row, rowIndex) => {
      columnX = x;
      columns.forEach((column, columnIndex) => {
        const columnWidth = width * column.width;
        const rowY = y + headerHeight + rowIndex * rowHeight;
        doc
          .rect(columnX, rowY, columnWidth, rowHeight)
          .lineWidth(0.6)
          .strokeColor(PDF_COLORS.border)
          .stroke();
        doc
          .font('Helvetica')
          .fontSize(7)
          .fillColor(PDF_COLORS.ink)
          .text(row[columnIndex] ?? '', columnX + 5, rowY + 7, {
            width: columnWidth - 10,
            height: 10,
            ellipsis: true,
          });
        columnX += columnWidth;
      });
    });
    if (rows.length > maxRows) {
      this.drawOverflowNote(
        doc,
        x,
        y + headerHeight + maxRows * rowHeight + 4,
        rows.length - maxRows,
      );
    }
  }

  private drawFieldLine(
    doc: PDFKit.PDFDocument,
    label: string,
    value: string,
    x: number,
    y: number,
    width: number,
  ): void {
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(PDF_COLORS.muted)
      .text(label, x, y, { width, height: 10, ellipsis: true });
    doc
      .moveTo(x, y + 24)
      .lineTo(x + width, y + 24)
      .lineWidth(0.6)
      .strokeColor(PDF_COLORS.tertiary)
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(PDF_COLORS.ink)
      .text(value, x, y + 12, { width, height: 10, ellipsis: true });
  }

  private drawWrappedValue(
    doc: PDFKit.PDFDocument,
    value: unknown,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(PDF_COLORS.ink)
      .text(this.blank(value), x, y, { width, height, ellipsis: true });
  }

  private drawOverflowNote(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    count: number,
  ): void {
    doc
      .font('Helvetica-Oblique')
      .fontSize(7)
      .fillColor(PDF_COLORS.muted)
      .text(`+${count}`, x, y, { width: 80 });
  }

  private drawFooters(doc: PDFKit.PDFDocument, t: Translate): void {
    const range = doc.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page += 1) {
      doc.switchToPage(page);
      doc
        .moveTo(PAGE_X, FOOTER_Y - 8)
        .lineTo(PAGE_X + CONTENT_WIDTH, FOOTER_Y - 8)
        .lineWidth(0.8)
        .strokeColor(PDF_COLORS.primary)
        .stroke();
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor(PDF_COLORS.muted)
        .text(
          t('footer', { current: page + 1, total: range.count }),
          PAGE_X,
          FOOTER_Y,
          { width: CONTENT_WIDTH, align: 'center' },
        );
    }
  }

  private formatMoney(value: unknown, locale: string): string {
    if (value === null || value === undefined || value === '') return '';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '';
    return `$${numeric.toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  private formatDate(value: unknown, locale: string): string {
    const text = this.blank(value);
    if (!text) return '';
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(locale);
  }

  private boolLabel(value: unknown, t: Translate): string {
    if (value === null || value === undefined) return '';
    return value ? t('bool.true') : t('bool.false');
  }

  private blank(value: unknown): string {
    return value === null || value === undefined ? '' : String(value);
  }
}

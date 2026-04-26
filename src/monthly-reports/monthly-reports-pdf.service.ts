import {
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AppNotFoundException,
  AppBadRequestException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
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

const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const ROLE_LABELS: Record<string, string> = {
  director: 'Director(a)',
  subdirector: 'Subdirector(a)',
  secretario: 'Secretario(a)',
  tesorero: 'Tesorero(a)',
};

const PAGE_MARGIN = 40;
const CONTENT_WIDTH = 612 - PAGE_MARGIN * 2; // Letter width minus margins

@Injectable()
export class MonthlyReportsPdfService {
  private readonly logger = new Logger(MonthlyReportsPdfService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generates a PDF buffer for the given monthly report.
   * Only works for reports with status 'generated' or 'submitted'.
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
    const monthName = MONTH_NAMES[report.month - 1] ?? `Mes ${report.month}`;

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
        Title: `Informe Mensual - ${clubName} - ${monthName} ${report.year}`,
        Author: 'SACDIA',
        Subject: 'Informe Mensual del Club',
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
    );

    // Section 1: Administracion
    this.drawSectionTitle(doc, '1. ADMINISTRACION');
    this.drawAdministracion(doc, snapshot, manual);

    // Section 2: Ensenanzas
    this.drawSectionTitle(doc, '2. ENSENANZAS');
    this.drawEnsenanzas(doc, snapshot);

    // Section 3: Actividades del Club
    this.drawSectionTitle(doc, '3. ACTIVIDADES DEL CLUB');
    this.drawActividades(doc, snapshot);

    // ======== PAGE 2 (BACK) ========
    doc.addPage();

    // Section 4: Finanzas
    this.drawSectionTitle(doc, '4. FINANZAS');
    this.drawFinanzas(doc, snapshot);

    // Section 5: Actividad Misionera
    this.drawSectionTitle(doc, '5. ACTIVIDAD MISIONERA');
    this.drawActividadMisionera(doc, manual);

    // Section 6: Servicio
    this.drawSectionTitle(doc, '6. SERVICIO');
    this.drawServicio(doc, manual);

    // Secretary info
    this.drawSecretaryInfo(doc, reportData.submitter);

    // Footer on both pages
    this.drawFooter(doc);

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
  ) {
    // Title
    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .text('INFORME MENSUAL DEL CLUB', PAGE_MARGIN, PAGE_MARGIN, {
        width: CONTENT_WIDTH,
        align: 'center',
      });

    doc.moveDown(0.3);

    // Club type subtitle
    doc
      .fontSize(12)
      .font('Helvetica')
      .text(`Club de ${clubType}`, { width: CONTENT_WIDTH, align: 'center' });

    doc.moveDown(0.8);

    // Info grid
    const y = doc.y;
    const col1X = PAGE_MARGIN;
    const col2X = PAGE_MARGIN + CONTENT_WIDTH / 2 + 10;

    doc.fontSize(10).font('Helvetica-Bold');

    doc.text('Distrito: ', col1X, y, { continued: true });
    doc.font('Helvetica').text(districtName);

    doc.font('Helvetica-Bold').text('Iglesia: ', col2X, y, { continued: true });
    doc.font('Helvetica').text(churchName);

    const y2 = doc.y + 2;
    doc.font('Helvetica-Bold').text('Club: ', col1X, y2, { continued: true });
    doc.font('Helvetica').text(clubName);

    doc.font('Helvetica-Bold').text('Mes: ', col2X, y2, { continued: true });
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
  ) {
    const fontSize = 9;
    doc.fontSize(fontSize).font('Helvetica');

    // Directiva
    doc.font('Helvetica-Bold').text('Directiva:', PAGE_MARGIN, doc.y);
    doc.font('Helvetica');

    if (snapshot.directiva && snapshot.directiva.length > 0) {
      for (const member of snapshot.directiva) {
        const label = ROLE_LABELS[member.role] ?? member.role;
        this.drawKeyValue(doc, `  ${label}`, member.name);
      }
    } else {
      doc.text('  No hay directiva registrada', PAGE_MARGIN + 10, doc.y);
    }

    doc.moveDown(0.3);

    // Member count & meeting days
    this.drawKeyValue(
      doc,
      'Cantidad de miembros',
      String(snapshot.member_count),
    );
    this.drawKeyValue(
      doc,
      'Dias de reunion',
      snapshot.meeting_days ?? 'No especificado',
    );

    doc.moveDown(0.3);

    // Manual fields
    doc.font('Helvetica-Bold').text('Juntas y reuniones:', PAGE_MARGIN, doc.y);
    doc.font('Helvetica');
    this.drawKeyValue(
      doc,
      '  Reuniones de planificacion',
      String(manual.planning_meetings ?? 0),
    );
    this.drawKeyValue(
      doc,
      '  Reuniones de padres',
      String(manual.parent_meetings ?? 0),
    );
    this.drawKeyValue(
      doc,
      '  Asistencia consejo de jovenes',
      String(manual.youth_council_attendance ?? 0),
    );
    this.drawKeyValue(
      doc,
      '  Asistencia junta de iglesia',
      String(manual.church_board_attendance ?? 0),
    );
  }

  private drawEnsenanzas(doc: PDFKit.PDFDocument, snapshot: SnapshotData) {
    doc.fontSize(9).font('Helvetica');

    this.drawKeyValue(
      doc,
      'Especialidades iniciadas este mes',
      String(snapshot.honors?.started ?? 0),
    );
    this.drawKeyValue(
      doc,
      'Especialidades completadas este mes',
      String(snapshot.honors?.completed ?? 0),
    );

    if (snapshot.honors?.details && snapshot.honors.details.length > 0) {
      doc.moveDown(0.3);
      doc
        .font('Helvetica-Bold')
        .text('Detalle de especialidades:', PAGE_MARGIN, doc.y);
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
      doc.text('Especialidad', colX[0], tableY);
      doc.text('Miembro', colX[1], tableY);
      doc.text('Estado', colX[2], tableY);
      doc.font('Helvetica').fontSize(8);

      let rowY = tableY + 12;
      const maxRows = Math.min(snapshot.honors.details.length, 10); // Limit to 10 rows

      for (let i = 0; i < maxRows; i++) {
        const h = snapshot.honors.details[i];
        doc.text(h.honor_name ?? '', colX[0], rowY, {
          width: colWidths[0] - 5,
        });
        doc.text(h.user_name ?? '', colX[1], rowY, { width: colWidths[1] - 5 });
        doc.text(h.validated ? 'Completada' : 'En progreso', colX[2], rowY, {
          width: colWidths[2] - 5,
        });
        rowY += 12;
      }

      if (snapshot.honors.details.length > 10) {
        doc.text(
          `... y ${snapshot.honors.details.length - 10} mas`,
          colX[0],
          rowY,
        );
        rowY += 12;
      }

      doc.y = rowY;
    }
  }

  private drawActividades(doc: PDFKit.PDFDocument, snapshot: SnapshotData) {
    doc.fontSize(9).font('Helvetica');

    this.drawKeyValue(
      doc,
      'Total de actividades',
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
      doc.text('Fecha', colX[0], tableY);
      doc.text('Actividad', colX[1], tableY);
      doc.text('Tipo', colX[2], tableY);
      doc.font('Helvetica').fontSize(8);

      let rowY = tableY + 12;
      const maxRows = Math.min(snapshot.activities.list.length, 12);

      for (let i = 0; i < maxRows; i++) {
        const a = snapshot.activities.list[i];
        const dateStr = a.date
          ? new Date(a.date).toLocaleDateString('es-MX')
          : 'N/A';
        doc.text(dateStr, colX[0], rowY, { width: colWidths[0] - 5 });
        doc.text(a.name ?? '', colX[1], rowY, { width: colWidths[1] - 5 });
        doc.text(a.type ?? '', colX[2], rowY, { width: colWidths[2] - 5 });
        rowY += 12;
      }

      if (snapshot.activities.list.length > 12) {
        doc.text(
          `... y ${snapshot.activities.list.length - 12} mas`,
          colX[0],
          rowY,
        );
        rowY += 12;
      }

      doc.y = rowY;
    }
  }

  private drawFinanzas(doc: PDFKit.PDFDocument, snapshot: SnapshotData) {
    doc.fontSize(9).font('Helvetica');

    const finances = snapshot.finances ?? {
      income: 0,
      expenses: 0,
      balance: 0,
      transactions: 0,
    };

    const formatMoney = (amount: number) =>
      `$${amount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Financial summary table
    const tableX = PAGE_MARGIN;
    const labelWidth = CONTENT_WIDTH * 0.6;
    const valueWidth = CONTENT_WIDTH * 0.4;

    const rows = [
      {
        label: 'Total ingresos',
        value: formatMoney(finances.income),
        bold: false,
      },
      {
        label: 'Total egresos',
        value: formatMoney(finances.expenses),
        bold: false,
      },
      {
        label: 'Balance del mes',
        value: formatMoney(finances.balance),
        bold: true,
      },
      {
        label: 'Total de transacciones',
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
  ) {
    doc.fontSize(9).font('Helvetica');

    this.drawKeyValue(doc, 'Blanco de almas', String(manual.soul_target ?? 0));
    this.drawKeyValue(
      doc,
      'Miembros no bautizados',
      String(manual.unbaptized_members ?? 0),
    );
    this.drawKeyValue(
      doc,
      'Recibiendo estudios biblicos',
      String(manual.bible_studies_receiving ?? 0),
    );
    this.drawKeyValue(
      doc,
      'Instruccion biblica semanal',
      this.boolLabel(manual.has_weekly_bible_instruction),
    );
    this.drawKeyValue(
      doc,
      'Se dieron estudios biblicos',
      this.boolLabel(manual.bible_studies_given),
    );
    this.drawKeyValue(
      doc,
      'Se distribuyo literatura',
      this.boolLabel(manual.literature_distributed),
    );
    this.drawKeyValue(
      doc,
      'Bautizados este mes',
      String(manual.baptized_this_month ?? 0),
    );
    this.drawKeyValue(
      doc,
      'Total bautizados acumulado',
      String(manual.total_baptized ?? 0),
    );

    doc.moveDown(0.3);

    // Booklet / certificates
    this.drawKeyValue(
      doc,
      'Certificados entregados',
      this.boolLabel(manual.certificates_delivered),
    );
    this.drawKeyValue(
      doc,
      'Miembros tienen libreta',
      this.boolLabel(manual.members_have_booklet),
    );
    this.drawKeyValue(
      doc,
      'Requisitos de libreta firmados',
      this.boolLabel(manual.booklet_requirements_signed),
    );

    // Club participation
    if (manual.club_participation_description) {
      doc.moveDown(0.3);
      doc
        .font('Helvetica-Bold')
        .text('Participacion del club:', PAGE_MARGIN, doc.y);
      doc
        .font('Helvetica')
        .text(manual.club_participation_description, PAGE_MARGIN + 10, doc.y, {
          width: CONTENT_WIDTH - 10,
        });
    }
  }

  private drawServicio(doc: PDFKit.PDFDocument, manual: Partial<ManualData>) {
    doc.fontSize(9).font('Helvetica');

    if (manual.community_service_description) {
      doc
        .font('Helvetica-Bold')
        .text('Servicio comunitario:', PAGE_MARGIN, doc.y);
      doc
        .font('Helvetica')
        .text(manual.community_service_description, PAGE_MARGIN + 10, doc.y, {
          width: CONTENT_WIDTH - 10,
        });
    } else {
      doc.text(
        'Sin descripcion de servicio comunitario para este mes.',
        PAGE_MARGIN,
        doc.y,
      );
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
  ) {
    doc.moveDown(1.5);
    this.drawHorizontalLine(doc);
    doc.moveDown(0.5);

    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('Informacion del Secretario/a', PAGE_MARGIN, doc.y);
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
      this.drawKeyValue(doc, 'Nombre', fullName || 'N/A');
      this.drawKeyValue(doc, 'Email', submitter.email ?? 'N/A');
    } else {
      doc.text(
        'No hay informacion del secretario disponible.',
        PAGE_MARGIN,
        doc.y,
      );
    }
  }

  private drawFooter(doc: PDFKit.PDFDocument) {
    // Go to each page and draw footer
    const range = (doc as any).bufferedPageRange?.() ?? { start: 0, count: 1 };
    for (let i = range.start; i < range.start + range.count; i++) {
      (doc as any).switchToPage?.(i);

      doc
        .fontSize(7)
        .font('Helvetica')
        .fillColor('#666666')
        .text(
          `Generado por SACDIA | Pagina ${i + 1} de ${range.count}`,
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

  private boolLabel(value?: boolean | null): string {
    if (value === true) return 'Si';
    if (value === false) return 'No';
    return 'N/A';
  }
}

/**
 * Shared layout for the order documents (field payment orders and camporee
 * orders), in the same visual language as the club reports: red title, info
 * grid, section headers, tables with a tinted header, page footers.
 */

export const ORDER_PDF_COLORS = {
  primary: '#D94A3B',
  primarySoft: '#FDE8E6',
  ink: '#0F172A',
  muted: '#64748B',
  border: '#E2E8F0',
  surface: '#F8FAFC',
  white: '#FFFFFF',
  success: '#15803D',
  successSoft: '#DCFCE7',
  warning: '#B45309',
  warningSoft: '#FEF3C7',
  info: '#1D4ED8',
  infoSoft: '#DBEAFE',
  danger: '#B91C1C',
  dangerSoft: '#FEE2E2',
  neutral: '#475569',
  neutralSoft: '#F1F5F9',
} as const;

export type OrderStatusTone =
  'success' | 'warning' | 'info' | 'danger' | 'neutral';

export interface OrderTableColumn {
  header: string;
  /** Share of the content width (all columns add up to 1). */
  width: number;
  align?: 'left' | 'right' | 'center';
}

export interface OrderTable {
  title: string;
  columns: OrderTableColumn[];
  rows: string[][];
  /** Bold last row, e.g. the total. */
  footer?: string[];
}

export interface PaymentInstructions {
  bank_name?: string | null;
  bank_account?: string | null;
  bank_clabe?: string | null;
  bank_holder?: string | null;
  cash_instructions?: string | null;
  extra_notes?: string | null;
}

export interface OrderDocumentSpec {
  title: string;
  subtitle: string;
  folio: string;
  status: { label: string; tone: OrderStatusTone };
  info: Array<[string, string]>;
  tables: OrderTable[];
  payment: PaymentInstructions;
  reference: string;
  notices: string[];
  legend: string;
}

const PAGE_X = 48;
const PAGE_TOP = 48;
const FOOTER_Y = 744;
const CONTENT_BOTTOM = FOOTER_Y - 24;
const ROW_H = 22;

const TONES: Record<OrderStatusTone, { fg: string; bg: string }> = {
  success: { fg: ORDER_PDF_COLORS.success, bg: ORDER_PDF_COLORS.successSoft },
  warning: { fg: ORDER_PDF_COLORS.warning, bg: ORDER_PDF_COLORS.warningSoft },
  info: { fg: ORDER_PDF_COLORS.info, bg: ORDER_PDF_COLORS.infoSoft },
  danger: { fg: ORDER_PDF_COLORS.danger, bg: ORDER_PDF_COLORS.dangerSoft },
  neutral: { fg: ORDER_PDF_COLORS.neutral, bg: ORDER_PDF_COLORS.neutralSoft },
};

export function formatOrderMoney(centavos: number, currency: string): string {
  const amount = (centavos / 100).toFixed(2);
  return `$${amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ${currency}`;
}

export function formatOrderDate(date: Date): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    dateStyle: 'long',
  }).format(date);
}

function contentWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - PAGE_X * 2;
}

/** Starts a new page when `height` doesn't fit; returns the y to draw at. */
function ensureSpace(
  doc: PDFKit.PDFDocument,
  y: number,
  height: number,
): number {
  if (y + height <= CONTENT_BOTTOM) return y;
  doc.addPage();
  return PAGE_TOP;
}

function drawHeader(doc: PDFKit.PDFDocument, spec: OrderDocumentSpec): number {
  const width = contentWidth(doc);
  const titleW = width * 0.62;
  doc.font('Helvetica-Bold').fontSize(20);
  // A long title may wrap: place the subtitle under however many lines it takes.
  const titleH = doc.heightOfString(spec.title, { width: titleW });
  doc
    .fillColor(ORDER_PDF_COLORS.primary)
    .text(spec.title, PAGE_X, PAGE_TOP, { width: titleW });
  doc.font('Helvetica').fontSize(10);
  const subtitleY = PAGE_TOP + titleH + 4;
  const subtitleH = doc.heightOfString(spec.subtitle, { width: titleW });
  doc
    .fillColor(ORDER_PDF_COLORS.muted)
    .text(spec.subtitle, PAGE_X, subtitleY, { width: titleW });

  // Status pill on the right, folio below it.
  const tone = TONES[spec.status.tone];
  doc.font('Helvetica-Bold').fontSize(9);
  const pillW = doc.widthOfString(spec.status.label) + 20;
  const pillX = PAGE_X + width - pillW;
  doc.roundedRect(pillX, PAGE_TOP, pillW, 20, 10).fill(tone.bg);
  doc.fillColor(tone.fg).text(spec.status.label, pillX, PAGE_TOP + 6, {
    width: pillW,
    align: 'center',
  });
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor(ORDER_PDF_COLORS.ink)
    .text(spec.folio, PAGE_X, PAGE_TOP + 28, { width, align: 'right' });

  const y = Math.max(PAGE_TOP + 58, subtitleY + subtitleH + 10);
  doc
    .moveTo(PAGE_X, y)
    .lineTo(PAGE_X + width, y)
    .lineWidth(1)
    .strokeColor(ORDER_PDF_COLORS.primary)
    .stroke();
  return y + 16;
}

function drawInfoGrid(
  doc: PDFKit.PDFDocument,
  info: Array<[string, string]>,
  startY: number,
): number {
  const width = contentWidth(doc);
  const gap = 24;
  const colW = (width - gap) / 2;
  let y = startY;
  for (let i = 0; i < info.length; i += 2) {
    const pair = info.slice(i, i + 2);
    const heights = pair.map(([, value]) =>
      doc.font('Helvetica').fontSize(10).heightOfString(value, { width: colW }),
    );
    const rowH = 14 + Math.max(...heights) + 10;
    y = ensureSpace(doc, y, rowH);
    pair.forEach(([label, value], index) => {
      const x = PAGE_X + index * (colW + gap);
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(ORDER_PDF_COLORS.muted)
        .text(label, x, y, { width: colW });
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(ORDER_PDF_COLORS.ink)
        .text(value, x, y + 12, { width: colW });
      doc
        .moveTo(x, y + rowH - 4)
        .lineTo(x + colW, y + rowH - 4)
        .lineWidth(0.5)
        .strokeColor(ORDER_PDF_COLORS.border)
        .stroke();
    });
    y += rowH + 4;
  }
  return y + 8;
}

function drawSectionTitle(
  doc: PDFKit.PDFDocument,
  title: string,
  startY: number,
): number {
  const y = ensureSpace(doc, startY, 40);
  const width = contentWidth(doc);
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(ORDER_PDF_COLORS.primary)
    .text(title, PAGE_X, y, { width });
  const lineY = y + 17;
  doc
    .moveTo(PAGE_X, lineY)
    .lineTo(PAGE_X + width, lineY)
    .lineWidth(0.75)
    .strokeColor(ORDER_PDF_COLORS.primarySoft)
    .stroke();
  return lineY + 8;
}

function drawRow(
  doc: PDFKit.PDFDocument,
  columns: OrderTableColumn[],
  cells: string[],
  y: number,
  options: { header?: boolean; bold?: boolean } = {},
): void {
  const width = contentWidth(doc);
  if (options.header) {
    doc.rect(PAGE_X, y, width, ROW_H).fill(ORDER_PDF_COLORS.primarySoft);
  }
  let x = PAGE_X;
  columns.forEach((column, index) => {
    const colW = width * column.width;
    doc
      .font(options.header || options.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(options.header ? 8.5 : 9.5)
      .fillColor(ORDER_PDF_COLORS.ink)
      .text(cells[index] ?? '', x + 8, y + 7, {
        width: colW - 16,
        align: column.align ?? 'left',
        height: ROW_H - 8,
        ellipsis: true,
      });
    x += colW;
  });
  doc
    .moveTo(PAGE_X, y + ROW_H)
    .lineTo(PAGE_X + width, y + ROW_H)
    .lineWidth(0.5)
    .strokeColor(ORDER_PDF_COLORS.border)
    .stroke();
}

function drawTable(
  doc: PDFKit.PDFDocument,
  table: OrderTable,
  startY: number,
): number {
  let y = drawSectionTitle(doc, table.title, startY);
  const header = table.columns.map((column) => column.header);
  y = ensureSpace(doc, y, ROW_H * 2);
  drawRow(doc, table.columns, header, y, { header: true });
  y += ROW_H;
  for (const row of table.rows) {
    if (y + ROW_H > CONTENT_BOTTOM) {
      doc.addPage();
      y = PAGE_TOP;
      drawRow(doc, table.columns, header, y, { header: true });
      y += ROW_H;
    }
    drawRow(doc, table.columns, row, y);
    y += ROW_H;
  }
  if (table.footer) {
    y = ensureSpace(doc, y, ROW_H);
    drawRow(doc, table.columns, table.footer, y, { bold: true });
    y += ROW_H;
  }
  return y + 16;
}

function drawPayment(
  doc: PDFKit.PDFDocument,
  payment: PaymentInstructions,
  startY: number,
): number {
  const hasBank = Boolean(
    payment.bank_account || payment.bank_clabe || payment.bank_name,
  );
  const blocks: Array<{ title: string; lines: string[] }> = [];
  if (hasBank) {
    blocks.push({
      title: 'Opción 1 — Pago bancario',
      lines: [
        payment.bank_name ? `Banco: ${payment.bank_name}` : null,
        payment.bank_holder ? `Titular: ${payment.bank_holder}` : null,
        payment.bank_account ? `Cuenta: ${payment.bank_account}` : null,
        payment.bank_clabe ? `CLABE: ${payment.bank_clabe}` : null,
      ].filter((line): line is string => Boolean(line)),
    });
  }
  if (payment.cash_instructions) {
    blocks.push({
      title: hasBank
        ? 'Opción 2 — Pago en la caja del Campo Local'
        : 'Pago en la caja del Campo Local',
      lines: [payment.cash_instructions],
    });
  }
  if (blocks.length === 0 && !payment.extra_notes) return startY;

  let y = drawSectionTitle(doc, 'Instrucciones de pago', startY);
  const width = contentWidth(doc);
  const gap = 16;
  const colW = blocks.length > 1 ? (width - gap) / 2 : width;
  const blockHeight = (block: { title: string; lines: string[] }) =>
    14 +
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .heightOfString(block.lines.join('\n'), { width: colW - 24 });
  const panelH = Math.max(0, ...blocks.map(blockHeight)) + 20;
  if (blocks.length > 0) {
    y = ensureSpace(doc, y, panelH);
    blocks.forEach((block, index) => {
      const x = PAGE_X + index * (colW + gap);
      doc
        .roundedRect(x, y, colW, panelH, 6)
        .lineWidth(0.75)
        .fillAndStroke(ORDER_PDF_COLORS.surface, ORDER_PDF_COLORS.border);
      doc
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .fillColor(ORDER_PDF_COLORS.ink)
        .text(block.title, x + 12, y + 10, { width: colW - 24 });
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor(ORDER_PDF_COLORS.ink)
        .text(block.lines.join('\n'), x + 12, y + 24, { width: colW - 24 });
    });
    y += panelH + 10;
  }
  if (payment.extra_notes) {
    const h = doc
      .font('Helvetica')
      .fontSize(9.5)
      .heightOfString(payment.extra_notes, { width });
    y = ensureSpace(doc, y, h + 6);
    doc
      .fillColor(ORDER_PDF_COLORS.ink)
      .text(payment.extra_notes, PAGE_X, y, { width });
    y += h + 6;
  }
  return y + 6;
}

function drawClosing(
  doc: PDFKit.PDFDocument,
  spec: OrderDocumentSpec,
  startY: number,
): void {
  const width = contentWidth(doc);
  let y = startY;
  const reference = doc
    .font('Helvetica')
    .fontSize(9)
    .heightOfString(spec.reference, { width });
  y = ensureSpace(doc, y, reference + 8);
  doc
    .fillColor(ORDER_PDF_COLORS.muted)
    .text(spec.reference, PAGE_X, y, { width });
  y += reference + 12;
  for (const notice of [...spec.notices, spec.legend]) {
    const h = doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .heightOfString(notice, { width });
    y = ensureSpace(doc, y, h + 8);
    doc
      .fillColor(ORDER_PDF_COLORS.primary)
      .text(notice, PAGE_X, y, { width, align: 'center' });
    y += h + 8;
  }
}

function drawFooters(doc: PDFKit.PDFDocument): void {
  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page += 1) {
    doc.switchToPage(page);
    const width = contentWidth(doc);
    doc
      .moveTo(PAGE_X, FOOTER_Y - 8)
      .lineTo(PAGE_X + width, FOOTER_Y - 8)
      .lineWidth(0.75)
      .strokeColor(ORDER_PDF_COLORS.primary)
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(ORDER_PDF_COLORS.muted)
      .text(
        `Generado por SACDIA | Página ${page - range.start + 1} de ${range.count}`,
        PAGE_X,
        FOOTER_Y,
        { width, align: 'center', lineBreak: false },
      );
  }
}

/** Draws the whole order document. The doc must use `bufferPages: true`. */
export function drawOrderDocument(
  doc: PDFKit.PDFDocument,
  spec: OrderDocumentSpec,
): void {
  let y = drawHeader(doc, spec);
  y = drawInfoGrid(doc, spec.info, y);
  for (const table of spec.tables) {
    y = drawTable(doc, table, y);
  }
  y = drawPayment(doc, spec.payment, y);
  drawClosing(doc, spec, y);
  drawFooters(doc);
}

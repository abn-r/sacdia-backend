import { loadPdfKit } from '../common/utils/pdfkit-loader';
import { loadBrandLogos, type BrandLogos } from '../common/pdf/brand-logos';
import type { FinanceTotals } from './finance-aggregation.service';

export interface FinancePdfMovement {
  date: Date;
  sectionName: string;
  /** 0 = income, anything else = expense. */
  type: number;
  category: string;
  description: string;
  amount: number;
  closingNote: string;
}

export interface FinancePdfCategoryRow {
  name: string;
  count: number;
  total: number;
}

export interface FinancePdfResponsible {
  sectionName: string;
  /** `null` when the post is vacant. */
  director: string | null;
  treasurer: string | null;
}

export interface FinancePdfModel {
  clubName: string;
  /** Local field of the club, «—» is printed when there is none. */
  localFieldName: string | null;
  /** Section name or «Todas las secciones». */
  sectionLabel: string;
  /** True when the export is narrowed to a single section. */
  sectionFiltered: boolean;
  year: number;
  /** Set when a single month was requested; a whole year otherwise. */
  month?: number;
  periodLabel: string;
  generatedAt: Date;
  /** Only meaningful when a month was requested. */
  monthClosed: boolean;
  /** When the month was closed; the pill falls back to «Mes cerrado». */
  closedAt?: Date | null;
  totals: FinanceTotals;
  income: FinancePdfCategoryRow[];
  expenses: FinancePdfCategoryRow[];
  movements: FinancePdfMovement[];
  /** One row per section in the export scope. */
  responsibles: FinancePdfResponsible[];
  /** Who asked for the report; `null` omits the attribution. */
  generatedBy: { name: string; roleLabel: string | null } | null;
}

export interface FinancePdfOptions {
  /** Defaults to the cached brand logos; tests inject their own. */
  logos?: BrandLogos;
}

const PAGE_X = 43;
const PAGE_WIDTH = 612;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_X * 2;
const TOP = 40;
/** Flowing content never goes below this line. */
const CONTENT_BOTTOM = 730;
const FOOTER_RULE_Y = 744;

const COLORS = {
  blue: '#0B84F0',
  blueDark: '#0666C9',
  blueLight: '#D8EBFD',
  blueSurface: '#EBF5FE',
  ink: '#131316',
  ink2: '#3F3F46',
  muted: '#71717A',
  rule: '#E4E4E7',
  ruleSoft: '#F1F1F3',
  expense: '#B42318',
  white: '#FFFFFF',
};

const SPANISH_MONTHS = [
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

const MONEY = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
});

const MEXICO_CITY = 'America/Mexico_City';
/** The standard fonts have no U+2212; the en dash is the closest drawable sign. */
const MINUS = '–';

/** `$1,234.00`; negatives as `-$1,234.00`. */
export function formatPesos(value: number): string {
  return MONEY.format(value);
}

/** Expenses (and negative figures) are printed as `–$1,234.00`. */
function formatSigned(value: number, negative: boolean): string {
  return `${negative ? MINUS : ''}${formatPesos(Math.abs(value))}`;
}

/** «Septiembre 2026» for a month, «Año 2026» for a whole year. */
export function pdfPeriodLabel(year: number, month?: number): string {
  return month
    ? `${SPANISH_MONTHS[month - 1] ?? month} ${year}`
    : `Año ${year}`;
}

const monthName = (month: number) =>
  (SPANISH_MONTHS[month - 1] ?? String(month)).toLowerCase();

function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** «1 al 30 de septiembre» / «1 de enero al 31 de diciembre». */
export function periodRangeLabel(year: number, month?: number): string {
  return month
    ? `1 al ${lastDayOf(year, month)} de ${monthName(month)}`
    : '1 de enero al 31 de diciembre';
}

/** «Al 30 de septiembre de 2026»: the day the balance is measured. */
export function periodEndLabel(year: number, month?: number): string {
  const endMonth = month ?? 12;
  return `Al ${lastDayOf(year, endMonth)} de ${monthName(endMonth)} de ${year}`;
}

function formatDate(date: Date): string {
  const iso = date.toISOString().slice(0, 10);
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

interface ZonedParts {
  day: number;
  month: number;
  year: number;
  hour: string;
  minute: string;
}

function zonedParts(date: Date): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MEXICO_CITY,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '0';
  return {
    day: Number(get('day')),
    month: Number(get('month')),
    year: Number(get('year')),
    hour: get('hour').padStart(2, '0'),
    minute: get('minute').padStart(2, '0'),
  };
}

/** «11 de noviembre de 2026» in Mexico City. */
export function formatLongDate(date: Date): string {
  const p = zonedParts(date);
  return `${p.day} de ${monthName(p.month)} de ${p.year}`;
}

/** «11 nov 2026, 15:20» in Mexico City. */
export function formatShortDateTime(date: Date): string {
  const p = zonedParts(date);
  return `${p.day} ${monthName(p.month).slice(0, 3)} ${p.year}, ${p.hour}:${p.minute}`;
}

type Doc = PDFKit.PDFDocument;

export async function renderFinanceExportPdf(
  model: FinancePdfModel,
  options: FinancePdfOptions = {},
): Promise<Buffer> {
  const logos = options.logos ?? loadBrandLogos();
  const PDFDocument = loadPdfKit();
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: TOP, left: PAGE_X, right: PAGE_X, bottom: 36 },
    bufferPages: true,
    info: {
      Title: `Reporte de finanzas - ${model.clubName} - ${model.periodLabel}`,
      Author: 'SACDIA',
      Subject: 'Reporte de finanzas',
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const ready = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  let y = drawHeader(doc, model, logos);
  y = drawSummary(doc, model, y);
  y = drawCategories(doc, model, y);
  y = drawMovements(doc, model, y);
  y = drawResponsibles(doc, model, y);
  drawGeneratedBy(doc, model, y);
  drawPageFooters(doc, model, logos);

  doc.end();
  return ready;
}

// ── primitives ──────────────────────────────────────────────

function setText(
  doc: Doc,
  font: 'Helvetica' | 'Helvetica-Bold',
  size: number,
  color: string,
): void {
  doc.font(font).fontSize(size).fillColor(color);
}

/** Single line, never wrapped; shortened with an ellipsis when too wide. */
function fitLine(doc: Doc, text: string, maxWidth: number): string {
  if (doc.widthOfString(text) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && doc.widthOfString(`${out}…`) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out.trimEnd()}…`;
}

function hairline(
  doc: Doc,
  y: number,
  color: string,
  width = 0.5,
  x1 = PAGE_X,
  x2 = PAGE_X + CONTENT_WIDTH,
): void {
  doc.moveTo(x1, y).lineTo(x2, y).lineWidth(width).strokeColor(color).stroke();
}

function sectionTitle(doc: Doc, title: string, y: number): number {
  setText(doc, 'Helvetica-Bold', 10.5, COLORS.blueDark);
  doc.text(title.toUpperCase(), PAGE_X, y, {
    width: CONTENT_WIDTH,
    characterSpacing: 0.6,
    lineBreak: false,
  });
  return y + 12 + 8;
}

function newPage(doc: Doc): number {
  doc.addPage();
  return TOP;
}

// ── 1-4: brand, title, meta, status ─────────────────────────

function drawHeader(
  doc: Doc,
  model: FinancePdfModel,
  logos: BrandLogos,
): number {
  const LOGO = 46;
  let textX = PAGE_X;
  if (logos.sacdia) {
    doc.save();
    doc.roundedRect(PAGE_X, TOP, LOGO, LOGO, 10).clip();
    doc.image(logos.sacdia, PAGE_X, TOP, { width: LOGO, height: LOGO });
    doc.restore();
    textX = PAGE_X + LOGO + 10;
  }
  setText(doc, 'Helvetica-Bold', 13, COLORS.blueDark);
  doc.text('SACDIA', textX, TOP + 11, {
    characterSpacing: 0.5,
    lineBreak: false,
  });
  setText(doc, 'Helvetica', 7.5, COLORS.muted);
  doc.text('Sistema de Administración de Clubes JA', textX, TOP + 28, {
    characterSpacing: 0.15,
    lineBreak: false,
  });
  if (logos.iasd) {
    const h = 34;
    const w = (h * 847) / 200;
    doc.image(logos.iasd, PAGE_X + CONTENT_WIDTH - w, TOP + (LOGO - h) / 2, {
      width: w,
      height: h,
    });
  }
  const ruleY = TOP + LOGO + 14;
  hairline(doc, ruleY, COLORS.blue, 2);

  // title row
  const rowY = ruleY + 18;
  setText(doc, 'Helvetica-Bold', 20, COLORS.ink);
  doc.text('Reporte de finanzas', PAGE_X, rowY, {
    characterSpacing: -0.2,
    lineBreak: false,
  });
  setText(doc, 'Helvetica-Bold', 11, COLORS.blueDark);
  doc.text(model.periodLabel, PAGE_X, rowY + 1, {
    width: CONTENT_WIDTH,
    align: 'right',
    lineBreak: false,
  });
  setText(doc, 'Helvetica', 7.5, COLORS.muted);
  doc.text(periodRangeLabel(model.year, model.month), PAGE_X, rowY + 16, {
    width: CONTENT_WIDTH,
    align: 'right',
    lineBreak: false,
  });

  // meta box
  const metaY = rowY + 26 + 12;
  const units = [1.2, 1, 1, 1];
  const totalUnits = units.reduce((a, b) => a + b, 0);
  const widths = units.map((u) => (u / totalUnits) * CONTENT_WIDTH);
  const cells: Array<[string, string]> = [
    ['Club', model.clubName],
    ['Sección', model.sectionLabel],
    ['Campo local', model.localFieldName?.trim() || '—'],
    ['Generado', formatShortDateTime(model.generatedAt)],
  ];
  const PAD_X = 10;
  setText(doc, 'Helvetica-Bold', 9.5, COLORS.ink);
  const valueHeight = Math.max(
    ...cells.map(([, value], i) =>
      doc.heightOfString(value, { width: widths[i] - PAD_X * 2 }),
    ),
  );
  const boxH = 7 + 8.5 + 2 + valueHeight + 7;
  doc
    .roundedRect(PAGE_X, metaY, CONTENT_WIDTH, boxH, 6)
    .lineWidth(0.75)
    .strokeColor(COLORS.rule)
    .stroke();
  let x = PAGE_X;
  cells.forEach(([label, value], i) => {
    if (i > 0) {
      doc
        .moveTo(x, metaY)
        .lineTo(x, metaY + boxH)
        .lineWidth(0.75)
        .strokeColor(COLORS.rule)
        .stroke();
    }
    setText(doc, 'Helvetica', 7, COLORS.muted);
    doc.text(label.toUpperCase(), x + PAD_X, metaY + 7, {
      width: widths[i] - PAD_X * 2,
      characterSpacing: 0.42,
      lineBreak: false,
    });
    setText(doc, 'Helvetica-Bold', 9.5, COLORS.ink);
    doc.text(value, x + PAD_X, metaY + 7 + 8.5 + 2, {
      width: widths[i] - PAD_X * 2,
    });
    x += widths[i];
  });
  let y = metaY + boxH;

  // closed pill
  if (model.month && model.monthClosed) {
    const text = model.closedAt
      ? `Mes cerrado el ${formatLongDate(model.closedAt)}`
      : 'Mes cerrado';
    setText(doc, 'Helvetica-Bold', 8, COLORS.blueDark);
    const textW = doc.widthOfString(text);
    const pillH = 17;
    const pillW = 10 + 6 + 6 + textW + 10;
    const pillY = y + 10;
    doc
      .roundedRect(PAGE_X, pillY, pillW, pillH, pillH / 2)
      .fill(COLORS.blueSurface);
    doc.circle(PAGE_X + 13, pillY + pillH / 2, 3).fill(COLORS.blue);
    setText(doc, 'Helvetica-Bold', 8, COLORS.blueDark);
    doc.text(text, PAGE_X + 22, pillY + 4.5, { lineBreak: false });
    y = pillY + pillH;
  }
  return y;
}

// ── 5: summary ──────────────────────────────────────────────

function drawSummary(doc: Doc, model: FinancePdfModel, startY: number): number {
  let y = sectionTitle(doc, 'Resumen', startY + 22);
  const { totals } = model;
  const incomeCount = model.income.reduce((s, r) => s + r.count, 0);
  const expenseCount = model.expenses.reduce((s, r) => s + r.count, 0);
  const scope = model.month ? 'del mes' : 'del año';
  const movs = (n: number) => `${n} ${n === 1 ? 'movimiento' : 'movimientos'}`;

  const gap = 8;
  const units = [1.35, 1, 1, 1];
  const usable = CONTENT_WIDTH - gap * 3;
  const totalUnits = units.reduce((a, b) => a + b, 0);
  const widths = units.map((u) => (u / totalUnits) * usable);
  const cards = [
    {
      label: 'Saldo acumulado',
      value: formatSigned(totals.balance, totals.balance < 0),
      hint: periodEndLabel(model.year, model.month),
      main: true,
      negative: false,
    },
    {
      label: `Ingresos ${scope}`,
      value: formatPesos(totals.income),
      hint: movs(incomeCount),
      main: false,
      negative: false,
    },
    {
      label: `Egresos ${scope}`,
      value: formatSigned(totals.expenses, totals.expenses > 0),
      hint: movs(expenseCount),
      main: false,
      negative: totals.expenses > 0,
    },
    {
      label: `Neto ${scope}`,
      value: formatSigned(totals.net, totals.net < 0),
      hint: `Saldo anterior: ${formatSigned(
        totals.balance - totals.net,
        totals.balance - totals.net < 0,
      )}`,
      main: false,
      negative: totals.net < 0,
    },
  ];
  const H = 56;
  let x = PAGE_X;
  cards.forEach((card, i) => {
    const w = widths[i];
    if (card.main) {
      doc.roundedRect(x, y, w, H, 6).fill(COLORS.blue);
    } else {
      doc
        .roundedRect(x, y, w, H, 6)
        .lineWidth(0.75)
        .strokeColor(COLORS.rule)
        .stroke();
    }
    const innerW = w - 22;
    setText(doc, 'Helvetica', 7.5, card.main ? '#DCEBFB' : COLORS.muted);
    doc.text(card.label, x + 11, y + 9, { width: innerW, lineBreak: false });
    let size = card.main ? 17 : 13.5;
    setText(
      doc,
      'Helvetica-Bold',
      size,
      card.main ? COLORS.white : card.negative ? COLORS.expense : COLORS.ink,
    );
    while (size > 8 && doc.widthOfString(card.value) > innerW) {
      size -= 0.5;
      doc.fontSize(size);
    }
    doc.text(card.value, x + 11, y + 20, { width: innerW, lineBreak: false });
    setText(doc, 'Helvetica', 7, card.main ? '#DCEBFB' : COLORS.muted);
    doc.text(fitLine(doc, card.hint, innerW), x + 11, y + H - 15, {
      lineBreak: false,
    });
    x += w + gap;
  });
  y += H;
  return y;
}

// ── 6: categories ───────────────────────────────────────────

const CAT_ROW_H = 31;
/** Fixed so the bars of every row start and end in the same place. */
const CAT_LABEL_W = 56;

function drawCategories(
  doc: Doc,
  model: FinancePdfModel,
  startY: number,
): number {
  const gap = 14;
  const colW = (CONTENT_WIDTH - gap) / 2;
  const sides = [
    { title: 'Ingresos', rows: model.income, expense: false },
    { title: 'Egresos', rows: model.expenses, expense: true },
  ].map((s) => ({ ...s, total: s.rows.reduce((sum, r) => sum + r.total, 0) }));

  const heads = (top: number): number => {
    sides.forEach((side, i) => {
      const x = PAGE_X + i * (colW + gap);
      setText(doc, 'Helvetica-Bold', 9, COLORS.ink);
      doc.text(side.title, x, top, { lineBreak: false });
      setText(
        doc,
        'Helvetica-Bold',
        9,
        side.expense && side.total > 0 ? COLORS.expense : COLORS.ink,
      );
      doc.text(
        formatSigned(side.total, side.expense && side.total > 0),
        x,
        top,
        {
          width: colW,
          align: 'right',
          lineBreak: false,
        },
      );
      hairline(doc, top + 14, COLORS.ink, 0.75, x, x + colW);
    });
    return top + 14 + 0.75;
  };

  let titleY = startY + 22;
  if (titleY + 20 + 14 + CAT_ROW_H > CONTENT_BOTTOM) titleY = newPage(doc);
  let y = sectionTitle(doc, 'Por categoría', titleY);
  y = heads(y);

  const count = Math.max(sides[0].rows.length, sides[1].rows.length, 1);
  for (let index = 0; index < count; index += 1) {
    if (y + CAT_ROW_H > CONTENT_BOTTOM) {
      y = heads(newPage(doc));
    }
    sides.forEach((side, i) => {
      const x = PAGE_X + i * (colW + gap);
      const row = side.rows[index];
      if (!row) {
        if (index === 0) {
          setText(doc, 'Helvetica', 8.5, COLORS.muted);
          doc.text('Sin movimientos', x, y + 8, { lineBreak: false });
          hairline(doc, y + CAT_ROW_H, COLORS.ruleSoft, 0.5, x, x + colW);
        }
        return;
      }
      const totalText = formatPesos(row.total);
      setText(doc, 'Helvetica-Bold', 9, COLORS.ink);
      const totalW = doc.widthOfString(totalText);
      doc.text(totalText, x, y + 5, {
        width: colW,
        align: 'right',
        lineBreak: false,
      });
      setText(doc, 'Helvetica', 9, COLORS.ink2);
      doc.text(fitLine(doc, row.name, colW - totalW - 10), x, y + 5, {
        lineBreak: false,
      });
      const share = side.total > 0 ? row.total / side.total : 0;
      const label = `${row.count} mov. · ${Math.round(share * 100)}%`;
      setText(doc, 'Helvetica', 7, COLORS.muted);
      const labelW = CAT_LABEL_W;
      const barW = colW - labelW - 8;
      const barY = y + 5 + 11 + 5;
      doc.roundedRect(x, barY, barW, 4, 2).fill(COLORS.ruleSoft);
      if (share > 0) {
        doc
          .roundedRect(x, barY, Math.max(barW * share, 4), 4, 2)
          .fill(side.expense ? COLORS.blueLight : COLORS.blue);
      }
      setText(doc, 'Helvetica', 7, COLORS.muted);
      doc.text(label, x + barW + 8, barY - 1.5, { lineBreak: false });
      hairline(doc, y + CAT_ROW_H, COLORS.ruleSoft, 0.5, x, x + colW);
    });
    y += CAT_ROW_H;
  }
  return y;
}

// ── 7: movements ────────────────────────────────────────────

interface MovementColumn {
  key: 'date' | 'section' | 'type' | 'category' | 'description' | 'amount';
  label: string;
  width: number;
  align: 'left' | 'right';
}

const CELL_X = 6;
const CELL_Y = 6;
const BODY = 8.5;
const NOTE = 7;
const TABLE_HEAD_H = 21;

function movementColumns(sectionFiltered: boolean): MovementColumn[] {
  const showSection = !sectionFiltered;
  const fixed = 56 + 40 + 96 + 66 + (showSection ? 76 : 0);
  return [
    { key: 'date', label: 'Fecha', width: 56, align: 'left' },
    ...(showSection
      ? [
          {
            key: 'section' as const,
            label: 'Sección',
            width: 76,
            align: 'left' as const,
          },
        ]
      : []),
    { key: 'type', label: 'Tipo', width: 40, align: 'left' },
    { key: 'category', label: 'Categoría', width: 96, align: 'left' },
    {
      key: 'description',
      label: 'Descripción',
      width: CONTENT_WIDTH - fixed,
      align: 'left',
    },
    { key: 'amount', label: 'Monto', width: 66, align: 'right' },
  ];
}

function drawMovementsHeader(
  doc: Doc,
  columns: MovementColumn[],
  y: number,
): number {
  doc
    .roundedRect(PAGE_X, y, CONTENT_WIDTH, TABLE_HEAD_H, 4)
    .fill(COLORS.blueSurface);
  let x = PAGE_X;
  setText(doc, 'Helvetica-Bold', 7.5, COLORS.blueDark);
  for (const col of columns) {
    doc.text(col.label.toUpperCase(), x + CELL_X, y + 7, {
      width: col.width - CELL_X * 2,
      align: col.align,
      characterSpacing: 0.37,
      lineBreak: false,
    });
    x += col.width;
  }
  return y + TABLE_HEAD_H;
}

const NOTE_LABEL = 'Registrado después del cierre: ';

function drawMovements(
  doc: Doc,
  model: FinancePdfModel,
  startY: number,
): number {
  const columns = movementColumns(model.sectionFiltered);
  const col = (key: MovementColumn['key']) =>
    columns.find((c) => c.key === key)!;
  const descW = col('description').width - CELL_X * 2;

  // Start on this page when the title, header and a first row fit.
  let y = startY + 22;
  if (y + 12 + 8 + TABLE_HEAD_H + 26 > CONTENT_BOTTOM) y = newPage(doc);
  y = sectionTitle(doc, 'Movimientos', y);

  if (model.movements.length === 0) {
    setText(doc, 'Helvetica', 9, COLORS.muted);
    doc.text('Sin movimientos en el periodo.', PAGE_X, y, {
      width: CONTENT_WIDTH,
      lineBreak: false,
    });
    return y + 14;
  }

  y = drawMovementsHeader(doc, columns, y);
  const rowHeight = (m: FinancePdfMovement): number => {
    setText(doc, 'Helvetica', BODY, COLORS.ink);
    let h = doc.heightOfString(m.description || ' ', { width: descW });
    const note = m.closingNote.trim();
    if (note) {
      doc.font('Helvetica-Bold').fontSize(NOTE);
      h += 3 + doc.heightOfString(`${NOTE_LABEL}${note}`, { width: descW });
    }
    const cat = doc
      .font('Helvetica')
      .fontSize(BODY)
      .heightOfString(m.category, {
        width: col('category').width - CELL_X * 2,
      });
    const sec = model.sectionFiltered
      ? 0
      : doc.heightOfString(m.sectionName, {
          width: col('section').width - CELL_X * 2,
        });
    return Math.max(h, cat, sec, doc.currentLineHeight()) + CELL_Y * 2;
  };

  // The closing row stays with the last movement.
  const footerH = 28;
  model.movements.forEach((m, index) => {
    const h = rowHeight(m);
    const isLast = index === model.movements.length - 1;
    if (y + h + (isLast ? footerH : 0) > CONTENT_BOTTOM) {
      y = newPage(doc);
      y = sectionTitle(doc, 'Movimientos', y);
      y -= 8;
      setText(doc, 'Helvetica', 7.5, COLORS.muted);
      doc.text('Continuación', PAGE_X, y, { lineBreak: false });
      y += 12;
      y = drawMovementsHeader(doc, columns, y);
    }
    const income = m.type === 0;
    let x = PAGE_X;
    for (const c of columns) {
      const innerX = x + CELL_X;
      const innerW = c.width - CELL_X * 2;
      const top = y + CELL_Y;
      switch (c.key) {
        case 'date':
          setText(doc, 'Helvetica', BODY, COLORS.ink2);
          doc.text(formatDate(m.date), innerX, top, {
            width: innerW,
            lineBreak: false,
          });
          break;
        case 'section':
          setText(doc, 'Helvetica', BODY, COLORS.ink);
          doc.text(m.sectionName, innerX, top, { width: innerW });
          break;
        case 'type':
          setText(
            doc,
            'Helvetica-Bold',
            7.5,
            income ? COLORS.blueDark : COLORS.muted,
          );
          doc.text(income ? 'Ingreso' : 'Egreso', innerX, top + 0.5, {
            width: innerW,
            lineBreak: false,
          });
          break;
        case 'category':
          setText(doc, 'Helvetica', BODY, COLORS.ink);
          doc.text(m.category, innerX, top, { width: innerW });
          break;
        case 'description': {
          setText(doc, 'Helvetica', BODY, COLORS.ink);
          doc.text(m.description || ' ', innerX, top, { width: innerW });
          const note = m.closingNote.trim();
          if (note) {
            const noteY =
              top +
              doc.heightOfString(m.description || ' ', { width: innerW }) +
              3;
            setText(doc, 'Helvetica-Bold', NOTE, COLORS.ink2);
            doc.text(NOTE_LABEL, innerX, noteY, {
              width: innerW,
              continued: true,
            });
            setText(doc, 'Helvetica', NOTE, COLORS.muted);
            doc.text(note, { width: innerW });
          }
          break;
        }
        case 'amount':
          setText(doc, 'Helvetica', BODY, income ? COLORS.ink : COLORS.expense);
          doc.text(formatSigned(m.amount, !income), innerX, top, {
            width: innerW,
            align: 'right',
            lineBreak: false,
          });
          break;
      }
      x += c.width;
    }
    hairline(doc, y + h, COLORS.ruleSoft, 0.5);
    y += h;
  });

  // closing row
  const net = model.totals.net;
  hairline(doc, y, COLORS.ink, 0.75);
  const count = model.totals.movements;
  const label = `Neto ${model.month ? 'del mes' : 'del año'} · ${count} ${count === 1 ? 'movimiento' : 'movimientos'}`;
  setText(doc, 'Helvetica-Bold', 9, COLORS.ink);
  doc.text(label, PAGE_X + CELL_X, y + 8, { lineBreak: false });
  setText(doc, 'Helvetica-Bold', 9, net < 0 ? COLORS.expense : COLORS.ink);
  doc.text(
    formatSigned(net, net < 0),
    PAGE_X + CONTENT_WIDTH - col('amount').width + CELL_X,
    y + 8,
    {
      width: col('amount').width - CELL_X * 2,
      align: 'right',
      lineBreak: false,
    },
  );
  return y + footerH;
}

// ── 8: responsibles ─────────────────────────────────────────

function drawResponsibles(
  doc: Doc,
  model: FinancePdfModel,
  startY: number,
): number {
  const cols = [
    { label: 'Sección', width: CONTENT_WIDTH * 0.3 },
    { label: 'Director(a)', width: CONTENT_WIDTH * 0.35 },
    { label: 'Tesorero(a)', width: CONTENT_WIDTH * 0.35 },
  ];
  const head = (top: number): number => {
    let x = PAGE_X;
    setText(doc, 'Helvetica', 7, COLORS.muted);
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), x + CELL_X, top, {
        width: c.width - CELL_X * 2,
        characterSpacing: 0.35,
        lineBreak: false,
      });
      x += c.width;
    }
    hairline(doc, top + 12, COLORS.ink, 0.75);
    return top + 12.75;
  };
  const ROW_H = 26;
  let y = startY + 22;
  // Keep the block together: when the whole table does not fit in what is
  // left of the page (but fits on a fresh one), start it on the next page.
  const blockHeight =
    12 + 8 + 13 + Math.max(model.responsibles.length, 1) * ROW_H;
  const fitsOnFreshPage = TOP + blockHeight <= CONTENT_BOTTOM;
  if (
    y + blockHeight > CONTENT_BOTTOM &&
    (fitsOnFreshPage || y + 12 + 8 + 13 + ROW_H > CONTENT_BOTTOM)
  ) {
    y = newPage(doc);
  }
  y = head(sectionTitle(doc, 'Responsables', y));

  for (const r of model.responsibles) {
    if (y + ROW_H > CONTENT_BOTTOM) {
      y = head(sectionTitle(doc, 'Responsables', newPage(doc)));
    }
    const values = [r.sectionName, r.director, r.treasurer];
    let x = PAGE_X;
    values.forEach((value, i) => {
      if (i === 0) setText(doc, 'Helvetica', BODY, COLORS.ink2);
      else
        setText(
          doc,
          value ? 'Helvetica-Bold' : 'Helvetica',
          BODY,
          value ? COLORS.ink : COLORS.muted,
        );
      doc.text(
        fitLine(doc, value ?? '—', cols[i].width - CELL_X * 2),
        x + CELL_X,
        y + 8,
        {
          lineBreak: false,
        },
      );
      x += cols[i].width;
    });
    hairline(doc, y + ROW_H, COLORS.ruleSoft, 0.5);
    y += ROW_H;
  }
  return y;
}

// ── 9: generated-by note ────────────────────────────────────

function drawGeneratedBy(
  doc: Doc,
  model: FinancePdfModel,
  contentEndY: number,
): void {
  const when = `el ${formatLongDate(model.generatedAt)} a las ${
    zonedParts(model.generatedAt).hour
  }:${zonedParts(model.generatedAt).minute}.`;
  const by = model.generatedBy;
  const who = by
    ? { name: by.name, role: by.roleLabel ? ` (${by.roleLabel})` : '' }
    : null;
  const lead = who ? 'Reporte generado por ' : 'Reporte generado ';
  const plain = `${lead}${who?.name ?? ''}${who?.role ?? ''} ${when}`;
  const innerW = CONTENT_WIDTH - 24;
  setText(doc, 'Helvetica', 8, COLORS.ink2);
  const boxH = 10 + doc.heightOfString(plain, { width: innerW }) + 10;
  let boxY = CONTENT_BOTTOM - boxH;
  if (contentEndY + 12 > boxY) {
    doc.addPage();
    boxY = CONTENT_BOTTOM - boxH;
  }
  doc
    .roundedRect(PAGE_X, boxY, CONTENT_WIDTH, boxH, 6)
    .fill(COLORS.blueSurface);
  setText(doc, 'Helvetica', 8, COLORS.ink2);
  doc.text(lead, PAGE_X + 12, boxY + 10, { width: innerW, continued: true });
  if (who) {
    setText(doc, 'Helvetica-Bold', 8, COLORS.blueDark);
    doc.text(who.name, { width: innerW, continued: true });
    setText(doc, 'Helvetica', 8, COLORS.ink2);
    doc.text(`${who.role} `, { width: innerW, continued: true });
  }
  setText(doc, 'Helvetica', 8, COLORS.ink2);
  doc.text(when, { width: innerW });
}

// ── 10: footers ─────────────────────────────────────────────

/**
 * Needs `bufferPages: true`. The footer sits inside the bottom margin, so the
 * margin is zeroed while writing; otherwise pdfkit appends a blank page per
 * footer.
 */
function drawPageFooters(
  doc: Doc,
  model: FinancePdfModel,
  logos: BrandLogos,
): void {
  const range = doc.bufferedPageRange();
  const label = `SACDIA · Reporte de finanzas · ${model.clubName} · ${model.periodLabel}`;
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const page = doc.page;
    const originalBottom = page.margins.bottom;
    page.margins.bottom = 0;

    hairline(doc, FOOTER_RULE_Y, COLORS.rule, 0.5);
    const top = FOOTER_RULE_Y + 7;
    let textX = PAGE_X;
    if (logos.sacdia) {
      doc.save();
      doc.roundedRect(PAGE_X, top, 16, 16, 4).clip();
      doc.image(logos.sacdia, PAGE_X, top, { width: 16, height: 16 });
      doc.restore();
      textX = PAGE_X + 22;
    }
    const pageText = `Página ${i - range.start + 1} de ${range.count}`;
    setText(doc, 'Helvetica', 7, COLORS.muted);
    const pageW = doc.widthOfString(pageText);
    doc.text(pageText, PAGE_X + CONTENT_WIDTH - pageW, top + 4.5, {
      lineBreak: false,
    });
    doc.text(
      fitLine(doc, label, PAGE_X + CONTENT_WIDTH - pageW - 12 - textX),
      textX,
      top + 4.5,
      { lineBreak: false },
    );
    page.margins.bottom = originalBottom;
  }
  doc.fillColor(COLORS.ink);
}

import { Logger } from '@nestjs/common';
import { loadPdfKit } from '../common/utils/pdfkit-loader';
import {
  formatLongDate,
  formatPesos,
  formatShortDateTime,
  pdfPeriodLabel,
  periodEndLabel,
  periodRangeLabel,
  renderFinanceExportPdf,
  type FinancePdfModel,
  type FinancePdfMovement,
} from './finance-export-pdf';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBrandLogos } from '../common/pdf/brand-logos';

const base: FinancePdfModel = {
  clubName: 'Club Panteras',
  localFieldName: 'Asociación Centro de Veracruz',
  sectionLabel: 'Todas las secciones',
  sectionFiltered: false,
  year: 2026,
  month: 9,
  periodLabel: 'Septiembre 2026',
  generatedAt: new Date('2026-11-11T21:20:00Z'),
  monthClosed: true,
  closedAt: new Date('2026-10-01T18:00:00Z'),
  totals: {
    income: 1500,
    expenses: 300,
    net: 1200,
    movements: 2,
    balance: 9000,
  },
  income: [{ name: 'Cuotas', count: 1, total: 1500 }],
  expenses: [{ name: 'Material', count: 1, total: 300 }],
  movements: [],
  responsibles: [
    { sectionName: 'Aventureros', director: 'Ana Ruiz', treasurer: 'Luis Paz' },
    { sectionName: 'Conquistadores', director: null, treasurer: null },
  ],
  generatedBy: { name: 'Admin SACDIA', roleLabel: 'Administrador' },
};

const movement = (i: number, over: Partial<FinancePdfMovement> = {}) => ({
  date: new Date('2026-09-15T00:00:00Z'),
  sectionName: 'Conquistadores',
  type: i % 2,
  category: 'Material',
  description: `Compra ${i}`,
  amount: 100 + i,
  closingNote: '',
  ...over,
});

const pageCount = (buf: Buffer) =>
  (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

/** Records what is drawn and on which (0-based) page, without decoding the PDF. */
async function capture(model: FinancePdfModel, options = {}) {
  const proto = loadPdfKit().prototype;
  const texts: Array<{ text: string; page: number }> = [];
  // the constructor adds the first page through addPage
  let page = -1;
  let images = 0;
  const textSpy = jest.spyOn(proto, 'text');
  const pageSpy = jest.spyOn(proto, 'addPage');
  const imageSpy = jest.spyOn(proto, 'image');
  textSpy.mockImplementation(function (this: any, ...args: any[]) {
    if (typeof args[0] === 'string') texts.push({ text: args[0], page });
    return Object.getPrototypeOf(proto).text.apply(this, args);
  });
  pageSpy.mockImplementation(function (this: any, ...args: any[]) {
    page += 1;
    return Object.getPrototypeOf(proto).addPage.apply(this, args);
  });
  imageSpy.mockImplementation(function (this: any, ...args: any[]) {
    images += 1;
    return Object.getPrototypeOf(proto).image.apply(this, args);
  });
  try {
    const buf = await renderFinanceExportPdf(model, options);
    return { buf, texts, pages: page + 1, images };
  } finally {
    textSpy.mockRestore();
    pageSpy.mockRestore();
    imageSpy.mockRestore();
  }
}

const has = (texts: Array<{ text: string }>, needle: string | RegExp) =>
  texts.some((t) =>
    typeof needle === 'string' ? t.text === needle : needle.test(t.text),
  );

describe('finance export pdf', () => {
  it('formats pesos and period labels', () => {
    expect(formatPesos(1234)).toBe('$1,234.00');
    expect(formatPesos(-120)).toBe('-$120.00');
    expect(pdfPeriodLabel(2026, 9)).toBe('Septiembre 2026');
    expect(pdfPeriodLabel(2026)).toBe('Año 2026');
    expect(periodRangeLabel(2026, 9)).toBe('1 al 30 de septiembre');
    expect(periodRangeLabel(2026, 2)).toBe('1 al 28 de febrero');
    expect(periodRangeLabel(2026)).toBe('1 de enero al 31 de diciembre');
    expect(periodEndLabel(2026, 9)).toBe('Al 30 de septiembre de 2026');
    expect(periodEndLabel(2026)).toBe('Al 31 de diciembre de 2026');
  });

  it('formats dates in Mexico City time', () => {
    const d = new Date('2026-11-11T21:20:00Z');
    expect(formatShortDateTime(d)).toBe('11 nov 2026, 15:20');
    expect(formatLongDate(d)).toBe('11 de noviembre de 2026');
    // 02:00Z is still the previous day in Mexico City.
    expect(formatLongDate(new Date('2026-10-02T02:00:00Z'))).toBe(
      '1 de octubre de 2026',
    );
  });

  it('renders an empty report as a PDF', async () => {
    const buf = await renderFinanceExportPdf(base);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('draws the brand logos and renders without them when they are missing', async () => {
    const withLogos = await capture(base);
    // sacdia + iasd in the header, sacdia in the footer of the single page.
    expect(withLogos.images).toBe(3);

    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const logos = readBrandLogos('/nonexistent/dir');
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    const missing = await capture(base, { logos });
    expect(missing.images).toBe(0);
    expect(missing.buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(has(missing.texts, 'SACDIA')).toBe(true);
  });

  it('loads both packaged logos', () => {
    const logos = readBrandLogos();
    expect(logos.sacdia?.subarray(1, 4).toString()).toBe('PNG');
    expect(logos.iasd?.subarray(1, 4).toString()).toBe('PNG');
    const nest = JSON.parse(
      readFileSync(join(__dirname, '../../nest-cli.json'), 'utf8'),
    );
    expect(
      nest.compilerOptions.assets.some(
        (a: { include: string }) => a.include === 'common/pdf/assets/*.png',
      ),
    ).toBe(true);
  });

  it('shows the closed pill only for a closed month', async () => {
    const closed = await capture(base);
    expect(has(closed.texts, 'Mes cerrado el 1 de octubre de 2026')).toBe(true);

    const noDate = await capture({ ...base, closedAt: null });
    expect(has(noDate.texts, 'Mes cerrado')).toBe(true);

    const open = await capture({ ...base, monthClosed: false });
    expect(has(open.texts, /Mes cerrado/)).toBe(false);

    const year = await capture({
      ...base,
      month: undefined,
      monthClosed: true,
    });
    expect(has(year.texts, /Mes cerrado/)).toBe(false);
  });

  it('prints the header, meta, summary and previous balance', async () => {
    const { texts } = await capture(base);
    expect(has(texts, 'Reporte de finanzas')).toBe(true);
    expect(has(texts, 'Septiembre 2026')).toBe(true);
    expect(has(texts, '1 al 30 de septiembre')).toBe(true);
    expect(has(texts, 'Asociación Centro de Veracruz')).toBe(true);
    expect(has(texts, '11 nov 2026, 15:20')).toBe(true);
    expect(has(texts, 'RESUMEN')).toBe(true);
    expect(has(texts, '$9,000.00')).toBe(true);
    expect(has(texts, 'Al 30 de septiembre de 2026')).toBe(true);
    expect(has(texts, 'Ingresos del mes')).toBe(true);
    expect(has(texts, 'Egresos del mes')).toBe(true);
    expect(has(texts, 'Neto del mes')).toBe(true);
    expect(has(texts, '1 movimiento')).toBe(true);
    // balance 9000 - net 1200
    expect(has(texts, 'Saldo anterior: $7,800.00')).toBe(true);
    expect(has(texts, /^–\$300\.00$/)).toBe(true);
  });

  it('uses «del año» and a dash for a missing local field on a whole-year export', async () => {
    const { texts } = await capture({
      ...base,
      month: undefined,
      periodLabel: 'Año 2026',
      localFieldName: null,
    });
    expect(has(texts, 'Ingresos del año')).toBe(true);
    expect(has(texts, '1 de enero al 31 de diciembre')).toBe(true);
    expect(has(texts, 'Al 31 de diciembre de 2026')).toBe(true);
    expect(has(texts, '—')).toBe(true);
  });

  it('shows «Sin movimientos» for an empty category side', async () => {
    const { texts } = await capture({ ...base, expenses: [] });
    expect(has(texts, 'Sin movimientos')).toBe(true);
  });

  it('lists responsibles per section with «—» for vacant posts', async () => {
    const all = await capture(base);
    expect(has(all.texts, 'RESPONSABLES')).toBe(true);
    expect(has(all.texts, 'Aventureros')).toBe(true);
    expect(has(all.texts, 'Conquistadores')).toBe(true);
    expect(has(all.texts, 'Ana Ruiz')).toBe(true);
    expect(has(all.texts, 'Luis Paz')).toBe(true);
    expect(all.texts.filter((t) => t.text === '—')).toHaveLength(2);

    const one = await capture({
      ...base,
      sectionFiltered: true,
      sectionLabel: 'Aventureros',
      responsibles: [base.responsibles[0]],
    });
    expect(has(one.texts, 'Conquistadores')).toBe(false);
    expect(has(one.texts, 'Ana Ruiz')).toBe(true);
  });

  it('never splits a small responsables table across pages', async () => {
    const responsibles = [
      {
        sectionName: 'Aventureros',
        director: 'Ana Ruiz',
        treasurer: 'Luis Paz',
      },
      { sectionName: 'Guías Mayores', director: 'Elena Cruz', treasurer: null },
      { sectionName: 'Conquistadores', director: null, treasurer: null },
    ];
    for (let n = 0; n <= 45; n += 1) {
      const movements = Array.from({ length: n }, (_, i) => movement(i));
      const { texts } = await capture({ ...base, movements, responsibles });
      const titles = texts.filter((t) => t.text === 'RESPONSABLES');
      expect(titles).toHaveLength(1);
      const rowPages = new Set(
        texts
          .filter(
            (t) =>
              ['Ana Ruiz', 'Elena Cruz'].includes(t.text) ||
              (t.text === 'Conquistadores' && t.page >= titles[0].page),
          )
          .map((t) => t.page),
      );
      expect([...rowPages]).toEqual([titles[0].page]);
    }
  });

  it('prints the generated-by note on the last page', async () => {
    const { texts, pages } = await capture(base);
    const note = texts
      .filter((t) => t.page === pages - 1)
      .map((t) => t.text)
      .join('');
    expect(note).toContain('Reporte generado por ');
    expect(note).toContain('Admin SACDIA');
    expect(note).toContain(
      '(Administrador) el 11 de noviembre de 2026 a las 15:20.',
    );

    const anonymous = await capture({ ...base, generatedBy: null });
    expect(
      anonymous.texts
        .map((t) => t.text)
        .join('')
        .includes('Reporte generado el 11 de noviembre de 2026 a las 15:20.'),
    ).toBe(true);
  });

  it('hides the section column when the export is filtered to one section', async () => {
    const movements = [movement(0)];
    const all = await capture({ ...base, movements });
    expect(has(all.texts, 'SECCIÓN')).toBe(true);

    const filtered = await capture({
      ...base,
      movements,
      sectionFiltered: true,
      sectionLabel: 'Aventureros',
      monthClosed: false,
    });
    // meta box keeps «SECCIÓN»; the table header and the responsables table
    // do too, but the table column is gone: one fewer than the full export.
    const count = (r: { texts: Array<{ text: string }> }) =>
      r.texts.filter((t) => t.text === 'SECCIÓN').length;
    expect(count(filtered)).toBe(count(all) - 1);
    expect(filtered.buf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('starts the movements table on the first page (no forced page break)', async () => {
    const { texts, pages } = await capture({
      ...base,
      movements: [movement(0, { description: 'Primer movimiento' })],
    });
    expect(pages).toBe(1);
    const first = texts.find((t) => t.text === 'Primer movimiento');
    expect(first?.page).toBe(0);
    expect(has(texts, 'Neto del mes · 2 movimientos')).toBe(true);
  });

  it('shows the closing note under the description', async () => {
    const { texts } = await capture({
      ...base,
      movements: [movement(0, { closingNote: 'llegó el comprobante' })],
    });
    expect(has(texts, 'Registrado después del cierre: ')).toBe(true);
    expect(has(texts, 'llegó el comprobante')).toBe(true);
    expect(has(texts, 'NOTA DE CIERRE')).toBe(false);
  });

  it('wraps long text, paginates and repeats the header with a continuation mark', async () => {
    const movements = Array.from({ length: 300 }, (_, i) =>
      movement(i, {
        description: `Compra de insumos ${'largo '.repeat(30)}`,
        closingNote: i % 5 === 0 ? 'Ajuste autorizado' : '',
      }),
    );
    const { buf, texts, pages } = await capture({ ...base, movements });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pageCount(buf)).toBeGreaterThan(3);
    expect(pageCount(buf)).toBe(pages);
    const continuation = texts.filter((t) => t.text === 'Continuación');
    expect(continuation.length).toBe(pages - 1);
    const headers = texts.filter((t) => t.text === 'FECHA');
    expect(headers.length).toBe(pages);
    // the closing row and the generated-by note end up on the last page
    expect(
      texts.find((t) => t.text.startsWith('Neto del mes · 2 mov'))?.page,
    ).toBe(pages - 1);
  });

  it('moves the generated-by note to a new page when it would overlap content', async () => {
    // Enough rows to leave the last page nearly full.
    let found = false;
    for (let n = 25; n < 45 && !found; n += 1) {
      const movements = Array.from({ length: n }, (_, i) => movement(i));
      const { texts, pages } = await capture({ ...base, movements });
      const last = texts.filter((t) => t.page === pages - 1);
      const onlyNote =
        last.some((t) => t.text === 'Reporte generado por ') &&
        !last.some((t) => t.text === 'RESPONSABLES');
      if (onlyNote) found = true;
    }
    expect(found).toBe(true);
  });

  it('supports a section-filtered export', async () => {
    const buf = await renderFinanceExportPdf({
      ...base,
      sectionFiltered: true,
      sectionLabel: 'Aventureros',
      monthClosed: false,
      movements: [
        movement(0, { sectionName: 'Aventureros', description: 'Cuota' }),
      ],
    });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });
});

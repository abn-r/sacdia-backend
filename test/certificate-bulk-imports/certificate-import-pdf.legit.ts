import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStreamWriter,
  PDFString,
  StandardFonts,
} from 'pdf-lib';

/**
 * Legitimate-but-heavy certificate PDFs, generated locally with pdf-lib.
 * Every object that is not a stream lands in an /ObjStm when object streams
 * are on, so annotations, outlines, form fields and font dictionaries are what
 * make the decoded /ObjStm and the decoded /XRef stream large.
 */
export type HeavyPdfShape = {
  pages: number;
  /** Link annotations per page. */
  annotationsPerPage?: number;
  /** Text fields per page (each is a widget plus an appearance stream). */
  fieldsPerPage?: number;
  /** Items in one flat outline (bookmark) tree. */
  outlineItems?: number;
  /** Font dictionaries that each carry a 224-entry /Widths array. */
  widthFonts?: number;
  /** Standard 14 fonts embedded and used on the first page. */
  standardFonts?: boolean;
  /**
   * Non-stream objects per /ObjStm. pdf-lib's save() fixes this at 50, so the
   * writer is built directly. qpdf and PDFBox use 100.
   */
  objectsPerStream?: number;
  useObjectStreams?: boolean;
};

export async function heavyLegitPdf(shape: HeavyPdfShape): Promise<Buffer> {
  const document = await PDFDocument.create();
  const context = document.context;
  const base = await document.embedFont(StandardFonts.Helvetica);
  const pages = Array.from({ length: shape.pages }, () => document.addPage());

  if (shape.standardFonts) {
    const names = Object.values(StandardFonts);
    let y = 760;
    for (const name of names) {
      const font = await document.embedFont(name);
      if (name === StandardFonts.Symbol || name === StandardFonts.ZapfDingbats)
        continue;
      pages[0].drawText('Certificado de investidura', {
        x: 24,
        y,
        size: 9,
        font,
      });
      y -= 12;
    }
  }

  for (const [index, page] of pages.entries()) {
    page.drawText(`Certificado ${index + 1}`, { x: 50, y: 700, font: base });
    const count = shape.annotationsPerPage ?? 0;
    if (count > 0) {
      const annots = context.obj([]);
      for (let n = 0; n < count; n++) {
        const x = 20 + (n % 40) * 14;
        const y = 20 + Math.floor(n / 40) * 3;
        const annot = context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [x, y, x + 12, y + 2],
          Border: [0, 0, 0],
          F: 4,
          A: {
            Type: 'Action',
            S: 'URI',
            URI: PDFString.of(`https://sacdia.example/verify/${index}/${n}`),
          },
        });
        annots.push(context.register(annot));
      }
      page.node.set(PDFName.of('Annots'), context.register(annots));
    }
  }

  if ((shape.fieldsPerPage ?? 0) > 0) {
    const form = document.getForm();
    for (const [index, page] of pages.entries()) {
      for (let n = 0; n < (shape.fieldsPerPage ?? 0); n++) {
        const field = form.createTextField(`p${index}.f${n}`);
        field.setText(`valor ${n}`);
        field.addToPage(page, {
          x: 20 + (n % 10) * 55,
          y: 20 + Math.floor(n / 10) * 12,
          width: 50,
          height: 10,
        });
      }
    }
  }

  if ((shape.widthFonts ?? 0) > 0) {
    const widths = Array.from({ length: 224 }, (_, n) => 500 + (n % 400));
    const fonts: Record<string, PDFRef> = {};
    for (let n = 0; n < (shape.widthFonts ?? 0); n++) {
      const descriptor = context.register(
        context.obj({
          Type: 'FontDescriptor',
          FontName: `AAAAAA+Face${n}`,
          Flags: 32,
          FontBBox: [-170, -225, 1000, 931],
          ItalicAngle: 0,
          Ascent: 905,
          Descent: -212,
          CapHeight: 716,
          StemV: 80,
        }),
      );
      fonts[`F${n}`] = context.register(
        context.obj({
          Type: 'Font',
          Subtype: 'TrueType',
          BaseFont: `AAAAAA+Face${n}`,
          FirstChar: 32,
          LastChar: 255,
          Widths: widths,
          FontDescriptor: descriptor,
          Encoding: 'WinAnsiEncoding',
        }),
      );
    }
    const resources = pages[0].node.Resources();
    if (!resources) throw new Error('page has no /Resources');
    const existing = resources.lookup(PDFName.of('Font'), PDFDict);
    for (const [key, ref] of Object.entries(fonts)) {
      existing.set(PDFName.of(key), ref);
    }
  }

  if ((shape.outlineItems ?? 0) > 0) {
    const total = shape.outlineItems ?? 0;
    const outlines = context.nextRef();
    const refs = Array.from({ length: total }, () => context.nextRef());
    refs.forEach((ref, n) => {
      const item = context.obj({
        Title: PDFString.of(`Sección ${n}`),
        Parent: outlines,
        Dest: [pages[n % pages.length].ref, 'Fit'],
      });
      if (n > 0) item.set(PDFName.of('Prev'), refs[n - 1]);
      if (n < total - 1) item.set(PDFName.of('Next'), refs[n + 1]);
      context.assign(ref, item);
    });
    context.assign(
      outlines,
      context.obj({
        Type: 'Outlines',
        First: refs[0],
        Last: refs[total - 1],
        Count: PDFNumber.of(total),
      }),
    );
    document.catalog.set(PDFName.of('Outlines'), outlines);
  }

  if (shape.useObjectStreams === false) {
    return Buffer.from(
      await document.save({ addDefaultPage: false, useObjectStreams: false }),
    );
  }
  document.getForm().updateFieldAppearances();
  const writer = PDFStreamWriter.forContext(
    context,
    50,
    true,
    shape.objectsPerStream ?? 50,
  );
  return Buffer.from(await writer.serializeToBuffer());
}

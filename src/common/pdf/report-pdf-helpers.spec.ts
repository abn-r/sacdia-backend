import { loadPdfKit } from '../utils/pdfkit-loader';
import { drawPageFooters, ensureSpace } from './report-pdf-helpers';

function newDoc() {
  const PDFDocument = loadPdfKit();
  return new PDFDocument({
    size: 'LETTER',
    bufferPages: true,
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
  });
}

describe('report pdf helpers', () => {
  describe('ensureSpace', () => {
    it('keeps the current page when the content fits', () => {
      const doc = newDoc();
      doc.y = 300;
      ensureSpace(doc, 100);
      expect(doc.bufferedPageRange().count).toBe(1);
      expect(doc.y).toBe(300);
    });

    it('adds a page only when the content does not fit', () => {
      const doc = newDoc();
      doc.y = 700;
      ensureSpace(doc, 100);
      expect(doc.bufferedPageRange().count).toBe(2);
      expect(doc.y).toBe(40);
    });
  });

  describe('drawPageFooters', () => {
    it('writes the footer on every page with correct numbers and no extra pages', () => {
      const doc = newDoc();
      doc.text('page one');
      doc.addPage();
      doc.text('page two');
      doc.addPage();
      doc.text('page three');
      const pagesBefore = doc.bufferedPageRange().count;

      const written: { text: string; page: number }[] = [];
      const originalText = doc.text.bind(doc);
      const bufferedPages = (doc as any)._pageBuffer as unknown[];
      jest.spyOn(doc, 'text').mockImplementation(((
        text: string,
        ...rest: unknown[]
      ) => {
        written.push({
          text,
          page: bufferedPages.indexOf((doc as any).page),
        });
        return (originalText as any)(text, ...rest);
      }) as any);

      drawPageFooters(doc, (c, n) => `Página ${c} de ${n}`, {
        x: 40,
        width: 532,
      });

      expect(written).toEqual([
        { text: 'Página 1 de 3', page: 0 },
        { text: 'Página 2 de 3', page: 1 },
        { text: 'Página 3 de 3', page: 2 },
      ]);
      expect(doc.bufferedPageRange().count).toBe(pagesBefore);
      expect(doc.page.margins.bottom).toBe(40);
      doc.end();
    });
  });
});

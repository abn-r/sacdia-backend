import { lazyModule } from './lazy-module';
import { toPdfSafeText } from './pdf-safe-text';

type PdfKit = typeof import('pdfkit');

function safe(value: unknown): unknown {
  return typeof value === 'string' ? toPdfSafeText(value) : value;
}

/**
 * Every PDF goes through this class: user text (notes, descriptions, names)
 * is made drawable for the standard fonts before it is measured or drawn.
 */
function withSafeText(Base: PdfKit): PdfKit {
  const BaseClass = Base as unknown as new (...args: unknown[]) => {
    text(...args: unknown[]): unknown;
    widthOfString(...args: unknown[]): number;
    heightOfString(...args: unknown[]): number;
  };

  class SafePDFDocument extends BaseClass {
    text(text: unknown, ...rest: unknown[]) {
      return super.text(safe(text), ...rest);
    }

    widthOfString(text: unknown, ...rest: unknown[]) {
      return super.widthOfString(safe(text), ...rest);
    }

    heightOfString(text: unknown, ...rest: unknown[]) {
      return super.heightOfString(safe(text), ...rest);
    }
  }

  return SafePDFDocument as unknown as PdfKit;
}

/**
 * pdfkit (fontkit, png-js, linebreak...) costs ~9 MiB RSS when loaded and is
 * only needed while rendering a PDF, so it is required on the first PDF
 * instead of at application boot.
 *
 * Returns the same constructor a default `import PDFDocument from 'pdfkit'`
 * would give: `const PDFDocument = loadPdfKit(); new PDFDocument({...})`.
 */
export const loadPdfKit = lazyModule(() =>
  withSafeText(require('pdfkit') as PdfKit),
);

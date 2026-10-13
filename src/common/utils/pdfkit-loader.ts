import { lazyModule } from './lazy-module';

/**
 * pdfkit (fontkit, png-js, linebreak...) costs ~9 MiB RSS when loaded and is
 * only needed while rendering a PDF, so it is required on the first PDF
 * instead of at application boot.
 *
 * Returns the same constructor a default `import PDFDocument from 'pdfkit'`
 * would give: `const PDFDocument = loadPdfKit(); new PDFDocument({...})`.
 */
export const loadPdfKit = lazyModule(
  () => require('pdfkit') as typeof import('pdfkit'),
);

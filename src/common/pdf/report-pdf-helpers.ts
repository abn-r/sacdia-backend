/**
 * Layout helpers shared by the quarterly and annual report PDFs.
 */

/**
 * Starts a new page only when `height` points do not fit above the bottom
 * margin of the current page. Never breaks a page that still has room.
 */
export function ensureSpace(doc: PDFKit.PDFDocument, height: number): void {
  const limit = doc.page.height - doc.page.margins.bottom;
  if (doc.y + height > limit) {
    doc.addPage();
  }
}

/**
 * Draws a centered footer on every buffered page. The document must be
 * created with `bufferPages: true`, otherwise earlier pages are already
 * flushed and cannot be revisited.
 *
 * The footer sits inside the bottom margin, so the margin is zeroed while
 * writing; otherwise pdfkit would treat the text as overflow and append a
 * blank page per footer.
 */
export function drawPageFooters(
  doc: PDFKit.PDFDocument,
  buildText: (current: number, total: number) => string,
  options: { x: number; width: number },
): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const page = doc.page;
    const originalBottom = page.margins.bottom;
    page.margins.bottom = 0;
    doc
      .fontSize(7)
      .font('Helvetica')
      .fillColor('#666666')
      .text(
        buildText(i - range.start + 1, range.count),
        options.x,
        page.height - 28,
        { width: options.width, align: 'center', lineBreak: false },
      );
    page.margins.bottom = originalBottom;
  }
  doc.fillColor('#000000');
}

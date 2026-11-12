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

/** Printed in place of a figure that has no data, so forms read complete. */
export const EMPTY_FIELD = '—';

export type PdfTranslate = (
  key: string,
  args?: Record<string, unknown>,
) => string;

/** A figure computed from monthly reports: the number, or a dash when null. */
export function formatFigure(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : EMPTY_FIELD;
}

/** Localized Yes/No (`bool.true` / `bool.false` of the report's i18n file); a dash when null. */
export function formatFlag(
  value: boolean | null | undefined,
  t: PdfTranslate,
): string {
  if (value === true) return t('bool.true');
  if (value === false) return t('bool.false');
  return EMPTY_FIELD;
}

/** Month name in the report locale, first letter capitalized ("Enero"). */
export function monthName(
  month: number,
  year: number,
  intlLocale: string,
): string {
  const name = new Intl.DateTimeFormat(intlLocale, {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  return name.charAt(0).toLocaleUpperCase(intlLocale) + name.slice(1);
}

/** "Month: text" lines for the per-month narrative entries of monthly data. */
export function monthlyTextLines(
  entries: { year: number; month: number; text: string }[] | null | undefined,
  intlLocale: string,
): string[] {
  return (entries ?? []).map(
    (entry) =>
      `${monthName(entry.month, entry.year, intlLocale)}: ${entry.text}`,
  );
}

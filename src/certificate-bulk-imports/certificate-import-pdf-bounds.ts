export const CERTIFICATE_IMPORT_MAX_PDF_PAGES = 5;

const PDF_WHITESPACE = new Set([0, 9, 10, 12, 13, 32]);

/** Index just past the payload. Ignores only PDF whitespace after %%EOF. */
export function certificateImportPdfPayloadEnd(bytes: Buffer): number {
  let end = bytes.length;
  while (end > 0 && PDF_WHITESPACE.has(bytes[end - 1])) end--;
  return end;
}

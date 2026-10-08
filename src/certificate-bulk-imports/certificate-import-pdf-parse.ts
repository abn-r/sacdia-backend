import {
  EncryptedPDFError,
  PDFDocument,
  PDFContext,
  PDFObjectParser,
  PDFDict,
  PDFRawStream,
  PDFName,
  PDFNumber,
  PDFArray,
  decodePDFRawStream,
} from 'pdf-lib';
import {
  CERTIFICATE_IMPORT_MAX_PDF_PAGES,
  certificateImportPdfPayloadEnd,
} from './certificate-import-pdf-bounds';
import {
  assertPdfDecodeCapInstalled,
  PDF_STREAM_CAP_BYTES,
  pdfDecodeCapStorage,
} from './certificate-import-pdf-decode-cap';

export const PDF_DECODE_CAP_UNAVAILABLE = 'PDF_DECODE_CAP_UNAVAILABLE';

export type PdfParseStats = {
  maxBuffer: number;
  maxTotal: number;
  beyond: number;
  exceeded: boolean;
};

export type PdfParseMessage = PdfParseStats &
  ({ ok: true; pages: number } | { ok: false; code: string });

const EMPTY_STATS: PdfParseStats = {
  maxBuffer: 0,
  maxTotal: 0,
  beyond: 0,
  exceeded: false,
};

/** pdf-lib load, final xref check, and page count. Runs only inside the worker. */
export async function parseCertificateImportPdf(
  bytes: Buffer,
): Promise<PdfParseMessage> {
  const cap = { total: 0, exceeded: false, maxBuffer: 0, maxTotal: 0 };
  const stats = (): PdfParseStats => ({
    maxBuffer: cap.maxBuffer,
    maxTotal: cap.maxTotal,
    beyond:
      cap.maxBuffer > PDF_STREAM_CAP_BYTES
        ? cap.maxBuffer - PDF_STREAM_CAP_BYTES
        : 0,
    exceeded: cap.exceeded,
  });

  try {
    assertPdfDecodeCapInstalled();
  } catch {
    return {
      ok: false,
      code: PDF_DECODE_CAP_UNAVAILABLE,
      ...EMPTY_STATS,
    };
  }

  const end = certificateImportPdfPayloadEnd(bytes);
  try {
    const pages = await pdfDecodeCapStorage.run(cap, async () => {
      const document = await PDFDocument.load(bytes, {
        ignoreEncryption: false,
        throwOnInvalidObject: true,
        updateMetadata: false,
      });
      if (cap.exceeded) {
        throw new Error('PDF decode cap exceeded');
      }
      assertFinalCrossReference(bytes.subarray(0, end), document.context);
      if (cap.exceeded) {
        throw new Error('PDF decode cap exceeded');
      }
      return document.getPageCount();
    });
    if (cap.exceeded) {
      return { ok: false, code: 'CERTIFICATE_IMPORT_PDF_INVALID', ...stats() };
    }
    if (!Number.isInteger(pages) || pages <= 0) {
      return { ok: false, code: 'CERTIFICATE_IMPORT_PDF_INVALID', ...stats() };
    }
    if (pages > CERTIFICATE_IMPORT_MAX_PDF_PAGES) {
      return {
        ok: false,
        code: 'CERTIFICATE_IMPORT_PDF_TOO_MANY_PAGES',
        ...stats(),
      };
    }
    return { ok: true, pages, ...stats() };
  } catch (error) {
    if (cap.exceeded) {
      return { ok: false, code: 'CERTIFICATE_IMPORT_PDF_INVALID', ...stats() };
    }
    const encrypted =
      error instanceof EncryptedPDFError ||
      (error instanceof Error &&
        error.message.startsWith(
          'Input document to `PDFDocument.load` is encrypted.',
        ));
    return {
      ok: false,
      code: encrypted
        ? 'CERTIFICATE_IMPORT_PDF_ENCRYPTED'
        : 'CERTIFICATE_IMPORT_PDF_INVALID',
      ...stats(),
    };
  }
}

const SPACE = '[\\x00\\t\\n\\f\\r ]';
const SPACE_RUN = new RegExp(`${SPACE}+`);

/** Only final closure/xref integrity, not a full PDF conformance validator. */
function assertFinalCrossReference(bytes: Buffer, context: PDFContext): void {
  const text = bytes.toString('latin1'); // 1 byte/character keeps offsets exact.
  const footer = new RegExp(`startxref${SPACE}+([0-9]+)${SPACE}+%%EOF$`).exec(
    text,
  );
  if (!footer || (footer.index > 0 && !SPACE_RUN.test(text[footer.index - 1])))
    throw new Error('invalid PDF closure');
  const offset = Number(footer[1]);
  if (!Number.isSafeInteger(offset) || offset < 8 || offset >= footer.index)
    throw new Error('invalid xref offset');
  const section = text.slice(offset, footer.index);
  let dictionary: PDFDict;
  if (new RegExp(`^xref${SPACE}`).test(section)) {
    const trailer = section.indexOf('trailer');
    if (trailer < 0) throw new Error('missing trailer');
    const tokens = section.slice(4, trailer).split(SPACE_RUN).filter(Boolean);
    let at = 0;
    while (at < tokens.length) {
      const firstToken = tokens[at++];
      const countToken = tokens[at++];
      if (!/^\d+$/.test(firstToken) || !/^\d+$/.test(countToken ?? ''))
        throw new Error('invalid xref subsection');
      const first = Number(firstToken);
      const count = Number(countToken);
      if (
        !Number.isSafeInteger(first) ||
        !Number.isSafeInteger(count) ||
        count < 0 ||
        count > (tokens.length - at) / 3
      )
        throw new Error('incomplete xref subsection');
      for (let n = 0; n < count; n++) {
        const position = tokens[at++];
        const generation = tokens[at++];
        const kind = tokens[at++];
        if (
          !/^\d{10}$/.test(position) ||
          !/^\d{5}$/.test(generation) ||
          !['n', 'f'].includes(kind)
        )
          throw new Error('invalid xref entry');
        if (kind === 'n') {
          const entryOffset = Number(position);
          if (entryOffset < 8 || entryOffset >= footer.index)
            throw new Error('invalid object offset');
          const header = new RegExp(
            `^([0-9]+)${SPACE}+([0-9]+)${SPACE}+obj(?:${SPACE}|[<\\[(/])`,
          ).exec(text.slice(entryOffset));
          if (
            !header ||
            Number(header[1]) !== first + n ||
            Number(header[2]) !== Number(generation)
          )
            throw new Error('xref does not identify its object');
        }
      }
    }
    const trailerBytes = Buffer.from(section.slice(trailer + 7), 'latin1');
    if (!new RegExp(`>>${SPACE}*$`).test(trailerBytes.toString('latin1')))
      throw new Error('incomplete trailer');
    const parsed = PDFObjectParser.forBytes(
      trailerBytes,
      context,
    ).parseObject();
    if (!(parsed instanceof PDFDict)) throw new Error('invalid trailer');
    dictionary = parsed;
  } else {
    dictionary = parseXrefStream(section, bytes, offset, footer.index, context);
  }
  const size = dictionary.lookup(PDFName.of('Size'), PDFNumber).asNumber();
  if (!Number.isSafeInteger(size) || size <= 0)
    throw new Error('invalid trailer size');
  const hybrid = dictionary.get(PDFName.of('XRefStm'));
  if (hybrid != null) {
    if (
      !(hybrid instanceof PDFNumber) ||
      !Number.isSafeInteger(hybrid.asNumber()) ||
      hybrid.asNumber() < 8 ||
      hybrid.asNumber() >= footer.index ||
      hybrid.asNumber() === offset
    )
      throw new Error('invalid hybrid xref offset');
    parseXrefStream(
      text.slice(hybrid.asNumber(), footer.index),
      bytes,
      hybrid.asNumber(),
      footer.index,
      context,
    );
  }
  const previous = dictionary.get(PDFName.of('Prev'));
  if (
    previous != null &&
    (!(previous instanceof PDFNumber) ||
      !Number.isSafeInteger(previous.asNumber()) ||
      previous.asNumber() < 8 ||
      previous.asNumber() >= footer.index ||
      previous.asNumber() === offset)
  )
    throw new Error('invalid previous xref offset');
  if (!dictionary.get(PDFName.of('Root')) && !previous)
    throw new Error('missing trailer root');
}

function parseXrefStream(
  section: string,
  bytes: Buffer,
  offset: number,
  footerIndex: number,
  context: PDFContext,
): PDFDict {
  const header = new RegExp(
    `^[0-9]+${SPACE}+[0-9]+${SPACE}+obj(?:${SPACE}+|(?=<<))`,
  ).exec(section);
  if (!header) throw new Error('incomplete xref stream');
  const parsed = PDFObjectParser.forBytes(
    bytes.subarray(offset + header[0].length, footerIndex),
    context,
  ).parseObject();
  if (
    !(parsed instanceof PDFRawStream) ||
    parsed.dict.get(PDFName.of('Type')) !== PDFName.of('XRef')
  )
    throw new Error('invalid xref stream');
  const dictionary = parsed.dict;
  const length = dictionary.lookup(PDFName.of('Length'), PDFNumber).asNumber();
  if (
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    length !== parsed.getContentsSize()
  )
    throw new Error('truncated xref stream');
  const marker = /stream(?:\r\n|\n|\r)/.exec(section.slice(header[0].length));
  if (!marker) throw new Error('missing xref stream content');
  const contentEnd =
    header[0].length + marker.index + marker[0].length + length;
  if (
    !new RegExp(`^${SPACE}*endstream${SPACE}+endobj(?:${SPACE}|$)`).test(
      section.slice(contentEnd),
    )
  )
    throw new Error('incomplete xref stream closure');
  const widths = dictionary.lookup(PDFName.of('W'), PDFArray);
  if (widths.size() !== 3) throw new Error('invalid xref widths');
  let rowWidth = 0;
  for (let n = 0; n < 3; n++) {
    const width = widths.lookup(n, PDFNumber).asNumber();
    if (!Number.isInteger(width) || width < 0 || width > 8)
      throw new Error('invalid xref width');
    rowWidth += width;
  }
  const size = dictionary.lookup(PDFName.of('Size'), PDFNumber).asNumber();
  const index = dictionary.get(PDFName.of('Index'));
  let rows = size;
  if (index != null) {
    if (!(index instanceof PDFArray) || index.size() % 2 !== 0)
      throw new Error('invalid xref index');
    rows = 0;
    for (let n = 0; n < index.size(); n += 2) {
      const start = index.lookup(n, PDFNumber).asNumber();
      const count = index.lookup(n + 1, PDFNumber).asNumber();
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(count) ||
        start < 0 ||
        count < 1 ||
        start + count > size
      )
        throw new Error('invalid xref range');
      rows += count;
    }
  }
  if (
    rowWidth === 0 ||
    !Number.isSafeInteger(rows) ||
    rows <= 0 ||
    decodePDFRawStream(parsed).decode().length !== rowWidth * rows
  )
    throw new Error('incomplete xref stream entries');
  return dictionary;
}

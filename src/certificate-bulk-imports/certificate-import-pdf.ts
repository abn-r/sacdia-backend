import { BadRequestException } from '@nestjs/common';
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
import { CERTIFICATE_IMPORT_MAX_BYTES } from './certificate-import-files.constants';

export const CERTIFICATE_IMPORT_MAX_PDF_PAGES = 5;

/** Parse the entire document: Vision's page selection must never truncate it. */
export async function assertCertificateImportPdf(
  bytes: Buffer,
): Promise<number> {
  if (bytes.length > CERTIFICATE_IMPORT_MAX_BYTES) {
    throw new BadRequestException('CERTIFICATE_IMPORT_FILE_TOO_LARGE');
  }
  // ISO 32000-1 §7.5.5 requires a terminal %%EOF. Ignore only PDF
  // whitespace after it: pdf-lib otherwise repairs truncated revisions.
  let end = bytes.length;
  while (end > 0 && [0, 9, 10, 12, 13, 32].includes(bytes[end - 1])) end--;
  if (
    bytes.length < 5 ||
    bytes.subarray(0, 5).toString('ascii') !== '%PDF-' ||
    end < 5 ||
    bytes.subarray(end - 5, end).toString('ascii') !== '%%EOF'
  ) {
    throw new BadRequestException('CERTIFICATE_IMPORT_PDF_INVALID');
  }
  let pages: number;
  try {
    const document = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
    assertFinalCrossReference(bytes.subarray(0, end), document.context);
    pages = document.getPageCount();
  } catch (error) {
    throw new BadRequestException(
      error instanceof EncryptedPDFError ||
        (error instanceof Error &&
          error.message.startsWith(
            'Input document to `PDFDocument.load` is encrypted.',
          ))
        ? 'CERTIFICATE_IMPORT_PDF_ENCRYPTED'
        : 'CERTIFICATE_IMPORT_PDF_INVALID',
    );
  }
  if (!Number.isInteger(pages) || pages <= 0) {
    throw new BadRequestException('CERTIFICATE_IMPORT_PDF_INVALID');
  }
  if (pages > CERTIFICATE_IMPORT_MAX_PDF_PAGES) {
    throw new BadRequestException('CERTIFICATE_IMPORT_PDF_TOO_MANY_PAGES');
  }
  return pages;
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

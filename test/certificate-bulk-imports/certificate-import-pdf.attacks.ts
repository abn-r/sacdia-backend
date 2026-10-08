import { createRequire } from 'node:module';
import { deflateSync, inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { CERTIFICATE_IMPORT_MAX_BYTES } from '../../src/certificate-bulk-imports/certificate-import-files.constants';
import {
  PDF_STREAM_CAP_BYTES,
  PDF_TOTAL_CAP_BYTES,
} from '../../src/certificate-bulk-imports/certificate-import-pdf-decode-cap';

const nodeRequire = createRequire(__filename);

export { PDF_STREAM_CAP_BYTES, PDF_TOTAL_CAP_BYTES };

/** Uncompressed size of a bomb. Unpatched pdf-lib turns this into a >=64 MiB buffer. */
export const PDF_BOMB_OUTPUT_BYTES = 64 * 1024 * 1024;

type ObjStmLocation = {
  filterAt: number;
  filterToken: string;
  lengthAt: number;
  length: number;
  dataStart: number;
};

type DecodeStreamCtor = {
  prototype: {
    ensureBuffer: ((requested: number) => Uint8Array) & {
      sacdiaPdfDecodeCap?: boolean;
    };
  };
};

function decodeStream(): DecodeStreamCtor {
  return nodeRequire('pdf-lib/cjs/core/streams/DecodeStream.js')
    .default as DecodeStreamCtor;
}

export function watchPdfDecodeAllocation(): {
  beyond: () => number;
  maxBuffer: () => number;
  maxTotal: () => number;
  capThrows: () => number;
  restore: () => void;
} {
  const proto = decodeStream().prototype;
  const impl = proto.ensureBuffer;
  const held = new WeakMap<object, number>();
  let beyond = 0;
  let maxBuffer = 0;
  let total = 0;
  let maxTotal = 0;
  let capThrows = 0;
  const wrapped = function wrapped(
    this: object & { buffer: Uint8Array },
    requested: number,
  ) {
    let result: Uint8Array;
    try {
      result = impl.call(this, requested);
    } catch (error) {
      capThrows += 1;
      throw error;
    }
    const previous = held.get(this) ?? 0;
    total += result.byteLength - previous;
    held.set(this, result.byteLength);
    maxBuffer = Math.max(maxBuffer, result.byteLength);
    maxTotal = Math.max(maxTotal, total);
    beyond = Math.max(
      beyond,
      Math.max(0, result.byteLength - PDF_STREAM_CAP_BYTES),
      Math.max(0, total - PDF_TOTAL_CAP_BYTES),
    );
    return result;
  };
  wrapped.sacdiaPdfDecodeCap = impl.sacdiaPdfDecodeCap;
  proto.ensureBuffer = wrapped;
  return {
    beyond: () => beyond,
    maxBuffer: () => maxBuffer,
    maxTotal: () => maxTotal,
    capThrows: () => capThrows,
    restore: () => {
      proto.ensureBuffer = impl;
    },
  };
}

function locateObjStm(bytes: Buffer): ObjStmLocation {
  const typeAt = bytes.indexOf('/Type /ObjStm');
  if (typeAt < 0) throw new Error('fixture has no ObjStm');
  const filterToken = '/Filter /FlateDecode';
  const filterAt = bytes.lastIndexOf(filterToken, typeAt);
  const streamAt = bytes.indexOf('stream\n', typeAt);
  const dict = bytes.subarray(filterAt, streamAt).toString('latin1');
  const length = Number(dict.match(/\/Length (\d+)/)?.[1]);
  if (!Number.isSafeInteger(length) || filterAt < 0 || streamAt < 0) {
    throw new Error('fixture ObjStm is not a direct FlateDecode stream');
  }
  const lengthToken = `/Length ${length}`;
  const lengthAt = dict.lastIndexOf(lengthToken);
  if (lengthAt < 0) throw new Error('fixture ObjStm has no length');
  return {
    filterAt,
    filterToken,
    lengthAt: filterAt + lengthAt,
    length,
    dataStart: streamAt + 'stream\n'.length,
  };
}

function retargetXref(bytes: Buffer): Buffer {
  const xrefObj = bytes.indexOf('/Type /XRef');
  let headerStart = bytes.lastIndexOf('obj', xrefObj);
  headerStart = bytes.lastIndexOf('\n', headerStart - 1) + 1;
  return Buffer.concat([
    bytes.subarray(0, bytes.indexOf('startxref')),
    Buffer.from(`startxref\n${headerStart}\n%%EOF\n`),
  ]);
}

async function savedPage(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage();
  return Buffer.from(await document.save());
}

function replaceObjStm(
  original: Buffer,
  filterToken: string,
  payload: Buffer,
): Buffer {
  const located = locateObjStm(original);
  const next = Buffer.concat([
    original.subarray(0, located.filterAt),
    Buffer.from(filterToken),
    original.subarray(
      located.filterAt + located.filterToken.length,
      located.lengthAt,
    ),
    Buffer.from(`/Length ${payload.length}`),
    original.subarray(
      located.lengthAt + `/Length ${located.length}`.length,
      located.dataStart,
    ),
    payload,
    original.subarray(located.dataStart + located.length),
  ]);
  const rebuilt = retargetXref(next);
  if (rebuilt.length > CERTIFICATE_IMPORT_MAX_BYTES) {
    throw new Error('attack fixture exceeds the 10 MiB file cap');
  }
  return rebuilt;
}

function replaceLiteral(bytes: Buffer, from: string, to: string): Buffer {
  const at = bytes.indexOf(from);
  if (at < 0) throw new Error(`fixture is missing ${from}`);
  return Buffer.concat([
    bytes.subarray(0, at),
    Buffer.from(to),
    bytes.subarray(at + from.length),
  ]);
}

function compressedRun(bytes: number): Buffer {
  return deflateSync(Buffer.alloc(bytes, 0x20));
}

/** ObjStm + FlateDecode whose inflate is one byte over the stream cap. */
export async function flateObjStmOverCap(): Promise<Buffer> {
  const original = await savedPage();
  const located = locateObjStm(original);
  const inflated = inflateSync(
    original.subarray(located.dataStart, located.dataStart + located.length),
  );
  const padded = Buffer.concat([
    inflated,
    Buffer.alloc(PDF_STREAM_CAP_BYTES + 1 - inflated.length, 0x20),
  ]);
  return replaceObjStm(original, '/Filter /FlateDecode', deflateSync(padded));
}

/**
 * Case A. `/Obj#53tm` is `/ObjStm` and `/Fl#61teDecode` is `/FlateDecode`.
 * The uncompressed ObjStm is 64 MiB; the file stays far below that.
 */
export async function hexEscapedFlateObjStm(): Promise<Buffer> {
  const original = await savedPage();
  const bombed = replaceObjStm(
    original,
    '/Filter /FlateDecode',
    compressedRun(PDF_BOMB_OUTPUT_BYTES),
  );
  return retargetXref(
    replaceLiteral(
      replaceLiteral(bombed, '/Filter /FlateDecode', '/Filter /Fl#61teDecode'),
      '/Type /ObjStm',
      '/Type /Obj#53tm',
    ),
  );
}

/**
 * Case B. A comment sits between the generation number and `obj`
 * (`N G %x\\nobj`), the same shape as `4 0 %x\\nobj`.
 */
export async function commentBeforeObjKeyword(): Promise<Buffer> {
  const original = await savedPage();
  const bombed = replaceObjStm(
    original,
    '/Filter /FlateDecode',
    compressedRun(PDF_BOMB_OUTPUT_BYTES),
  );
  const typeAt = bombed.indexOf('/Type /ObjStm');
  const objAt = bombed.lastIndexOf('obj', typeAt);
  if (typeAt < 0 || objAt < 0) throw new Error('fixture has no ObjStm header');
  return retargetXref(
    Buffer.concat([
      bombed.subarray(0, objAt),
      Buffer.from('%x\n'),
      bombed.subarray(objAt),
    ]),
  );
}

/**
 * Case D. After the original trailer, an incremental object header is split
 * across lines: `4\\n0\\nobj`.
 */
export async function newlineHeaderAfterTrailer(): Promise<Buffer> {
  const original = await savedPage();
  const payload = compressedRun(PDF_BOMB_OUTPUT_BYTES);
  const bytes = Buffer.concat([
    original,
    Buffer.from(
      `4\n0\nobj\n<< /Type /ObjStm /Filter /FlateDecode /N 1 /First 0 /Length ${payload.length} >>\nstream\n`,
    ),
    payload,
    Buffer.from('\nendstream\nendobj\nstartxref\n9\n%%EOF\n'),
  ]);
  if (bytes.length > CERTIFICATE_IMPORT_MAX_BYTES) {
    throw new Error('attack fixture exceeds the 10 MiB file cap');
  }
  return bytes;
}

/** ObjStm whose filter array is `/FlateDecode` applied twice. */
export async function doubleFlateObjStm(): Promise<Buffer> {
  const original = await savedPage();
  return replaceObjStm(
    original,
    '/Filter [/FlateDecode /FlateDecode]',
    deflateSync(compressedRun(PDF_BOMB_OUTPUT_BYTES)),
  );
}

/**
 * PDF LZW, early-change 1, for a run of one byte.
 * Matches pdf-lib 1.17.1 LZWStream bit order.
 */
function lzwEncodeRun(byte: number, length: number): Buffer {
  let codeLength = 9;
  let nextCode = 258;
  const byLength = new Map<number, number>([[1, byte]]);
  const out: number[] = [];
  let accumulator = 0;
  let bits = 0;
  const write = (code: number) => {
    accumulator = (accumulator << codeLength) | code;
    bits += codeLength;
    while (bits >= 8) {
      bits -= 8;
      out.push((accumulator >> bits) & 255);
      accumulator &= (1 << bits) - 1;
    }
  };
  const syncWidth = () => {
    const marker = nextCode + 1;
    if ((marker & (marker - 1)) === 0) {
      codeLength = Math.min((Math.log(marker) / Math.LN2 + 1) | 0, 12);
    }
  };
  const reset = () => {
    codeLength = 9;
    nextCode = 258;
    byLength.clear();
    byLength.set(1, byte);
    write(256);
  };
  // pdf-lib's 12-bit dictionary diverges on one long run. Clear while the
  // table still round-trips, every 20 KiB of this single-byte input.
  const chunk = 20_000;
  reset();
  let current = 0;
  for (let index = 0; index < length; index++) {
    if (index > 0 && index % chunk === 0) {
      const code = byLength.get(current);
      if (code == null) throw new Error('LZW run is missing its code');
      write(code);
      reset();
      current = 0;
    }
    const extended = current + 1;
    if (current > 0 && byLength.has(extended)) {
      current = extended;
      continue;
    }
    if (current === 0) {
      current = 1;
      continue;
    }
    const code = byLength.get(current);
    if (code == null) throw new Error('LZW run is missing its code');
    write(code);
    if (nextCode < 4096) {
      byLength.set(extended, nextCode);
      nextCode += 1;
      syncWidth();
    }
    current = 1;
  }
  if (current > 0) {
    const code = byLength.get(current);
    if (code == null) throw new Error('LZW run is missing its final code');
    write(code);
  }
  write(257);
  if (bits > 0) out.push((accumulator << (8 - bits)) & 255);
  return Buffer.from(out);
}

/** ObjStm stored as LZW with `/Obj#53tm` and `/LZW#44ecode` (`/LZWDecode`). */
export async function escapedLzwObjStm(): Promise<Buffer> {
  const original = await savedPage();
  const bombed = replaceObjStm(
    original,
    '/Filter /LZW#44ecode',
    lzwEncodeRun(0x20, PDF_BOMB_OUTPUT_BYTES),
  );
  return retargetXref(
    replaceLiteral(bombed, '/Type /ObjStm', '/Type /Obj#53tm'),
  );
}

function objStmObject(id: number, decodedBytes: number): Buffer {
  const payload = compressedRun(decodedBytes);
  return Buffer.concat([
    Buffer.from(
      `${id} 0 obj\n<< /Type /ObjStm /Filter /FlateDecode /N 0 /First 0 /Length ${payload.length} >>\nstream\n`,
    ),
    payload,
    Buffer.from('\nendstream\nendobj\n'),
  ]);
}

/** Two ObjStms that each need a full stream-cap buffer, then one more byte. */
export function objStmsOverTotalCap(): Buffer {
  const wide = PDF_STREAM_CAP_BYTES / 2 + 1;
  const bytes = Buffer.concat([
    Buffer.from('%PDF-1.7\n'),
    objStmObject(1, wide),
    objStmObject(2, wide),
    objStmObject(3, 1),
    Buffer.from('startxref\n9\n%%EOF\n'),
  ]);
  if (bytes.length > CERTIFICATE_IMPORT_MAX_BYTES) {
    throw new Error('total-cap fixture exceeds the 10 MiB file cap');
  }
  return bytes;
}

function xrefStream(dictBody: string): Buffer {
  const header = '%PDF-1.7\n';
  const body = `1 0 obj\n<< ${dictBody} >>\nstream\nendstream\nendobj\n`;
  const start = Buffer.byteLength(header);
  return Buffer.from(`${header}${body}startxref\n${start}\n%%EOF\n`);
}

/**
 * `/W [0 0 0]` makes PDFXRefStreamParser walk N entries without reading bytes.
 * Each entry calls PDFRef.of, which keeps the ref in a module-level pool.
 */
export function xrefZeroWidthEntries(entries: number): Buffer {
  return xrefStream(
    `/Type /XRef /Size ${entries} /W [0 0 0] /Index [0 ${entries}] /Root 1 0 R /Length 0`,
  );
}

/** One xref entry whose field width is large enough to burn CPU in pdf-lib. */
export function xrefHugeFieldWidth(width: number): Buffer {
  return xrefStream(
    `/Type /XRef /Size 1 /W [${width} 0 0] /Index [0 1] /Root 1 0 R /Length 0`,
  );
}

/** Two ObjStms whose buffers sum to the total cap and do not exceed it. */
export function objStmsAtTotalCap(): Buffer {
  const wide = PDF_STREAM_CAP_BYTES / 2 + 1;
  const bytes = Buffer.concat([
    Buffer.from('%PDF-1.7\n'),
    objStmObject(1, wide),
    objStmObject(2, wide),
    Buffer.from('startxref\n9\n%%EOF\n'),
  ]);
  if (bytes.length > CERTIFICATE_IMPORT_MAX_BYTES) {
    throw new Error('total-cap fixture exceeds the 10 MiB file cap');
  }
  return bytes;
}

import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Caps pdf-lib 1.17.1 decompression at the allocation inside
 * DecodeStream.ensureBuffer. Flate, LZW, ASCII85, ASCIIHex and RunLength all
 * grow their output there, including chained filters.
 *
 * Node, TypeScript and Jest resolve `pdf-lib` to `cjs/index.js` (`main`).
 * The package also ships `es/` via the `module` field. That build uses
 * extensionless imports, so Node never instantiates it, but a bundler would.
 * Both copies are patched to call the hook below. A runtime wrap of only the
 * loaded prototype would leave the es copy unchanged.
 *
 * PDFParser awaits between indirect objects, so two PDFDocument.load calls can
 * interleave. The byte total is an AsyncLocalStorage store owned by each
 * assertCertificateImportPdf call, not a process-wide counter.
 *
 * The prescan was removed. It missed hex-escaped names and split object
 * headers, and it rejected a wrong /Length, which real scanners emit and
 * pdf-lib accepts. Unfiltered bytes are already in the file and do not pass
 * through ensureBuffer.
 */
/**
 * Legitimate ObjStm/XRef buffers measured on 1-page, 5-page, ~9.2 MiB scan,
 * and the QPDF fixtures stay at 0–1024 bytes. 1 MiB / 2 MiB is three orders
 * of magnitude over that and keeps a decompression bomb inside the 128 MiB
 * RSS budget. ArrayBuffers are not covered by the worker heap limit.
 */
export const PDF_STREAM_CAP_BYTES = 1 * 1024 * 1024;
export const PDF_TOTAL_CAP_BYTES = 2 * 1024 * 1024;

const HOOK = Symbol.for('sacdia.pdf-lib.decode-cap');
const MARKER = 'sacdia.pdf-lib.decode-cap';

const nodeRequire = createRequire(__filename);

type StreamLike = {
  buffer: Uint8Array;
  minBufferLength: number;
};

type CapStore = {
  total: number;
  exceeded: boolean;
  maxBuffer: number;
  maxTotal: number;
};

export const pdfDecodeCapStorage = new AsyncLocalStorage<CapStore>();

function cappedEnsureBuffer(stream: StreamLike, requested: number): Uint8Array {
  const buffer = stream.buffer;
  if (requested <= buffer.byteLength) return buffer;
  let size = stream.minBufferLength;
  while (size < requested) {
    size *= 2;
    if (size > PDF_STREAM_CAP_BYTES) break;
  }
  const store = pdfDecodeCapStorage.getStore();
  if (!store) {
    const next = new Uint8Array(size);
    next.set(buffer);
    stream.buffer = next;
    return next;
  }
  const previous = buffer.byteLength;
  if (
    store.exceeded ||
    size > PDF_STREAM_CAP_BYTES ||
    store.total - previous + size > PDF_TOTAL_CAP_BYTES
  ) {
    store.exceeded = true;
    throw new Error('PDF decode cap exceeded');
  }
  const next = new Uint8Array(size);
  next.set(buffer);
  store.total = store.total - previous + size;
  if (size > store.maxBuffer) store.maxBuffer = size;
  if (store.total > store.maxTotal) store.maxTotal = store.total;
  stream.buffer = next;
  return next;
}

export function installPdfDecodeCap(): void {
  if (Reflect.get(globalThis, HOOK) === cappedEnsureBuffer) return;
  Reflect.set(globalThis, HOOK, cappedEnsureBuffer);
}

function pdfLibRoot(): string {
  return dirname(dirname(nodeRequire.resolve('pdf-lib')));
}

let decodeCapVerified = false;

export function assertPdfDecodeCapInstalled(): void {
  if (decodeCapVerified) return;
  installPdfDecodeCap();
  const root = pdfLibRoot();
  const cjsSource = readFileSync(
    join(root, 'cjs/core/streams/DecodeStream.js'),
    'utf8',
  );
  const esSource = readFileSync(
    join(root, 'es/core/streams/DecodeStream.js'),
    'utf8',
  );
  const live = nodeRequire('pdf-lib/cjs/core/streams/DecodeStream.js')
    .default as {
    prototype: {
      ensureBuffer?: { sacdiaPdfDecodeCap?: boolean };
    };
  };
  if (
    live.prototype.ensureBuffer?.sacdiaPdfDecodeCap !== true ||
    !cjsSource.includes(MARKER) ||
    !esSource.includes(MARKER) ||
    Reflect.get(globalThis, HOOK) !== cappedEnsureBuffer
  ) {
    throw new Error('PDF decode cap is not installed');
  }
  decodeCapVerified = true;
}

installPdfDecodeCap();

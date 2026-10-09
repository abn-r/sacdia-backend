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
 * The cap compares the allocated buffer, always a power of two (512 B * 2^k),
 * so a stream that decodes to N bytes costs up to 2N. `total` adds every
 * buffer a validation allocates and never subtracts finished streams. Load
 * and the final xref check each decode an XRef stream, so it counts twice.
 *
 * Only /ObjStm and /XRef streams are decoded on load. Measured 2026-10-08
 * (pdf-lib 1.17.1, a counting hook with this same accounting, PDFs from
 * test/certificate-bulk-imports/certificate-import-pdf.legit.ts). qpdf is not
 * installed here, so "100/ObjStm" is pdf-lib's PDFStreamWriter at the 100
 * objects per ObjStm that qpdf and PDFBox use. Sizes are decoded bytes; the
 * buffer is the power-of-two allocation the cap sees. XRef is one decode.
 *
 *   PDF (5 pages unless noted)       file   largest ObjStm       XRef  total
 *   1 or 5 pages, std. fonts         <2 K   1.5 K                0.1 K  3 K
 *   repo qpdf fixtures (no Flate)    17 K   none                 none   0
 *   1 page, 2000 annots, 50/ObjStm   47 K   17 K, buffer 32 K    10 K   544 K
 *   10000 annots, 100/ObjStm         202 K  34 K, buffer 64 K    59 K   3.4 M
 *   16000 annots, 100/ObjStm         325 K  47 K, buffer 64 K    95 K   5.4 M
 *   16000 annots, one ObjStm         276 K  2.73 M, buffer 4 M   94 K   4.3 M
 *   1000 form fields, one ObjStm     757 K  375 K, buffer 512 K  24 K   576 K
 *   5000 outlines, one ObjStm        78 K   514 K, buffer 1 M    29 K   1.1 M
 *   400 /Widths fonts, one ObjStm    16 K   489 K, buffer 512 K  4 K    520 K
 *
 * The worker heap (48/16 MiB below) is the real ceiling for legitimate PDFs:
 * 16000 annotations on 5 pages still parse, 18000 die with
 * ERR_WORKER_OUT_OF_MEMORY before any cap here applies. A bigger mix (28000
 * objects, 4.8 MiB decoded in one ObjStm, 8 MiB buffer, 9 MiB total) is
 * rejected by the heap, not by these caps. The worst parseable legitimate
 * case is a 4 MiB buffer and 5.4 MiB total.
 *
 * 8 MiB per stream is 2x that buffer; 4 MiB would leave none. 16 MiB total is
 * 2.9x that total; 8 MiB would leave 1.4x. The previous 1 MiB / 2 MiB
 * rejected any 5-page PDF above ~6000 annotations, in either layout.
 *
 * RSS above an idle parent, one fresh process per scenario, sampled every
 * 5 ms, 3 runs each, MiB. Budget 128. An idle worker alone costs 31.
 * "x3" is three callers at once.
 *
 *   scenario                              one        x3
 *   14000 annots, 100/ObjStm              48-50      -
 *   14000 annots, one 4 MiB buffer        54-58      60-67
 *   ObjStm inflating to exactly 8 MiB     37-38      44-45
 *   same, one byte over (rejected)        36-37      -
 *   2 buffers of 8 MiB (total cap)        42         -
 *   64 buffers of 256 KiB (total cap)     44         -
 *   64 MiB inflate bomb                   44-46      52-53
 *   XRef N=20M, bound by the heap         70-73      73-77
 *
 * With the previous caps the bomb and total-cap rows were 31-37. The worst
 * row is the XRef attack, which the heap bounds and these caps do not touch.
 * Prefixing it with 2 buffers of 8 MiB measured 74-80. ArrayBuffers are not
 * covered by the worker heap limit.
 */
export const PDF_STREAM_CAP_BYTES = 8 * 1024 * 1024;
export const PDF_TOTAL_CAP_BYTES = 16 * 1024 * 1024;

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

import { performance } from 'node:perf_hooks';
import { PDFDocument, PDFName } from 'pdf-lib';
import { assertCertificateImportPdf } from '../../src/certificate-bulk-imports/certificate-import-pdf';
import {
  flateObjStmAtCap,
  flateObjStmOverCap,
  hexEscapedFlateObjStm,
  objStmsAtTotalCap,
  objStmsSpreadAtTotalCap,
  xrefZeroWidthEntries,
} from './certificate-import-pdf.attacks';
import { heavyLegitPdf } from './certificate-import-pdf.legit';

type Row = {
  name: string;
  fileBytes: number;
  ms: number;
  rssDelta: number;
  outcome: string;
};

async function textPdf(pages: number): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (let n = 0; n < pages; n++) document.addPage();
  return Buffer.from(await document.save({ addDefaultPage: false }));
}

async function scannedPdf(payloadBytes: number): Promise<Buffer> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const payload = Buffer.alloc(payloadBytes);
  for (let i = 0; i < payload.length; i += 251) payload[i] = (i * 17) & 0xff;
  const image = document.context.register(
    document.context.stream(payload, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: 2480,
      Height: 3508,
      ColorSpace: 'DeviceGray',
      BitsPerComponent: 8,
      Filter: 'DCTDecode',
      Length: payload.length,
    }),
  );
  page.node
    .lookup(PDFName.of('Resources'))
    .set(PDFName.of('XObject'), document.context.obj({ Im0: image }));
  return Buffer.from(await document.save({ addDefaultPage: false }));
}

async function peakRss(
  name: string,
  bytes: Buffer | Buffer[],
  run: () => Promise<unknown>,
): Promise<Row> {
  const collect = (global as typeof globalThis & { gc?: () => void }).gc;
  collect?.();
  const before = process.memoryUsage().rss;
  let peak = before;
  const timer = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > peak) peak = rss;
  }, 5);
  const started = performance.now();
  let outcome = 'ok';
  try {
    await run();
  } catch (error) {
    outcome = error instanceof Error ? error.message : 'error';
  } finally {
    clearInterval(timer);
    const rss = process.memoryUsage().rss;
    if (rss > peak) peak = rss;
  }
  const fileBytes = Array.isArray(bytes)
    ? bytes.reduce((sum, item) => sum + item.length, 0)
    : bytes.length;
  return {
    name,
    fileBytes,
    ms: Math.round(performance.now() - started),
    rssDelta: peak - before,
    outcome,
  };
}

async function settled(bytes: Buffer): Promise<string> {
  return assertCertificateImportPdf(bytes).then(
    () => 'accepted',
    (error: unknown) => (error instanceof Error ? error.message : 'error'),
  );
}

/** Three callers at once. The single worker slot serializes them. */
async function threeAtOnce(bytes: Buffer, expected: string): Promise<void> {
  const results = await Promise.all([
    settled(bytes),
    settled(bytes),
    settled(bytes),
  ]);
  if (results.some((item) => item !== expected)) {
    throw new Error(results.join(','));
  }
}

/**
 * Largest heavy legitimate shapes the 48/16 MiB worker heap still parses:
 * 5 pages and 14000 link annotations (16000 still parse; 18000 dies with
 * ERR_WORKER_OUT_OF_MEMORY before any decode cap matters).
 */
const HEAVY_ANNOTATIONS_PER_PAGE = 2800;

type Scenario = {
  make: () => Promise<Buffer> | Buffer;
  /** Defaults to one assertCertificateImportPdf call. */
  concurrent?: string;
};

export const RSS_PROBE_ROWS = [
  'pages1',
  'pages5',
  'scan9MiB',
  'xref20M',
  'inflateBomb',
  'inflateAtCap',
  'inflateOverCap',
  'totalCapTwoStreams',
  'totalCapSpread64',
  'heavyManyObjStm',
  'heavyOneObjStm',
  'xref20Mx3',
  'inflateBombx3',
  'inflateAtCapx3',
  'heavyOneObjStmx3',
] as const;

const heavyMany = () =>
  heavyLegitPdf({
    pages: 5,
    annotationsPerPage: HEAVY_ANNOTATIONS_PER_PAGE,
    objectsPerStream: 100,
  });
const heavyOne = () =>
  heavyLegitPdf({
    pages: 5,
    annotationsPerPage: HEAVY_ANNOTATIONS_PER_PAGE,
    objectsPerStream: 1_000_000,
  });

const SCENARIOS: Record<(typeof RSS_PROBE_ROWS)[number], Scenario> = {
  pages1: { make: () => textPdf(1) },
  pages5: { make: () => textPdf(5) },
  scan9MiB: { make: () => scannedPdf(9_200_000) },
  xref20M: { make: () => xrefZeroWidthEntries(20_000_000) },
  inflateBomb: { make: () => hexEscapedFlateObjStm() },
  inflateAtCap: { make: () => flateObjStmAtCap() },
  inflateOverCap: { make: () => flateObjStmOverCap() },
  totalCapTwoStreams: { make: () => objStmsAtTotalCap() },
  totalCapSpread64: { make: () => objStmsSpreadAtTotalCap(64) },
  heavyManyObjStm: { make: heavyMany },
  heavyOneObjStm: { make: heavyOne },
  xref20Mx3: {
    make: () => xrefZeroWidthEntries(20_000_000),
    concurrent: 'CERTIFICATE_IMPORT_PDF_INVALID',
  },
  inflateBombx3: {
    make: () => hexEscapedFlateObjStm(),
    concurrent: 'CERTIFICATE_IMPORT_PDF_INVALID',
  },
  inflateAtCapx3: { make: () => flateObjStmAtCap(), concurrent: 'accepted' },
  heavyOneObjStmx3: { make: heavyOne, concurrent: 'accepted' },
};

/**
 * One scenario per process: RSS pages freed by an earlier scenario would
 * otherwise be reused and hide the next scenario's growth.
 * Usage: rss-budget-probe.ts [row ...]. Default: all rows, in one process.
 */
async function main(): Promise<void> {
  const wanted = process.argv.slice(2);
  const names = (
    wanted.length > 0 ? wanted : [...RSS_PROBE_ROWS]
  ) as (typeof RSS_PROBE_ROWS)[number][];
  const rows: Row[] = [];
  for (const name of names) {
    const scenario = SCENARIOS[name];
    if (!scenario) throw new Error(`unknown RSS probe row ${name}`);
    const bytes = await scenario.make();
    const run = scenario.concurrent
      ? () => threeAtOnce(bytes, scenario.concurrent as string)
      : () => assertCertificateImportPdf(bytes);
    rows.push(await peakRss(name, bytes, run));
  }
  process.stdout.write(JSON.stringify(rows));
}

if (require.main === module) void main();

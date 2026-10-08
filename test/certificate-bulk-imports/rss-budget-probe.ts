import { performance } from 'node:perf_hooks';
import { PDFDocument, PDFName } from 'pdf-lib';
import { assertCertificateImportPdf } from '../../src/certificate-bulk-imports/certificate-import-pdf';
import {
  hexEscapedFlateObjStm,
  xrefZeroWidthEntries,
} from './certificate-import-pdf.attacks';

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

async function main(): Promise<void> {
  const one = await textPdf(1);
  const five = await textPdf(5);
  const scan = await scannedPdf(9_200_000);
  const attack = xrefZeroWidthEntries(20_000_000);
  const bomb = await hexEscapedFlateObjStm();
  const rows: Row[] = [];
  rows.push(
    await peakRss('pages1', one, () => assertCertificateImportPdf(one)),
  );
  rows.push(
    await peakRss('pages5', five, () => assertCertificateImportPdf(five)),
  );
  rows.push(
    await peakRss('scan9MiB', scan, () => assertCertificateImportPdf(scan)),
  );
  rows.push(
    await peakRss('xref20M', attack, () => assertCertificateImportPdf(attack)),
  );
  rows.push(
    await peakRss('inflateBomb', bomb, () => assertCertificateImportPdf(bomb)),
  );
  rows.push(
    await peakRss('xref20Mx3', attack, async () => {
      const results = await Promise.all([
        assertCertificateImportPdf(attack).then(
          () => 'accepted',
          (error: unknown) =>
            error instanceof Error ? error.message : 'error',
        ),
        assertCertificateImportPdf(attack).then(
          () => 'accepted',
          (error: unknown) =>
            error instanceof Error ? error.message : 'error',
        ),
        assertCertificateImportPdf(attack).then(
          () => 'accepted',
          (error: unknown) =>
            error instanceof Error ? error.message : 'error',
        ),
      ]);
      if (results.some((item) => item !== 'CERTIFICATE_IMPORT_PDF_INVALID')) {
        throw new Error(results.join(','));
      }
    }),
  );
  process.stdout.write(JSON.stringify(rows));
}

void main();

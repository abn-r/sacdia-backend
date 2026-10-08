import { assertCertificateImportPdf } from '../../src/certificate-bulk-imports/certificate-import-pdf';
import { xrefZeroWidthEntries } from './certificate-import-pdf.attacks';

async function main(): Promise<void> {
  const entries = Number(process.argv[2] ?? '4000000');
  const bytes = xrefZeroWidthEntries(entries);
  const collect = (global as typeof globalThis & { gc?: () => void }).gc;
  if (typeof collect !== 'function') {
    throw new Error('parent heap probe requires --expose-gc');
  }

  collect();
  const before = process.memoryUsage().heapUsed;
  let rejected = false;
  try {
    await assertCertificateImportPdf(bytes);
  } catch (error) {
    rejected =
      error instanceof Error &&
      error.message === 'CERTIFICATE_IMPORT_PDF_INVALID';
  }
  collect();
  const after = process.memoryUsage().heapUsed;
  process.stdout.write(
    JSON.stringify({
      rejected,
      before,
      after,
      delta: after - before,
      fileBytes: bytes.length,
    }),
  );
}

void main();

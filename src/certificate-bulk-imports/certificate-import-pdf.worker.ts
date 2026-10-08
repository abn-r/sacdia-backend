import { parentPort, workerData } from 'node:worker_threads';
import { parseCertificateImportPdf } from './certificate-import-pdf-parse';

type Payload = {
  bytes?: Uint8Array;
  holdReady?: boolean;
  holdExit?: boolean;
};

async function main(): Promise<void> {
  const payload = workerData as Payload;
  if (payload.holdReady) {
    await new Promise<void>((resolve) => {
      parentPort?.once('message', () => resolve());
    });
  }
  parentPort?.postMessage({ ready: true });

  const view = payload.bytes;
  const bytes =
    view instanceof Uint8Array
      ? Buffer.from(view.buffer, view.byteOffset, view.byteLength)
      : Buffer.alloc(0);

  try {
    const message = await parseCertificateImportPdf(bytes);
    parentPort?.postMessage(message);
  } catch {
    parentPort?.postMessage({
      ok: false,
      code: 'CERTIFICATE_IMPORT_PDF_INVALID',
      maxBuffer: 0,
      maxTotal: 0,
      beyond: 0,
      exceeded: false,
    });
  }
  if (payload.holdExit) setInterval(() => undefined, 1_000_000);
}

void main();

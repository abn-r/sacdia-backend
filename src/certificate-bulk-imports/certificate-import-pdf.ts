import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import {
  CERTIFICATE_IMPORT_MAX_PDF_PAGES,
  certificateImportPdfPayloadEnd,
} from './certificate-import-pdf-bounds';
import { CERTIFICATE_IMPORT_MAX_BYTES } from './certificate-import-files.constants';

export { CERTIFICATE_IMPORT_MAX_PDF_PAGES };

/**
 * Render Free, confirmed 2026-10-07: 512 MiB RAM and 0.1 CPU, no memory
 * metrics. render.yaml says "starter" and is not a source of truth.
 * Assumption, not a measurement: the Nest parent can already occupy ~300 MiB.
 * One validation may add at most 128 MiB of process RSS, so a single attack
 * stays inside the 512 MiB box.
 */
export const PDF_RENDER_FREE_RAM_BYTES = 512 * 1024 * 1024;
export const PDF_PARENT_RSS_ASSUMPTION_BYTES = 300 * 1024 * 1024;
export const PDF_VALIDATION_RSS_BUDGET_BYTES = 128 * 1024 * 1024;

/** One validation worker per process. A second isolate would stack RSS. */
export const PDF_WORKER_MAX_ACTIVE = 1;
/** Waiters behind the active worker. The next call is rejected with no worker. */
export const PDF_WORKER_MAX_WAITING = 4;

/**
 * From `new Worker` until `{ ready: true }`. The worker sends that after
 * imports, including pdf-lib. `'online'` fires before those imports and is
 * not this deadline. A 1-page worker on this machine starts in ~140 ms. At
 * 0.1 CPU that can be about 10× slower, so the budget is 10 s and does not
 * include queue time or parse time.
 */
export const PDF_WORKER_STARTUP_DEADLINE_MS = 10_000;

/** From `{ ready: true }` until the worker posts its parse result. */
export const PDF_PARSE_DEADLINE_MS = 2_000;

/**
 * confirm() queue wait. Flutter `receiveTimeout` is 15 s. Startup 10 s +
 * parse 2 s + this 2 s = 14 s, under that timeout even if startup is slow.
 */
export const PDF_CONFIRM_QUEUE_WAIT_MS = 2_000;

/**
 * OCR BullMQ queue wait. Not on the HTTP receive timeout. Four predecessors
 * can each use the startup budget and the parse budget.
 */
export const PDF_OCR_QUEUE_WAIT_MS =
  PDF_WORKER_MAX_WAITING *
  (PDF_WORKER_STARTUP_DEADLINE_MS + PDF_PARSE_DEADLINE_MS);

/**
 * How long the slot stays taken after the caller has a result, until
 * `terminate()` exits. If this expires, the slot is released anyway.
 */
export const PDF_WORKER_EXIT_WAIT_MS = 1_000;

export const PDF_WORKER_EXIT_TIMEOUT =
  'PDF validation worker did not exit before the release deadline';

/**
 * Old/young caps for one worker, sized from legitimate PDFs (1 page, 5 pages,
 * and a ~9.2 MiB synthetic scan), not from the xref bomb. Those workers used
 * ~20 MiB of heap and at most ~53 MiB of extra RSS. 48/16 leaves margin over
 * the ~32 MiB heapTotal and stays inside the 128 MiB RSS budget when the
 * isolate grows to the cap. ArrayBuffers are outside this limit; the decode
 * cap covers them.
 */
const PDF_WORKER_OLD_SPACE_MB = 48;
const PDF_WORKER_YOUNG_SPACE_MB = 16;

const PDF_DECODE_CAP_UNAVAILABLE = 'PDF_DECODE_CAP_UNAVAILABLE';
export const PDF_WORKER_BUNDLE_MISSING =
  'PDF validation worker bundle is missing';

/**
 * Default when the caller omits `queueFullCode`. The OCR worker passes
 * `CERTIFICATE_IMPORT_OCR_UNAVAILABLE`. confirm() passes
 * `CERTIFICATE_IMPORT_PDF_BUSY`, which is HTTP 429.
 */
const PDF_QUEUE_FULL = 'CERTIFICATE_IMPORT_OCR_UNAVAILABLE';

const PDF_CODES = new Set([
  'CERTIFICATE_IMPORT_PDF_INVALID',
  'CERTIFICATE_IMPORT_PDF_ENCRYPTED',
  'CERTIFICATE_IMPORT_PDF_TOO_MANY_PAGES',
]);

export type CertificateImportPdfDecodeStats = {
  maxBuffer: number;
  maxTotal: number;
  beyond: number;
  exceeded: boolean;
};

export type PdfValidationSchedule = (ms: number, fn: () => void) => () => void;

export type PdfValidationOptions = {
  schedule?: PdfValidationSchedule;
  startupDeadlineMs?: number;
  parseDeadlineMs?: number;
  queueWaitMs?: number;
  queueFullCode?: string;
  maxWaiting?: number;
  moduleFilename?: string;
  workerFileExists?: (path: string) => boolean;
  logError?: (message: string) => void;
  beforeWorker?: () => Promise<void> | void;
  /** Test only: worker posts `{ ready: true }` after this resolves. */
  holdReady?: boolean;
  releaseImports?: Promise<void>;
  /** Test only: worker stays alive after posting its result. */
  holdExit?: boolean;
  workerExitWaitMs?: number;
};

type PdfWorkerMessage = {
  ok?: boolean;
  pages?: number;
  code?: string;
  ready?: boolean;
} & Partial<CertificateImportPdfDecodeStats>;

type SlotWaiter = {
  resolve: () => void;
  reject: (error: unknown) => void;
  cancel: () => void;
};

type WorkerLaunch = {
  filename: string;
  execArgv: string[];
};

const nodeRequire = createRequire(__filename);
const logger = new Logger('CertificateImportPdf');

const realSchedule: PdfValidationSchedule = (ms, fn) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

let slotTaken = false;
const waiters: SlotWaiter[] = [];
let activeWorkers = 0;
let peakWorkers = 0;

export function pdfValidationWorkerPeak(): number {
  return peakWorkers;
}

export function resetPdfValidationWorkerPeak(): void {
  peakWorkers = activeWorkers;
}

export function pdfValidationActiveWorkers(): number {
  return activeWorkers;
}

/**
 * Parse the entire document. pdf-lib runs in a worker that is terminated
 * after each call. PDFRef.of keeps every ref in a module-level pool that
 * never evicts, so the isolate is not recycled. Only one worker runs at a
 * time: Render Free has 512 MiB and no memory metrics.
 */
export async function assertCertificateImportPdf(
  bytes: Buffer,
  options: PdfValidationOptions = {},
): Promise<number> {
  if (bytes.length > CERTIFICATE_IMPORT_MAX_BYTES) {
    throw new BadRequestException('CERTIFICATE_IMPORT_FILE_TOO_LARGE');
  }
  const end = certificateImportPdfPayloadEnd(bytes);
  if (
    bytes.length < 5 ||
    bytes.subarray(0, 5).toString('ascii') !== '%PDF-' ||
    end < 5 ||
    bytes.subarray(end - 5, end).toString('ascii') !== '%%EOF'
  ) {
    throw new BadRequestException('CERTIFICATE_IMPORT_PDF_INVALID');
  }

  const launch = workerLaunch(options);
  const queued = takeSlot(options);
  if (queued) await queued;
  let releaseOwned = false;
  try {
    if (options.beforeWorker) await options.beforeWorker();
    const message = await validateInWorker(bytes, options, launch, () => {
      releaseOwned = true;
    });
    if (message.code === PDF_DECODE_CAP_UNAVAILABLE) {
      throw new Error('PDF decode cap is not installed');
    }
    const stats = decodeStats(message);
    if (message.ok !== true) {
      const code =
        message.code != null && PDF_CODES.has(message.code)
          ? message.code
          : 'CERTIFICATE_IMPORT_PDF_INVALID';
      throw pdfFailure(code, stats);
    }
    if (!Number.isInteger(message.pages) || (message.pages ?? 0) <= 0) {
      throw pdfFailure('CERTIFICATE_IMPORT_PDF_INVALID', stats);
    }
    if ((message.pages ?? 0) > CERTIFICATE_IMPORT_MAX_PDF_PAGES) {
      throw pdfFailure('CERTIFICATE_IMPORT_PDF_TOO_MANY_PAGES', stats);
    }
    return message.pages as number;
  } finally {
    if (!releaseOwned) releaseSlot();
  }
}

function pdfFailure(
  code: string,
  stats: CertificateImportPdfDecodeStats,
): BadRequestException {
  const error = new BadRequestException(code);
  Object.assign(error, { pdfDecode: stats });
  return error;
}

function decodeStats(
  message: PdfWorkerMessage,
): CertificateImportPdfDecodeStats {
  return {
    maxBuffer: numberOrZero(message.maxBuffer),
    maxTotal: numberOrZero(message.maxTotal),
    beyond: numberOrZero(message.beyond),
    exceeded: message.exceeded === true,
  };
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function takeSlot(options: PdfValidationOptions): Promise<void> | undefined {
  if (!slotTaken) {
    slotTaken = true;
    return undefined;
  }
  const maxWaiting = options.maxWaiting ?? PDF_WORKER_MAX_WAITING;
  const queueFullCode = options.queueFullCode ?? PDF_QUEUE_FULL;
  if (waiters.length >= maxWaiting) {
    throw queueFullException(queueFullCode);
  }
  const schedule = options.schedule ?? realSchedule;
  const queueWaitMs = options.queueWaitMs ?? PDF_OCR_QUEUE_WAIT_MS;
  return new Promise((resolve, reject) => {
    const waiter: SlotWaiter = {
      resolve,
      reject,
      cancel: () => undefined,
    };
    waiter.cancel = schedule(queueWaitMs, () => {
      const index = waiters.indexOf(waiter);
      if (index < 0) return;
      waiters.splice(index, 1);
      reject(queueFullException(queueFullCode));
    });
    waiters.push(waiter);
  });
}

function queueFullException(code: string): HttpException {
  if (code === ErrorCode.CERTIFICATE_IMPORT_PDF_BUSY) {
    return new HttpException(code, HttpStatus.TOO_MANY_REQUESTS);
  }
  return new BadRequestException(code);
}

function releaseSlot(): void {
  const next = waiters.shift();
  if (!next) {
    slotTaken = false;
    return;
  }
  next.cancel();
  next.resolve();
}

function workerLaunch(options: PdfValidationOptions): WorkerLaunch {
  const moduleFilename = options.moduleFilename ?? __filename;
  const exists = options.workerFileExists ?? existsSync;
  const compiled = join(__dirname, 'certificate-import-pdf.worker.js');
  if (moduleFilename.endsWith('.js')) {
    if (!exists(compiled)) {
      const log =
        options.logError ?? ((message: string) => logger.error(message));
      log(PDF_WORKER_BUNDLE_MISSING);
      throw new Error(PDF_WORKER_BUNDLE_MISSING);
    }
    return { filename: compiled, execArgv: [] };
  }
  return {
    filename: join(__dirname, 'certificate-import-pdf.worker.ts'),
    execArgv: ['--import', nodeRequire.resolve('tsx')],
  };
}

function validateInWorker(
  bytes: Buffer,
  options: PdfValidationOptions,
  launch: WorkerLaunch,
  onStarted: () => void,
): Promise<PdfWorkerMessage> {
  const schedule = options.schedule ?? realSchedule;
  const startupMs = options.startupDeadlineMs ?? PDF_WORKER_STARTUP_DEADLINE_MS;
  const parseMs = options.parseDeadlineMs ?? PDF_PARSE_DEADLINE_MS;
  const exitWaitMs = options.workerExitWaitMs ?? PDF_WORKER_EXIT_WAIT_MS;
  const log = options.logError ?? ((message: string) => logger.error(message));
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const worker = new Worker(launch.filename, {
    execArgv: launch.execArgv,
    resourceLimits: {
      maxOldGenerationSizeMb: PDF_WORKER_OLD_SPACE_MB,
      maxYoungGenerationSizeMb: PDF_WORKER_YOUNG_SPACE_MB,
    },
    transferList: [copy.buffer],
    workerData: {
      bytes: copy,
      holdReady: options.holdReady === true,
      holdExit: options.holdExit === true,
    },
  });
  onStarted();
  activeWorkers += 1;
  if (activeWorkers > peakWorkers) peakWorkers = activeWorkers;

  return new Promise((resolve, reject) => {
    let resultSettled = false;
    let released = false;
    let shutdownStarted = false;
    let parseArmed = false;
    let cancelStartup: () => void = () => undefined;
    let cancelParse: () => void = () => undefined;
    let cancelExitWait: () => void = () => undefined;
    const invalid = () =>
      reject(pdfFailure('CERTIFICATE_IMPORT_PDF_INVALID', emptyStats()));
    const releaseResources = () => {
      if (released) return;
      released = true;
      cancelExitWait();
      activeWorkers -= 1;
      releaseSlot();
    };
    const beginShutdown = () => {
      if (shutdownStarted || released) return;
      shutdownStarted = true;
      cancelExitWait = schedule(exitWaitMs, () => {
        log(PDF_WORKER_EXIT_TIMEOUT);
        releaseResources();
      });
      void worker.terminate().then(
        () => releaseResources(),
        () => releaseResources(),
      );
    };
    const fail = () => {
      if (resultSettled) return;
      resultSettled = true;
      cancelStartup();
      cancelParse();
      invalid();
      beginShutdown();
    };
    worker.once('exit', () => {
      if (!resultSettled) {
        resultSettled = true;
        cancelStartup();
        cancelParse();
        invalid();
      }
      releaseResources();
    });
    worker.once('error', () => fail());
    cancelStartup = schedule(startupMs, () => fail());
    if (options.holdReady && options.releaseImports) {
      void Promise.resolve(options.releaseImports).then(() => {
        if (resultSettled) return;
        worker.postMessage({ release: true });
      });
    }
    worker.on('message', (message: PdfWorkerMessage) => {
      if (resultSettled) return;
      if (message?.ready === true) {
        if (parseArmed) return;
        parseArmed = true;
        cancelStartup();
        cancelParse = schedule(parseMs, () => fail());
        return;
      }
      resultSettled = true;
      cancelStartup();
      cancelParse();
      resolve(message ?? {});
      beginShutdown();
    });
  });
}

function emptyStats(): CertificateImportPdfDecodeStats {
  return { maxBuffer: 0, maxTotal: 0, beyond: 0, exceeded: false };
}

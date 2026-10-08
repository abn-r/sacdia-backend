import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { HttpException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import PDFKit from 'pdfkit';
import {
  assertCertificateImportPdf,
  CERTIFICATE_IMPORT_MAX_PDF_PAGES,
  PDF_CONFIRM_QUEUE_WAIT_MS,
  PDF_OCR_QUEUE_WAIT_MS,
  PDF_PARSE_DEADLINE_MS,
  PDF_VALIDATION_RSS_BUDGET_BYTES,
  PDF_WORKER_BUNDLE_MISSING,
  PDF_WORKER_EXIT_TIMEOUT,
  PDF_WORKER_MAX_WAITING,
  PDF_WORKER_STARTUP_DEADLINE_MS,
  pdfValidationActiveWorkers,
  pdfValidationWorkerPeak,
  resetPdfValidationWorkerPeak,
} from './certificate-import-pdf';
import { CERTIFICATE_IMPORT_MAX_BYTES } from './certificate-import-files.constants';
import {
  commentBeforeObjKeyword,
  doubleFlateObjStm,
  escapedLzwObjStm,
  flateObjStmAtCap,
  flateObjStmOverCap,
  hexEscapedFlateObjStm,
  newlineHeaderAfterTrailer,
  objStmsAtTotalCap,
  objStmsOverTotalCap,
  PDF_BOMB_OUTPUT_BYTES,
  PDF_STREAM_CAP_BYTES,
  PDF_TOTAL_CAP_BYTES,
  xrefHugeFieldWidth,
} from '../../test/certificate-bulk-imports/certificate-import-pdf.attacks';
import { heavyLegitPdf } from '../../test/certificate-bulk-imports/certificate-import-pdf.legit';
import { RSS_PROBE_ROWS } from '../../test/certificate-bulk-imports/rss-budget-probe';

async function pdf(pages: number) {
  const document = await PDFDocument.create();
  for (let n = 0; n < pages; n++) document.addPage();
  return Buffer.from(await document.save({ addDefaultPage: false }));
}

describe('assertCertificateImportPdf', () => {
  afterEach(async () => {
    const deadline = Date.now() + 3_000;
    while (pdfValidationActiveWorkers() > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });

  it.each([1, 5])('counts all %i real pages', async (pages) => {
    expect(await assertCertificateImportPdf(await pdf(pages))).toBe(pages);
    expect(CERTIFICATE_IMPORT_MAX_PDF_PAGES).toBe(5);
  });
  async function traditionalPdf() {
    const document = await PDFDocument.create();
    document.addPage();
    return Buffer.from(await document.save({ useObjectStreams: false }));
  }
  it.each([true, false])(
    'accepts a complete PDF with object streams=%s',
    async (useObjectStreams) => {
      const document = await PDFDocument.create();
      document.addPage();
      await expect(
        assertCertificateImportPdf(
          Buffer.from(await document.save({ useObjectStreams })),
        ),
      ).resolves.toBe(1);
    },
  );
  it('accepts an xref stream dictionary delimited directly after obj', async () => {
    const bytes = await pdf(1);
    const text = bytes.toString('latin1');
    const offset = Number(text.match(/startxref\s+(\d+)\s+%%EOF/)![1]);
    const compact =
      text.slice(0, offset) + text.slice(offset).replace(/obj\s+<</, 'obj<<');
    await expect(
      assertCertificateImportPdf(Buffer.from(compact, 'latin1')),
    ).resolves.toBe(1);
  });
  it('accepts an incremental export with a previous xref', async () => {
    const base = await traditionalPdf();
    const previous = Number(
      base.toString('latin1').match(/startxref\s+(\d+)\s+%%EOF/)![1],
    );
    const object =
      '5 0 obj\n<< /Producer (synthetic incremental fixture) >>\nendobj\n';
    const xref = base.length + Buffer.byteLength(object);
    const revision = `${object}xref\n5 1\n${String(base.length).padStart(10, '0')} 00000 n \ntrailer\n<< /Size 6 /Prev ${previous} /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF`;
    await expect(
      assertCertificateImportPdf(Buffer.concat([base, Buffer.from(revision)])),
    ).resolves.toBe(1);
  });
  it('accepts the real QPDF one-page linearized fixture with forward Prev', async () => {
    const bytes = readFileSync(
      join(__dirname, '__fixtures__', 'qpdf-minimal-linearized.pdf'),
    );
    await expect(assertCertificateImportPdf(bytes)).resolves.toBe(1);
  });
  it('recognizes real linearized xref streams before applying the five-page limit', async () => {
    const bytes = readFileSync(
      join(__dirname, '__fixtures__', 'qpdf-stream-linearized.pdf'),
    );
    await expect(assertCertificateImportPdf(bytes)).rejects.toThrow(
      'CERTIFICATE_IMPORT_PDF_TOO_MANY_PAGES',
    );
  });
  it('recognizes real QPDF hybrid xref before applying the page limit', async () => {
    const bytes = readFileSync(
      join(__dirname, '__fixtures__', 'qpdf-hybrid-xref.pdf'),
    );
    await expect(assertCertificateImportPdf(bytes)).rejects.toThrow(
      'CERTIFICATE_IMPORT_PDF_TOO_MANY_PAGES',
    );
  });
  it('rejects a PDF truncated before xref even with a forged terminal EOF', async () => {
    const bytes = await traditionalPdf();
    const xref = bytes.indexOf(Buffer.from('xref\n'));
    await expect(
      assertCertificateImportPdf(
        Buffer.concat([bytes.subarray(0, xref), Buffer.from('\n%%EOF')]),
      ),
    ).rejects.toThrow('CERTIFICATE_IMPORT_PDF_INVALID');
  });
  it.each(['absent', 'bad', 'out-of-bounds', 'wrong-target'])(
    'rejects %s final startxref',
    async (kind) => {
      const bytes = await traditionalPdf();
      let text = bytes.toString('latin1');
      if (kind === 'absent') text = text.replace(/startxref\n\d+\n/, '');
      else
        text = text.replace(
          /startxref\n\d+\n/,
          'startxref\n' +
            (kind === 'bad'
              ? 'bogus'
              : kind === 'out-of-bounds'
                ? String(bytes.length + 1)
                : '10') +
            '\n',
        );
      await expect(
        assertCertificateImportPdf(Buffer.from(text, 'latin1')),
      ).rejects.toThrow('CERTIFICATE_IMPORT_PDF_INVALID');
    },
  );
  it('rejects an incomplete xref table even with a trailer/startxref/EOF', async () => {
    const bytes = await traditionalPdf();
    const text = bytes.toString('latin1');
    const modified = text.replace(/(xref\n0 \d+\n)0000000000 65535 f \n/, '$1');
    await expect(
      assertCertificateImportPdf(Buffer.from(modified, 'latin1')),
    ).rejects.toThrow('CERTIFICATE_IMPORT_PDF_INVALID');
  });
  it('rejects missing final trailer dictionary without repairing from the catalog', async () => {
    const bytes = await traditionalPdf();
    const text = bytes
      .toString('latin1')
      .replace(/trailer[\s\S]*?startxref/, 'startxref');
    await expect(
      assertCertificateImportPdf(Buffer.from(text, 'latin1')),
    ).rejects.toThrow('CERTIFICATE_IMPORT_PDF_INVALID');
  });
  it('rejects six pages rather than accepting a partial document', async () => {
    await expect(assertCertificateImportPdf(await pdf(6))).rejects.toThrow(
      'CERTIFICATE_IMPORT_PDF_TOO_MANY_PAGES',
    );
  });
  it('accepts a valid PDF with trailing whitespace beyond a fixed window', async () => {
    const bytes = Buffer.concat([
      await pdf(1),
      Buffer.from(' \r\n\t'.repeat(600)),
    ]);
    await expect(assertCertificateImportPdf(bytes)).resolves.toBe(1);
  });
  it('rejects appended non-whitespace garbage rather than finding an old EOF', async () => {
    const bytes = Buffer.concat([
      await pdf(1),
      Buffer.from('broken appended revision'),
    ]);
    await expect(assertCertificateImportPdf(bytes)).rejects.toThrow(
      'CERTIFICATE_IMPORT_PDF_INVALID',
    );
  });
  it('rejects a real PDF truncated before its end-of-file marker', async () => {
    const bytes = await pdf(1);
    const truncated = bytes.subarray(
      0,
      bytes.lastIndexOf(Buffer.from('%%EOF')),
    );
    await expect(assertCertificateImportPdf(truncated)).rejects.toThrow(
      'CERTIFICATE_IMPORT_PDF_INVALID',
    );
  });
  it('rejects a zero-page document', async () => {
    await expect(assertCertificateImportPdf(await pdf(0))).rejects.toThrow(
      'CERTIFICATE_IMPORT_PDF_INVALID',
    );
  });
  it.each([
    Buffer.alloc(0),
    Buffer.from('not pdf'),
    Buffer.from('%PDF-1.7\n1 0 obj << invalid'),
  ])('rejects malformed/truncated documents', async (bytes) => {
    await expect(assertCertificateImportPdf(bytes)).rejects.toThrow(
      'CERTIFICATE_IMPORT_PDF_INVALID',
    );
  });
  it('rejects encrypted PDFKit output without leaking the password', async () => {
    const bytes = await new Promise<Buffer>((resolve) => {
      const document = new PDFKit({ userPassword: 'fixture-password' });
      const chunks: Buffer[] = [];
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.text('fixture');
      document.end();
    });
    await expect(assertCertificateImportPdf(bytes)).rejects.toThrow(
      'CERTIFICATE_IMPORT_PDF_ENCRYPTED',
    );
  });
  it('bounds the actual bytes', async () => {
    await expect(
      assertCertificateImportPdf(
        Buffer.alloc(CERTIFICATE_IMPORT_MAX_BYTES + 1),
      ),
    ).rejects.toThrow('CERTIFICATE_IMPORT_FILE_TOO_LARGE');
  });

  async function expectDecodeStaysWithinCap(bytes: Buffer) {
    expect(bytes.length).toBeLessThanOrEqual(CERTIFICATE_IMPORT_MAX_BYTES);
    expect(bytes.length).toBeLessThan(PDF_BOMB_OUTPUT_BYTES);
    expect(PDF_BOMB_OUTPUT_BYTES).toBe(64 * 1024 * 1024);
    expect(PDF_STREAM_CAP_BYTES).toBe(8 * 1024 * 1024);
    expect(PDF_TOTAL_CAP_BYTES).toBe(16 * 1024 * 1024);
    const outcome = await assertCertificateImportPdf(bytes).then(
      (pages) => ({ pages }),
      (error: unknown) => ({ error }),
    );
    expect(outcome).toEqual({
      error: expect.objectContaining({
        message: 'CERTIFICATE_IMPORT_PDF_INVALID',
        pdfDecode: expect.objectContaining({
          maxBuffer: PDF_STREAM_CAP_BYTES,
          beyond: 0,
          exceeded: true,
        }),
      }),
    });
    const stats = (outcome as { error: { pdfDecode: { maxTotal: number } } })
      .error.pdfDecode;
    expect(stats.maxTotal).toBeLessThanOrEqual(PDF_TOTAL_CAP_BYTES);
    expect(stats.maxTotal).toBeGreaterThan(0);
  }

  it('rejects a hex-escaped ObjStm FlateDecode without allocating past the cap', async () => {
    await expectDecodeStaysWithinCap(await hexEscapedFlateObjStm());
  });

  it('rejects an ObjStm whose header hides obj behind a comment', async () => {
    await expectDecodeStaysWithinCap(await commentBeforeObjKeyword());
  });

  it('rejects an ObjStm appended after the trailer with a split header', async () => {
    await expectDecodeStaysWithinCap(await newlineHeaderAfterTrailer());
  });

  it('rejects a double FlateDecode chain without allocating past the cap', async () => {
    await expectDecodeStaysWithinCap(await doubleFlateObjStm());
  });

  it('rejects an escaped LZW ObjStm without allocating past the cap', async () => {
    await expectDecodeStaysWithinCap(await escapedLzwObjStm());
  });

  it('rejects a third ObjStm once the total cap is already allocated', async () => {
    const bytes = objStmsOverTotalCap();
    const error = await assertCertificateImportPdf(bytes).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toEqual(
      expect.objectContaining({
        message: 'CERTIFICATE_IMPORT_PDF_INVALID',
        pdfDecode: expect.objectContaining({
          maxBuffer: PDF_STREAM_CAP_BYTES,
          beyond: 0,
          exceeded: true,
        }),
      }),
    );
    expect(
      (error as { pdfDecode: { maxTotal: number } }).pdfDecode.maxTotal,
    ).toBeLessThanOrEqual(PDF_TOTAL_CAP_BYTES);
  });

  describe('legitimate heavy PDFs', () => {
    // Measured with test/certificate-bulk-imports/certificate-import-pdf.legit.ts.
    // Each shape is past the old caps (1 MiB per stream, 2 MiB total) and well
    // under the current ones (8 MiB, 16 MiB).
    it('accepts 5 pages of annotations spread over many ObjStms (~3.4 MiB total, past the old 2 MiB total)', async () => {
      const bytes = await heavyLegitPdf({
        pages: 5,
        annotationsPerPage: 2000,
        objectsPerStream: 100,
      });
      expect(bytes.length).toBeLessThan(CERTIFICATE_IMPORT_MAX_BYTES);
      await expect(assertCertificateImportPdf(bytes)).resolves.toBe(5);
    }, 30_000);

    it('accepts 5 pages whose objects share one ObjStm (~1.7 MiB decoded in a 2 MiB buffer, past the old 1 MiB stream cap)', async () => {
      const bytes = await heavyLegitPdf({
        pages: 5,
        annotationsPerPage: 2000,
        objectsPerStream: 1_000_000,
      });
      expect(bytes.length).toBeLessThan(CERTIFICATE_IMPORT_MAX_BYTES);
      await expect(assertCertificateImportPdf(bytes)).resolves.toBe(5);
    }, 30_000);

    it('accepts an ObjStm that inflates to exactly the stream cap', async () => {
      await expect(
        assertCertificateImportPdf(await flateObjStmAtCap()),
      ).resolves.toBe(1);
    }, 30_000);

    it('rejects an ObjStm that inflates one byte past the stream cap and allocates nothing beyond it', async () => {
      const outcome = await assertCertificateImportPdf(
        await flateObjStmOverCap(),
      ).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(outcome).toEqual(
        expect.objectContaining({
          message: 'CERTIFICATE_IMPORT_PDF_INVALID',
          pdfDecode: expect.objectContaining({
            maxBuffer: PDF_STREAM_CAP_BYTES,
            beyond: 0,
            exceeded: true,
          }),
        }),
      );
    }, 30_000);
  });

  it('keeps one validation inside the Free-plan RSS budget', () => {
    const backendRoot = join(__dirname, '../..');
    const probe = join(
      backendRoot,
      'test/certificate-bulk-imports/rss-budget-probe.ts',
    );
    // One process per scenario: pages freed by an earlier scenario would be
    // reused and hide the next one's growth.
    const rows = RSS_PROBE_ROWS.map((name) => {
      const result = spawnSync(
        process.execPath,
        ['--expose-gc', '--import', 'tsx', probe, name],
        { cwd: backendRoot, encoding: 'utf8', timeout: 60_000 },
      );
      expect(result.status).toBe(0);
      const [row] = JSON.parse(result.stdout) as {
        name: string;
        rssDelta: number;
        outcome: string;
      }[];
      return row;
    });
    expect(rows.map((row) => row.name)).toEqual([...RSS_PROBE_ROWS]);
    for (const row of rows) {
      expect(row.rssDelta).toBeLessThanOrEqual(PDF_VALIDATION_RSS_BUDGET_BYTES);
    }
    const outcome = (name: string) =>
      rows.find((row) => row.name === name)?.outcome;
    for (const name of [
      'pages1',
      'pages5',
      'scan9MiB',
      'inflateAtCap',
      'heavyManyObjStm',
      'heavyOneObjStm',
      'inflateAtCapx3',
      'heavyOneObjStmx3',
    ]) {
      expect(outcome(name)).toBe('ok');
    }
    for (const name of [
      'xref20M',
      'inflateBomb',
      'inflateOverCap',
      'totalCapTwoStreams',
      'totalCapSpread64',
    ]) {
      expect(outcome(name)).toBe('CERTIFICATE_IMPORT_PDF_INVALID');
    }
    // The x3 rows throw inside the probe unless every caller got the
    // expected result, so 'ok' means all three agreed.
    expect(outcome('xref20Mx3')).toBe('ok');
    expect(outcome('inflateBombx3')).toBe('ok');
  }, 300_000);

  it('does not keep the xref ref pool in the calling process', () => {
    const backendRoot = join(__dirname, '../..');
    const probe = join(
      backendRoot,
      'test/certificate-bulk-imports/parent-heap-probe.ts',
    );
    const result = spawnSync(
      process.execPath,
      ['--expose-gc', '--import', 'tsx', probe, '4000000'],
      { cwd: backendRoot, encoding: 'utf8', timeout: 60_000 },
    );

    expect(result.status).toBe(0);
    const measured = JSON.parse(result.stdout) as {
      rejected: boolean;
      delta: number;
      fileBytes: number;
    };
    expect(measured.rejected).toBe(true);
    expect(measured.fileBytes).toBeLessThan(500);
    expect(measured.delta).toBeLessThan(16 * 1024 * 1024);
  }, 60_000);

  it('cuts a huge xref field width with one worker and still validates the next PDF', async () => {
    resetPdfValidationWorkerPeak();
    const bomb = xrefHugeFieldWidth(1_500_000_000);
    const normal = await pdf(1);
    const started = Date.now();
    const bombDone = assertCertificateImportPdf(bomb).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const normalDone = assertCertificateImportPdf(normal);

    await expect(normalDone).resolves.toBe(1);
    await expect(bombDone).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({
        message: 'CERTIFICATE_IMPORT_PDF_INVALID',
      }),
    });
    expect(pdfValidationWorkerPeak()).toBe(1);
    expect(Date.now() - started).toBeLessThan(
      PDF_WORKER_STARTUP_DEADLINE_MS + PDF_PARSE_DEADLINE_MS,
    );
  }, 30_000);

  it('reads the decode-cap patch once after the first successful check', () => {
    jest.isolateModules(() => {
      const fs = require('node:fs') as typeof import('node:fs');
      const read = jest.spyOn(fs, 'readFileSync');
      try {
        const loaded =
          require('./certificate-import-pdf-decode-cap') as typeof import('./certificate-import-pdf-decode-cap');
        const decodeReads = () =>
          read.mock.calls.filter((call) =>
            String(call[0]).includes('DecodeStream.js'),
          ).length;
        loaded.assertPdfDecodeCapInstalled();
        const afterFirst = decodeReads();
        loaded.assertPdfDecodeCapInstalled();
        expect(afterFirst).toBeGreaterThan(0);
        expect(decodeReads()).toBe(afterFirst);
      } finally {
        read.mockRestore();
      }
    });
  });

  it('validates concurrent PDFs', async () => {
    const files = await Promise.all([pdf(1), pdf(2), pdf(1)]);
    await expect(
      Promise.all(files.map((file) => assertCertificateImportPdf(file))),
    ).resolves.toEqual([1, 2, 1]);
  });

  function manualClock() {
    let now = 0;
    const timers: { at: number; fn: () => void; cancelled: boolean }[] = [];
    return {
      schedule(ms: number, fn: () => void) {
        const timer = { at: now + ms, fn, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
      advance(ms: number) {
        now += ms;
        let fired = true;
        while (fired) {
          fired = false;
          for (const timer of [...timers]) {
            if (!timer.cancelled && timer.at <= now) {
              timer.cancelled = true;
              fired = true;
              timer.fn();
            }
          }
        }
      },
    };
  }

  it('rejects the validation that does not fit behind the single worker', async () => {
    resetPdfValidationWorkerPeak();
    const files = await Promise.all(Array.from({ length: 6 }, () => pdf(1)));
    const results = await Promise.all(
      files.map((file) =>
        assertCertificateImportPdf(file).then(
          (pages) => ({ ok: true as const, pages }),
          (error: unknown) => ({ ok: false as const, error }),
        ),
      ),
    );
    const rejected = results.filter((result) => !result.ok);
    expect(rejected).toEqual([
      {
        ok: false,
        error: expect.objectContaining({
          message: 'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
        }),
      },
    ]);
    expect((rejected[0] as { error: HttpException }).error.getStatus()).toBe(
      400,
    );
    expect(pdfValidationWorkerPeak()).toBe(1);
  });

  it('rejects a worker that misses the startup deadline and terminates it', async () => {
    const clock = manualClock();
    const terminate = jest.spyOn(Worker.prototype, 'terminate');
    try {
      const pending = assertCertificateImportPdf(await pdf(1), {
        schedule: clock.schedule,
        startupDeadlineMs: 10_000,
      });
      const started = Date.now();
      clock.advance(10_000);
      await expect(pending).rejects.toThrow('CERTIFICATE_IMPORT_PDF_INVALID');
      expect(Date.now() - started).toBeLessThan(500);
      expect(terminate).toHaveBeenCalled();
    } finally {
      terminate.mockRestore();
    }
  });

  it('accepts a PDF whose startup is slow but still inside the startup deadline', async () => {
    const clock = manualClock();
    const pending = assertCertificateImportPdf(await pdf(1), {
      schedule: clock.schedule,
      startupDeadlineMs: 10_000,
      parseDeadlineMs: 2_000,
    });
    clock.advance(9_000);
    await expect(pending).resolves.toBe(1);
  });

  it('does not charge queue wait against the parse deadline', async () => {
    const clock = manualClock();
    let releaseHold: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const normal = await pdf(1);
    resetPdfValidationWorkerPeak();
    const holder = assertCertificateImportPdf(normal, {
      schedule: clock.schedule,
      startupDeadlineMs: 60_000,
      parseDeadlineMs: 2_000,
      queueWaitMs: 30_000,
      beforeWorker: () => hold,
    });
    const waiter = assertCertificateImportPdf(normal, {
      schedule: clock.schedule,
      startupDeadlineMs: 60_000,
      parseDeadlineMs: 2_000,
      queueWaitMs: 30_000,
    });
    clock.advance(5_000);
    let waiterSettled = false;
    void waiter.then(
      () => {
        waiterSettled = true;
      },
      () => {
        waiterSettled = true;
      },
    );
    await Promise.resolve();
    expect(waiterSettled).toBe(false);
    releaseHold();
    await expect(waiter).resolves.toBe(1);
    await expect(holder).resolves.toBe(1);
    expect(pdfValidationWorkerPeak()).toBe(1);
  });

  it('fails closed when the compiled worker bundle is missing', async () => {
    const logs: string[] = [];
    resetPdfValidationWorkerPeak();
    await expect(
      assertCertificateImportPdf(await pdf(1), {
        moduleFilename: '/srv/dist/certificate-import-pdf.js',
        workerFileExists: () => false,
        logError: (message) => logs.push(message),
      }),
    ).rejects.toThrow(PDF_WORKER_BUNDLE_MISSING);
    expect(logs).toEqual(['PDF validation worker bundle is missing']);
    expect(JSON.stringify(logs)).not.toContain('%PDF');
    expect(pdfValidationWorkerPeak()).toBe(0);
  });

  it('does not charge module load against the parse deadline', async () => {
    const clock = manualClock();
    let releaseImports: () => void = () => undefined;
    const importsHeld = new Promise<void>((resolve) => {
      releaseImports = resolve;
    });
    const pending = assertCertificateImportPdf(await pdf(1), {
      schedule: clock.schedule,
      startupDeadlineMs: 10_000,
      parseDeadlineMs: 2_000,
      holdReady: true,
      releaseImports: importsHeld,
    });
    try {
      const started = Date.now();
      while (pdfValidationWorkerPeak() < 1 && Date.now() - started < 2_000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      clock.advance(5_000);
      let settled = false;
      void pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await Promise.resolve();
      expect(settled).toBe(false);
      releaseImports();
      await expect(pending).resolves.toBe(1);
    } finally {
      releaseImports();
    }
  });

  it('keeps the confirm queue wait under the HTTP receive timeout', () => {
    expect(PDF_CONFIRM_QUEUE_WAIT_MS).toBeLessThanOrEqual(3_000);
    expect(PDF_CONFIRM_QUEUE_WAIT_MS).toBeGreaterThan(0);
    expect(
      PDF_WORKER_STARTUP_DEADLINE_MS +
        PDF_PARSE_DEADLINE_MS +
        PDF_CONFIRM_QUEUE_WAIT_MS,
    ).toBeLessThan(15_000);
    expect(PDF_OCR_QUEUE_WAIT_MS).toBeGreaterThan(PDF_CONFIRM_QUEUE_WAIT_MS);
    expect(PDF_OCR_QUEUE_WAIT_MS).toBe(
      PDF_WORKER_MAX_WAITING *
        (PDF_WORKER_STARTUP_DEADLINE_MS + PDF_PARSE_DEADLINE_MS),
    );
  });

  it('charges each caller its own queue wait', async () => {
    const clock = manualClock();
    let releaseHold: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const file = await pdf(1);
    const holder = assertCertificateImportPdf(file, {
      schedule: clock.schedule,
      startupDeadlineMs: 60_000,
      parseDeadlineMs: 2_000,
      beforeWorker: () => hold,
    });
    const shortWaiter = assertCertificateImportPdf(file, {
      schedule: clock.schedule,
      startupDeadlineMs: 60_000,
      parseDeadlineMs: 2_000,
      queueWaitMs: PDF_CONFIRM_QUEUE_WAIT_MS,
    });
    const longWaiter = assertCertificateImportPdf(file, {
      schedule: clock.schedule,
      startupDeadlineMs: 60_000,
      parseDeadlineMs: 2_000,
      queueWaitMs: PDF_OCR_QUEUE_WAIT_MS,
      queueFullCode: 'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
    });
    try {
      clock.advance(PDF_CONFIRM_QUEUE_WAIT_MS);
      await expect(shortWaiter).rejects.toThrow();
      let longSettled = false;
      void longWaiter.then(
        () => {
          longSettled = true;
        },
        () => {
          longSettled = true;
        },
      );
      await Promise.resolve();
      expect(longSettled).toBe(false);
      releaseHold();
      await expect(longWaiter).resolves.toBe(1);
      await expect(holder).resolves.toBe(1);
    } finally {
      releaseHold();
    }
  });

  it('does not start the next worker before terminate exits', async () => {
    const clock = manualClock();
    const logs: string[] = [];
    const leaked: Worker[] = [];
    const terminate = jest
      .spyOn(Worker.prototype, 'terminate')
      .mockImplementation(function (this: Worker) {
        leaked.push(this);
        return new Promise<number>(() => undefined);
      });
    try {
      resetPdfValidationWorkerPeak();
      let secondEntered = false;
      const first = assertCertificateImportPdf(await pdf(1), {
        schedule: clock.schedule,
        startupDeadlineMs: 10_000,
        parseDeadlineMs: 2_000,
        workerExitWaitMs: 8_000,
        holdExit: true,
        logError: (message) => logs.push(message),
      });
      await expect(first).resolves.toBe(1);
      const second = assertCertificateImportPdf(await pdf(1), {
        schedule: clock.schedule,
        startupDeadlineMs: 10_000,
        parseDeadlineMs: 2_000,
        workerExitWaitMs: 8_000,
        queueWaitMs: 30_000,
        holdExit: true,
        beforeWorker: () => {
          secondEntered = true;
        },
        logError: (message) => logs.push(message),
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(secondEntered).toBe(false);
      expect(pdfValidationActiveWorkers()).toBe(1);
      expect(pdfValidationWorkerPeak()).toBe(1);
      let secondSettled = false;
      void second.then(
        () => {
          secondSettled = true;
        },
        () => {
          secondSettled = true;
        },
      );
      await Promise.resolve();
      expect(secondSettled).toBe(false);
      leaked[0]?.emit('exit', 0);
      await expect(second).resolves.toBe(1);
      expect(pdfValidationWorkerPeak()).toBe(1);
      expect(logs).toEqual([]);
    } finally {
      terminate.mockRestore();
      await Promise.all(leaked.map((worker) => worker.terminate()));
    }
  });

  it('logs and releases the slot when terminate misses its deadline', async () => {
    const clock = manualClock();
    const logs: string[] = [];
    const leaked: Worker[] = [];
    const terminate = jest
      .spyOn(Worker.prototype, 'terminate')
      .mockImplementation(function (this: Worker) {
        leaked.push(this);
        return new Promise<number>(() => undefined);
      });
    try {
      resetPdfValidationWorkerPeak();
      let secondEntered = false;
      const first = assertCertificateImportPdf(await pdf(1), {
        schedule: clock.schedule,
        startupDeadlineMs: 10_000,
        parseDeadlineMs: 2_000,
        workerExitWaitMs: 8_000,
        holdExit: true,
        logError: (message) => logs.push(message),
      });
      await expect(first).resolves.toBe(1);
      const second = assertCertificateImportPdf(await pdf(1), {
        schedule: clock.schedule,
        startupDeadlineMs: 10_000,
        parseDeadlineMs: 2_000,
        workerExitWaitMs: 8_000,
        queueWaitMs: 30_000,
        holdExit: true,
        beforeWorker: () => {
          secondEntered = true;
        },
        logError: (message) => logs.push(message),
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(secondEntered).toBe(false);
      expect(pdfValidationActiveWorkers()).toBe(1);
      expect(pdfValidationWorkerPeak()).toBe(1);
      clock.advance(8_000);
      expect(logs).toEqual([PDF_WORKER_EXIT_TIMEOUT]);
      expect(JSON.stringify(logs)).not.toContain('%PDF');
      await expect(second).resolves.toBe(1);
      expect(pdfValidationWorkerPeak()).toBe(1);
    } finally {
      terminate.mockRestore();
      await Promise.all(leaked.map((worker) => worker.terminate()));
    }
  });

  it('rejects a full confirm queue with 429 PDF_BUSY and no worker', async () => {
    const clock = manualClock();
    let releaseHold: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const file = await pdf(1);
    resetPdfValidationWorkerPeak();
    const holder = assertCertificateImportPdf(file, {
      schedule: clock.schedule,
      startupDeadlineMs: 60_000,
      parseDeadlineMs: 5_000,
      beforeWorker: () => hold,
    });
    const fillers = Array.from({ length: PDF_WORKER_MAX_WAITING }, () =>
      assertCertificateImportPdf(file, {
        schedule: clock.schedule,
        startupDeadlineMs: 60_000,
        parseDeadlineMs: 5_000,
        queueWaitMs: 60_000,
        queueFullCode: 'CERTIFICATE_IMPORT_PDF_BUSY',
      }),
    );
    try {
      const error = await assertCertificateImportPdf(file, {
        queueWaitMs: PDF_CONFIRM_QUEUE_WAIT_MS,
        queueFullCode: 'CERTIFICATE_IMPORT_PDF_BUSY',
      }).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(HttpException);
      const busy = error as HttpException;
      expect(busy.getStatus()).toBe(429);
      expect(busy.message).toBe('CERTIFICATE_IMPORT_PDF_BUSY');
      expect(pdfValidationWorkerPeak()).toBe(0);
    } finally {
      releaseHold();
      await holder;
      await Promise.all(fillers);
    }
  });

  it('rejects an expired confirm queue wait with 429 PDF_BUSY', async () => {
    const clock = manualClock();
    let releaseHold: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const file = await pdf(1);
    resetPdfValidationWorkerPeak();
    const holder = assertCertificateImportPdf(file, {
      schedule: clock.schedule,
      startupDeadlineMs: 60_000,
      parseDeadlineMs: 5_000,
      beforeWorker: () => hold,
    });
    const waiter = assertCertificateImportPdf(file, {
      schedule: clock.schedule,
      startupDeadlineMs: 60_000,
      parseDeadlineMs: 5_000,
      queueWaitMs: PDF_CONFIRM_QUEUE_WAIT_MS,
      queueFullCode: 'CERTIFICATE_IMPORT_PDF_BUSY',
    });
    try {
      clock.advance(PDF_CONFIRM_QUEUE_WAIT_MS);
      const error = await waiter.then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(HttpException);
      const busy = error as HttpException;
      expect(busy.getStatus()).toBe(429);
      expect(busy.message).toBe('CERTIFICATE_IMPORT_PDF_BUSY');
      expect(pdfValidationWorkerPeak()).toBe(0);
    } finally {
      releaseHold();
      await holder;
    }
  });

  it('keeps a full OCR queue on OCR_UNAVAILABLE', async () => {
    const clock = manualClock();
    let releaseHold: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const file = await pdf(1);
    resetPdfValidationWorkerPeak();
    const holder = assertCertificateImportPdf(file, {
      schedule: clock.schedule,
      startupDeadlineMs: 60_000,
      beforeWorker: () => hold,
    });
    try {
      const error = await assertCertificateImportPdf(file, {
        maxWaiting: 0,
        queueFullCode: 'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
      }).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(HttpException);
      const unavailable = error as HttpException;
      expect(unavailable.getStatus()).toBe(400);
      expect(unavailable.message).toBe('CERTIFICATE_IMPORT_OCR_UNAVAILABLE');
      expect(pdfValidationWorkerPeak()).toBe(0);
    } finally {
      releaseHold();
      await holder;
    }
  });

  it('does not share the decode total across concurrent calls', async () => {
    const bytes = objStmsAtTotalCap();
    const results = await Promise.all([
      assertCertificateImportPdf(bytes).catch((error: unknown) => error),
      assertCertificateImportPdf(bytes).catch((error: unknown) => error),
    ]);
    for (const error of results) {
      expect(error).toEqual(
        expect.objectContaining({
          message: 'CERTIFICATE_IMPORT_PDF_INVALID',
          pdfDecode: expect.objectContaining({
            maxBuffer: PDF_STREAM_CAP_BYTES,
            beyond: 0,
            exceeded: false,
          }),
        }),
      );
      expect(
        (error as { pdfDecode: { maxTotal: number } }).pdfDecode.maxTotal,
      ).toBeLessThanOrEqual(PDF_TOTAL_CAP_BYTES);
    }
  });
});

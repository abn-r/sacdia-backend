import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { PDFDocument } from 'pdf-lib';
import { FILE_STORAGE_SERVICE } from '../../common/services/file-storage.service';
import * as ocrProxySecret from '../../config/ocr-proxy-secret';
import { CertificateBulkImportsModule } from '../certificate-bulk-imports.module';
import { CERTIFICATE_OCR_PROVIDER } from './certificate-ocr.provider';
import { CloudRunCertificateOcrProvider } from './cloud-run-certificate-ocr.provider';
import { selectCertificateOcrProvider } from './certificate-ocr-mode';
import { GoogleVisionCertificateOcrProvider } from './google-vision-certificate-ocr.provider';
import { signOcrProxyRequest } from './ocr-proxy-signer';

const FILE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_FILE_ID = '22222222-2222-4222-8222-222222222222';
const ISSUED_AT = new Date('2026-10-02T15:04:05.006Z');
const RUNTIME_SECRET = Buffer.from('0123456789abcdef0123456789abcdef');
const RUNTIME_SECRET_B64 = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
const HISTORICAL_SECRET = Buffer.from('test-key-ocr-v1');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const IMAGE_SIGNATURE =
  '1c3f8c18c5816ff53d2b84fa1e773eac19d8cd3def3d95137085b385c6401b6e';
const PDF_FIVE_SIGNATURE =
  '6d3191a3d92334b26d4f9174c80112ce9620e6659264e3bf3f18613c223a648d';
const HISTORICAL_IMAGE_SIGNATURE =
  'ef8af7bd363e2ea8668a71db8b03a825e52b8a1d9a913408b7dbafc808d11dbd';
const HISTORICAL_PDF_SIGNATURE =
  'a3a278d6c6bbda80cffe1b61322ee75bf887c28ddfc033dd65b75d02c9a093f2';
const GOLDEN_SHA256 =
  '97f9d8301938ef5542f5ac8023d73f35749811eddc5a06844dd82433fe7b6de0';

type SeenRequest = {
  headers: IncomingMessage['headers'];
  body: Buffer;
};

describe('signOcrProxyRequest golden vectors', () => {
  const body = Buffer.from('synthetic certificate');
  const shared = {
    environment: 'development',
    kid: 'k-current',
    operationId: FILE_ID,
    issuedAt: '2026-10-02T15:04:05.006Z',
    timestamp: 1759420000,
    nonce: '0123456789abcdef0123456789abcdef',
    body,
    secret: RUNTIME_SECRET,
  };

  it('keeps the 15-byte vectors historical and rejects them at runtime', () => {
    const historical = (contentType: string, pageCount: number) =>
      [
        'v1',
        'POST',
        '/v1/ocr',
        'development',
        'k-current',
        FILE_ID,
        '2026-10-02T15:04:05.006Z',
        contentType,
        String(body.length),
        String(pageCount),
        '1759420000',
        '0123456789abcdef0123456789abcdef',
        GOLDEN_SHA256,
      ].join('\n') + '\n';
    expect(
      createHmac('sha256', HISTORICAL_SECRET)
        .update(historical('image/jpeg', 1))
        .digest('hex'),
    ).toBe(HISTORICAL_IMAGE_SIGNATURE);
    expect(
      createHmac('sha256', HISTORICAL_SECRET)
        .update(historical('application/pdf', 5))
        .digest('hex'),
    ).toBe(HISTORICAL_PDF_SIGNATURE);
    expect(() =>
      signOcrProxyRequest({
        ...shared,
        contentType: 'image/jpeg',
        pageCount: 1,
        secret: HISTORICAL_SECRET,
      }),
    ).toThrow(/^INVALID_CONTRACT$/);
    expect(() =>
      signOcrProxyRequest({
        ...shared,
        contentType: 'image/jpeg',
        pageCount: 1,
        secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
      }),
    ).toThrow(/^INVALID_CONTRACT$/);
  });

  it('uses an already decoded Buffer secret without copying or decoding it', () => {
    const from = jest.spyOn(Buffer, 'from');
    try {
      signOcrProxyRequest({
        ...shared,
        contentType: 'image/jpeg',
        pageCount: 1,
      });
      expect(from.mock.calls.some(([value]) => value === RUNTIME_SECRET)).toBe(
        false,
      );
    } finally {
      from.mockRestore();
    }
  });

  it.each([
    ['a 31-byte Buffer', Buffer.alloc(31, 7)],
    ['a short Uint8Array', new Uint8Array(31).fill(7)],
    ['an empty Buffer', Buffer.alloc(0)],
  ])('rejects %s without echoing the secret', (_, secret) => {
    let message = '';
    try {
      signOcrProxyRequest({
        ...shared,
        contentType: 'image/jpeg',
        pageCount: 1,
        secret,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe('INVALID_CONTRACT');
  });

  it('matches the image/1 vector', () => {
    const signed = signOcrProxyRequest({
      ...shared,
      contentType: 'image/jpeg',
      pageCount: 1,
    });

    expect(signed.contentSha256).toBe(GOLDEN_SHA256);
    expect(signed.signature).toBe(IMAGE_SIGNATURE);
  });

  it('matches the pdf/5 vector from the base64 secret', () => {
    const signed = signOcrProxyRequest({
      ...shared,
      secret: `\n${RUNTIME_SECRET_B64}\n`,
      contentType: 'application/pdf',
      pageCount: 5,
    });

    expect(signed.signature).toBe(PDF_FIVE_SIGNATURE);
  });
});

describe('CloudRunCertificateOcrProvider', () => {
  function storageFor(bytes: Buffer, contentType: string) {
    return {
      getObjectInfo: jest.fn().mockResolvedValue({
        size: bytes.length,
        contentType,
      }),
      getObject: jest.fn().mockResolvedValue(bytes),
    };
  }

  function imageInput(overrides: Record<string, unknown> = {}) {
    return {
      fileUrl: 'batches/batch-1/sealed/cert.jpg',
      fileName: 'cert.jpg',
      fileType: 'image/jpeg',
      objectKey: 'batches/batch-1/sealed/cert.jpg',
      sizeBytes: JPEG.length,
      fileId: FILE_ID,
      confirmedAt: ISSUED_AT,
      ...overrides,
    };
  }

  async function listen(
    handler: (
      req: IncomingMessage,
      res: ServerResponse,
    ) => void | Promise<void>,
  ) {
    const server = createServer((req, res) => {
      void Promise.resolve(handler(req, res));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('missing port');
    }
    return {
      port: address.port,
      close: () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    };
  }

  async function readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  function successBody(text: string, pageCount = 1) {
    return JSON.stringify({
      version: 'v1',
      operationId: FILE_ID,
      pageCount,
      pages: [{ pageNumber: 1, text }],
    });
  }

  function provider(
    port: number,
    storage: ReturnType<typeof storageFor>,
    overrides: Record<string, unknown> = {},
  ) {
    let nonce = 0;
    return new CloudRunCertificateOcrProvider(storage as never, {
      url: `http://127.0.0.1:${port}/v1/ocr`,
      environment: 'development',
      kid: 'k-current',
      secret: RUNTIME_SECRET,
      timeoutMs: 1_000,
      now: () => new Date('2026-10-05T12:00:00.000Z'),
      randomBytes: (size: number) => {
        nonce += 1;
        const buffer = Buffer.alloc(size);
        buffer[0] = nonce;
        return buffer;
      },
      ...overrides,
    });
  }

  it('keeps operationId and issuedAt across attempts and rotates the nonce', async () => {
    const seen: SeenRequest[] = [];
    const server = await listen(async (req, res) => {
      seen.push({ headers: req.headers, body: await readBody(req) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(successBody('honor: Senderismo'));
    });
    const storage = storageFor(JPEG, 'image/jpeg');
    const ocr = provider(server.port, storage, {
      now: () => new Date(Date.now()),
    });

    await ocr.extract([imageInput({ owner: 'user-should-not-travel' })]);
    await ocr.extract([imageInput({ owner: 'user-should-not-travel' })]);
    await ocr.extract([imageInput({ owner: 'user-should-not-travel' })]);

    const operationIds = seen.map(
      (entry) => entry.headers['x-ocr-operation-id'],
    );
    const issued = seen.map((entry) => entry.headers['x-ocr-issued-at']);
    const nonces = seen.map((entry) => entry.headers['x-ocr-nonce']);
    expect(operationIds).toEqual([FILE_ID, FILE_ID, FILE_ID]);
    expect(issued).toEqual([
      '2026-10-02T15:04:05.006Z',
      '2026-10-02T15:04:05.006Z',
      '2026-10-02T15:04:05.006Z',
    ]);
    expect(new Set(nonces).size).toBe(3);
    expect(String(nonces[0])).toMatch(/^[0-9a-f]{32,}$/);
    expect(seen[0].headers.authorization).toBeUndefined();
    expect(JSON.stringify(seen[0].headers)).not.toContain(
      'user-should-not-travel',
    );
    expect(seen[0].body.toString('utf8')).not.toContain(
      'user-should-not-travel',
    );
    await server.close();
  });

  it('uses another operationId when the evidence file id changes', async () => {
    const seen: string[] = [];
    const server = await listen(async (req, res) => {
      seen.push(String(req.headers['x-ocr-operation-id']));
      await readBody(req);
      const operationId = String(req.headers['x-ocr-operation-id']);
      res.end(
        JSON.stringify({
          version: 'v1',
          operationId,
          pageCount: 1,
          pages: [{ pageNumber: 1, text: 'honor: Uno' }],
        }),
      );
    });
    const ocr = provider(server.port, storageFor(JPEG, 'image/jpeg'));

    await ocr.extract([imageInput()]);
    await ocr.extract([imageInput({ fileId: OTHER_FILE_ID })]);

    expect(seen).toEqual([FILE_ID, OTHER_FILE_ID]);
    await server.close();
  });

  it('does not read storage or open HTTP when confirmed_at is null', async () => {
    let hits = 0;
    const server = await listen((req, res) => {
      hits += 1;
      res.end('no');
      void req;
    });
    const storage = storageFor(JPEG, 'image/jpeg');
    const ocr = provider(server.port, storage);

    await expect(
      ocr.extract([imageInput({ confirmedAt: null })]),
    ).rejects.toThrow('CERTIFICATE_IMPORT_OCR_FAILED');
    expect(storage.getObject).not.toHaveBeenCalled();
    expect(storage.getObjectInfo).not.toHaveBeenCalled();
    expect(hits).toBe(0);
    await server.close();
  });

  it('does not read storage when file_id is not a canonical UUID', async () => {
    const storage = storageFor(JPEG, 'image/jpeg');
    const ocr = provider(1, storage);

    await expect(
      ocr.extract([imageInput({ fileId: 'FILE-1' })]),
    ).rejects.toThrow('CERTIFICATE_IMPORT_OCR_FAILED');
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('signs page count 1 for an image and the PDF count of the same buffer', async () => {
    const seen: SeenRequest[] = [];
    let counted: Buffer | undefined;
    const server = await listen(async (req, res) => {
      const body = await readBody(req);
      seen.push({ headers: req.headers, body });
      res.end(
        JSON.stringify({
          version: 'v1',
          operationId: FILE_ID,
          pageCount: Number(req.headers['x-ocr-page-count']),
          pages: Array.from(
            { length: Number(req.headers['x-ocr-page-count']) },
            (_, index) => ({ pageNumber: index + 1, text: 'honor: Uno' }),
          ),
        }),
      );
    });
    const pdfBytes = Buffer.from('%PDF-1.7\n');
    const storage = storageFor(pdfBytes, 'application/pdf');
    const ocr = provider(server.port, storage, {
      countPdf: async (bytes: Buffer) => {
        counted = bytes;
        return 5;
      },
    });

    await ocr.extract([
      imageInput({
        fileName: 'cert.pdf',
        fileType: 'application/pdf',
        objectKey: 'batches/batch-1/sealed/cert.pdf',
        fileUrl: 'batches/batch-1/sealed/cert.pdf',
        sizeBytes: pdfBytes.length,
      }),
    ]);

    expect(counted).toBe(pdfBytes);
    expect(seen[0].body.equals(pdfBytes)).toBe(true);
    expect(seen[0].headers['x-ocr-page-count']).toBe('5');
    await server.close();
  });

  it('does not open HTTP when the PDF page count fails', async () => {
    let hits = 0;
    const server = await listen((req, res) => {
      hits += 1;
      res.end('no');
      void req;
    });
    const pdfBytes = Buffer.from('%PDF-1.7\n');
    const ocr = provider(server.port, storageFor(pdfBytes, 'application/pdf'), {
      countPdf: async () => {
        throw new BadRequestException('CERTIFICATE_IMPORT_PDF_INVALID');
      },
    });

    await expect(
      ocr.extract([
        imageInput({
          fileType: 'application/pdf',
          sizeBytes: pdfBytes.length,
        }),
      ]),
    ).rejects.toThrow('CERTIFICATE_IMPORT_PDF_INVALID');
    expect(hits).toBe(0);
    await server.close();
  });

  it('asks the real PDF counter for the page count of the sealed buffer', async () => {
    const document = await PDFDocument.create();
    document.addPage();
    const pdfBytes = Buffer.from(
      await document.save({ addDefaultPage: false }),
    );
    const seen: string[] = [];
    const server = await listen(async (req, res) => {
      seen.push(String(req.headers['x-ocr-page-count']));
      const body = await readBody(req);
      expect(body.equals(pdfBytes)).toBe(true);
      res.end(
        JSON.stringify({
          version: 'v1',
          operationId: FILE_ID,
          pageCount: 1,
          pages: [{ pageNumber: 1, text: 'honor: Uno' }],
        }),
      );
    });
    const ocr = provider(server.port, storageFor(pdfBytes, 'application/pdf'));

    await ocr.extract([
      imageInput({
        fileType: 'application/pdf',
        sizeBytes: pdfBytes.length,
      }),
    ]);

    expect(seen).toEqual(['1']);
    await server.close();
  });

  it('parses the full page text before storing only 20000 characters', async () => {
    const text = `${'x'.repeat(20_000)}\nhonor: SenderismoLargo`;
    const server = await listen(async (req, res) => {
      await readBody(req);
      res.end(successBody(text));
    });
    const ocr = provider(server.port, storageFor(JPEG, 'image/jpeg'));

    const parsed = await ocr.extract([imageInput()]);

    expect(parsed.items.map((item) => item.detectedName)).toContain(
      'SenderismoLargo',
    );
    expect(parsed.rawText.length).toBeLessThanOrEqual(20_000);
    expect(parsed.rawText).not.toContain('SenderismoLargo');
    await server.close();
  });

  it.each([
    ['UNAUTHORIZED', 401, 'CERTIFICATE_IMPORT_OCR_UNAVAILABLE'],
    ['FORBIDDEN', 403, 'CERTIFICATE_IMPORT_OCR_UNAVAILABLE'],
    ['UNAVAILABLE', 503, 'CERTIFICATE_IMPORT_OCR_UNAVAILABLE'],
    ['DISCONNECTED', 503, 'CERTIFICATE_IMPORT_OCR_UNAVAILABLE'],
    ['UNSUPPORTED_TYPE', 415, 'CERTIFICATE_IMPORT_OCR_UNSUPPORTED_TYPE'],
    ['PAYLOAD_TOO_LARGE', 413, 'CERTIFICATE_IMPORT_OCR_FILE_TOO_LARGE'],
    ['PDF_TOO_MANY_PAGES', 400, 'CERTIFICATE_IMPORT_PDF_TOO_MANY_PAGES'],
    ['PDF_ENCRYPTED', 400, 'CERTIFICATE_IMPORT_PDF_ENCRYPTED'],
    ['PDF_INVALID', 400, 'CERTIFICATE_IMPORT_PDF_INVALID'],
    ['INVALID_CONTRACT', 400, 'CERTIFICATE_IMPORT_OCR_FAILED'],
    ['ENCODED', 422, 'CERTIFICATE_IMPORT_OCR_FAILED'],
    ['EMPTY_DOCUMENT', 422, 'CERTIFICATE_IMPORT_OCR_FAILED'],
    ['CONFLICT', 409, 'CERTIFICATE_IMPORT_OCR_FAILED'],
    ['RESPONSE_TOO_LARGE', 502, 'CERTIFICATE_IMPORT_OCR_FAILED'],
    ['UNCERTAIN', 504, 'CERTIFICATE_IMPORT_OCR_FAILED'],
    ['PAGE_COUNT_MISMATCH', 502, 'CERTIFICATE_IMPORT_OCR_FAILED'],
    ['QUOTA', 429, 'CERTIFICATE_IMPORT_OCR_QUOTA'],
  ])('maps envelope %s to %s', async (code, status, expected) => {
    const server = await listen(async (req, res) => {
      await readBody(req);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          version: 'v1',
          code,
          requestId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          message: `vendor ${RUNTIME_SECRET_B64} OCR-PRIVATE-MARKER`,
        }),
      );
    });
    const ocr = provider(server.port, storageFor(JPEG, 'image/jpeg'));

    await expect(ocr.extract([imageInput()])).rejects.toThrow(expected);
    await expect(ocr.extract([imageInput()])).rejects.toThrow(
      /^CERTIFICATE_IMPORT_/,
    );
    await server.close();
  });

  it('does not copy the vendor body into the thrown code', async () => {
    const server = await listen(async (req, res) => {
      await readBody(req);
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          version: 'v1',
          code: 'CONFLICT',
          requestId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          message: `vendor ${RUNTIME_SECRET_B64} OCR-PRIVATE-MARKER`,
        }),
      );
    });
    const ocr = provider(server.port, storageFor(JPEG, 'image/jpeg'));

    try {
      await ocr.extract([imageInput()]);
      throw new Error('expected failure');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      expect(message).toBe('CERTIFICATE_IMPORT_OCR_FAILED');
      expect(message).not.toContain(RUNTIME_SECRET_B64);
      expect(message).not.toContain('OCR-PRIVATE-MARKER');
      expect(message).not.toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    }
    await server.close();
  });

  it.each([
    [429, 'slow down'],
    [502, '<html>upstream</html>'],
    [504, 'gateway timeout'],
  ])(
    'maps status %s without an envelope to UNAVAILABLE',
    async (status, body) => {
      const server = await listen(async (req, res) => {
        await readBody(req);
        res.writeHead(status, { 'content-type': 'text/plain' });
        res.end(body);
      });
      const ocr = provider(server.port, storageFor(JPEG, 'image/jpeg'));

      await expect(ocr.extract([imageInput()])).rejects.toThrow(
        'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
      );
      await server.close();
    },
  );

  it('maps a malformed envelope on 200 to FAILED and on 502 to UNAVAILABLE', async () => {
    const bodies = ['{', JSON.stringify({ version: 'v2', code: 'QUOTA' })];
    for (const body of bodies) {
      const ok = await listen(async (req, res) => {
        await readBody(req);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(body);
      });
      await expect(
        provider(ok.port, storageFor(JPEG, 'image/jpeg')).extract([
          imageInput(),
        ]),
      ).rejects.toThrow('CERTIFICATE_IMPORT_OCR_FAILED');
      await ok.close();

      const down = await listen(async (req, res) => {
        await readBody(req);
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(body);
      });
      await expect(
        provider(down.port, storageFor(JPEG, 'image/jpeg')).extract([
          imageInput(),
        ]),
      ).rejects.toThrow('CERTIFICATE_IMPORT_OCR_UNAVAILABLE');
      await down.close();
    }
  });

  it('stops a response larger than 16 MiB before treating it as JSON', async () => {
    const payload = JSON.stringify({
      version: 'v1',
      operationId: FILE_ID,
      pageCount: 1,
      pages: [
        {
          pageNumber: 1,
          text: `${'x'.repeat(16 * 1024 * 1024)} OCR-PRIVATE-MARKER`,
        },
      ],
    });
    const server = await listen((req, res) => {
      req.on('error', () => undefined);
      res.on('error', () => undefined);
      void readBody(req).then(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(payload);
      });
    });
    const ocr = provider(server.port, storageFor(JPEG, 'image/jpeg'));

    try {
      await ocr.extract([imageInput()]);
      throw new Error('expected failure');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      expect(message).toBe('CERTIFICATE_IMPORT_OCR_FAILED');
      expect(message).not.toContain('OCR-PRIVATE-MARKER');
    }
    await server.close();
  });

  it('maps an oversized 502 to UNAVAILABLE', async () => {
    const server = await listen((req, res) => {
      void readBody(req).then(() => {
        res.writeHead(502, { 'content-type': 'text/plain' });
        res.end(Buffer.alloc(16 * 1024 * 1024 + 8, 0x62));
      });
    });
    const ocr = provider(server.port, storageFor(JPEG, 'image/jpeg'));

    await expect(ocr.extract([imageInput()])).rejects.toThrow(
      'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
    );
    await server.close();
  });

  it('does not follow a redirect', async () => {
    let stolenHits = 0;
    const stolen = await listen((req, res) => {
      stolenHits += 1;
      res.end('ok');
      void req;
    });
    const front = await listen((req, res) => {
      res.writeHead(302, {
        location: `http://127.0.0.1:${stolen.port}/v1/ocr`,
      });
      res.end();
      void req;
    });
    const ocr = provider(front.port, storageFor(JPEG, 'image/jpeg'));

    await expect(ocr.extract([imageInput()])).rejects.toThrow(
      'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
    );
    expect(stolenHits).toBe(0);
    await front.close();
    await stolen.close();
  });

  it('cuts a dripping response at the absolute 40s deadline', async () => {
    let fire: (() => void) | undefined;
    let scheduledMs = 0;
    const server = await listen((req, res) => {
      req.on('error', () => undefined);
      res.on('error', () => undefined);
      res.writeHead(200, { 'content-type': 'application/json' });
      const drip = setInterval(() => {
        res.write(' ');
      }, 5);
      res.on('close', () => clearInterval(drip));
    });
    const ocr = new CloudRunCertificateOcrProvider(
      storageFor(JPEG, 'image/jpeg') as never,
      {
        url: `http://127.0.0.1:${server.port}/v1/ocr`,
        environment: 'development',
        kid: 'k-current',
        secret: Buffer.from('0123456789abcdef0123456789abcdef'),
        now: () => ISSUED_AT,
        randomBytes: (size: number) => Buffer.alloc(size, 3),
        scheduleDeadline: (ms, onFire) => {
          scheduledMs = ms;
          fire = onFire;
          return {
            cancel: () => {
              fire = undefined;
            },
          };
        },
      },
    );
    const pending = ocr.extract([imageInput()]);
    const started = Date.now();
    while (!fire && Date.now() - started < 400) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    if (!fire) {
      void pending.catch(() => undefined);
      throw new Error('absolute deadline was not scheduled');
    }
    expect(scheduledMs).toBe(40_000);
    fire();
    await expect(pending).rejects.toThrow('CERTIFICATE_IMPORT_OCR_UNAVAILABLE');
    await server.close();
  });

  it('times out without copying the socket error', async () => {
    const server = await listen(() => undefined);
    const ocr = provider(server.port, storageFor(JPEG, 'image/jpeg'), {
      timeoutMs: 50,
    });

    try {
      await ocr.extract([imageInput()]);
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toBe(
        'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
      );
    }
    await server.close();
  });

  it('rejects non-loopback http before opening a socket', async () => {
    let hits = 0;
    const server = await listen((req, res) => {
      hits += 1;
      res.end('no');
      void req;
    });
    const ocr = new CloudRunCertificateOcrProvider(
      storageFor(JPEG, 'image/jpeg') as never,
      {
        url: `http://localhost:${server.port}/v1/ocr`,
        environment: 'development',
        kid: 'k-current',
        secret: RUNTIME_SECRET,
      },
    );

    await expect(ocr.extract([imageInput()])).rejects.toThrow(
      'CERTIFICATE_IMPORT_OCR_FAILED',
    );
    expect(hits).toBe(0);
    await server.close();
  });

  it('rejects a self-signed proxy certificate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ocr-tls-'));
    const keyPath = join(dir, 'key.pem');
    const certPath = join(dir, 'cert.pem');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '1',
        '-nodes',
        '-subj',
        '/CN=127.0.0.1',
      ],
      { stdio: 'ignore' },
    );
    const server = createHttpsServer(
      { key: readFileSync(keyPath), cert: readFileSync(certPath) },
      (req, res) => {
        res.end(
          JSON.stringify({
            version: 'v1',
            operationId: FILE_ID,
            pageCount: 1,
            pages: [{ pageNumber: 1, text: 'honor: Uno OCR-PRIVATE-MARKER' }],
          }),
        );
        void req;
      },
    );
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('missing port');
    const ocr = new CloudRunCertificateOcrProvider(
      storageFor(JPEG, 'image/jpeg') as never,
      {
        url: `https://127.0.0.1:${address.port}/v1/ocr`,
        environment: 'development',
        kid: 'k-current',
        secret: RUNTIME_SECRET,
        now: () => ISSUED_AT,
        randomBytes: (size: number) => Buffer.alloc(size, 4),
      },
    );

    try {
      await ocr.extract([imageInput()]);
      throw new Error('expected TLS failure');
    } catch (error) {
      expect((error as Error).message).toBe(
        'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
      );
      expect((error as Error).message).not.toContain('OCR-PRIVATE-MARKER');
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
});

describe('OCR mode selection', () => {
  const storage = { getObjectInfo: jest.fn(), getObject: jest.fn() };
  const visionClientFactory = jest.fn();

  it('selects the remote provider when the proxy settings are complete', () => {
    const selected = selectCertificateOcrProvider({
      config: {
        get: (key: string) => {
          const values: Record<string, string> = {
            OCR_MODE: 'remote',
            OCR_PROXY_URL: 'https://ocr.example/v1/ocr',
            OCR_PROXY_ENV: 'development',
            OCR_PROXY_KID: 'k-current',
            OCR_PROXY_SECRET: RUNTIME_SECRET_B64,
          };
          return values[key];
        },
      },
      storage: storage as never,
      visionClientFactory,
    });

    expect(selected).toBeInstanceOf(CloudRunCertificateOcrProvider);
    expect(visionClientFactory).not.toHaveBeenCalled();
  });

  it('decodes the HMAC secret once at selection and hands the provider a Buffer', () => {
    const decode = jest.spyOn(ocrProxySecret, 'decodeOcrProxySecret');
    try {
      const selected = selectCertificateOcrProvider({
        config: {
          get: (key: string) => {
            const values: Record<string, string> = {
              OCR_MODE: 'remote',
              OCR_PROXY_URL: 'https://ocr.example/v1/ocr',
              OCR_PROXY_ENV: 'development',
              OCR_PROXY_KID: 'k-current',
              OCR_PROXY_SECRET: RUNTIME_SECRET_B64,
            };
            return values[key];
          },
        },
        storage: storage as never,
        visionClientFactory,
      });
      const { secret } = (
        selected as unknown as { options: { secret: unknown } }
      ).options;

      expect(decode).toHaveBeenCalledTimes(1);
      expect(Buffer.isBuffer(secret)).toBe(true);
      expect(secret).toEqual(RUNTIME_SECRET);
    } finally {
      decode.mockRestore();
    }
  });

  it('keeps direct mode on the ADC provider', () => {
    const selected = selectCertificateOcrProvider({
      config: {
        get: (key: string) => (key === 'OCR_MODE' ? 'direct' : undefined),
      },
      storage: storage as never,
      visionClientFactory,
    });

    expect(selected).toBeInstanceOf(GoogleVisionCertificateOcrProvider);
    expect(visionClientFactory).not.toHaveBeenCalled();
  });

  it('fails closed when remote mode is missing url, env, kid, or secret', () => {
    const secret = 'super-secret-hmac-value';
    expect(() =>
      selectCertificateOcrProvider({
        config: {
          get: (key: string) => {
            if (key === 'OCR_MODE') return 'remote';
            if (key === 'OCR_PROXY_SECRET') return secret;
            if (key === 'OCR_PROXY_ENV') return 'development';
            if (key === 'OCR_PROXY_KID') return 'k-current';
            return undefined;
          },
        },
        storage: storage as never,
        visionClientFactory,
      }),
    ).toThrow('OCR remote configuration is incomplete');
    try {
      selectCertificateOcrProvider({
        config: {
          get: (key: string) => (key === 'OCR_MODE' ? 'remote' : secret),
        },
        storage: storage as never,
        visionClientFactory,
      });
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
    expect(visionClientFactory).not.toHaveBeenCalled();
  });

  it('requires OCR_MODE in production and https for the proxy', () => {
    expect(() =>
      selectCertificateOcrProvider({
        config: {
          get: (key: string) => (key === 'NODE_ENV' ? 'production' : undefined),
        },
        storage: storage as never,
        visionClientFactory,
      }),
    ).toThrow('OCR_MODE is required');
    expect(() =>
      selectCertificateOcrProvider({
        config: {
          get: (key: string) => {
            const values: Record<string, string> = {
              NODE_ENV: 'production',
              OCR_MODE: 'remote',
              OCR_PROXY_URL: 'http://127.0.0.1:18080/v1/ocr',
              OCR_PROXY_ENV: 'development',
              OCR_PROXY_KID: 'k-current',
              OCR_PROXY_SECRET: RUNTIME_SECRET_B64,
            };
            return values[key];
          },
        },
        storage: storage as never,
        visionClientFactory,
      }),
    ).toThrow('OCR remote configuration is incomplete');
  });

  it('selects the remote provider from the module factory', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      CertificateBulkImportsModule,
    ) as Array<{
      provide?: unknown;
      useFactory?: unknown;
      useClass?: unknown;
      inject?: unknown[];
    }>;
    const ocr = providers.find(
      (item) => item?.provide === CERTIFICATE_OCR_PROVIDER,
    );

    expect(ocr?.useClass).toBeUndefined();
    expect(typeof ocr?.useFactory).toBe('function');
    expect(ocr?.inject).toEqual(expect.arrayContaining([FILE_STORAGE_SERVICE]));
  });
});

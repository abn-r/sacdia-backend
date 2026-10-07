import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { PDFDocument } from 'pdf-lib';
import { AppInternalServerErrorException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  FILE_STORAGE_SERVICE,
  FileStorageService,
} from '../../common/services/file-storage.service';
import { CERTIFICATE_IMPORT_MAX_BYTES } from '../certificate-import-files.constants';
import {
  GoogleVisionCertificateOcrProvider,
  googleVisionClientFactoryProvider,
} from './google-vision-certificate-ocr.provider';

jest.mock('@google-cloud/vision', () => ({ ImageAnnotatorClient: jest.fn() }));
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const file = {
  fileUrl: 'batches/batch-1/sealed/cert.jpg',
  fileName: 'cert.jpg',
  fileType: 'image/jpeg',
  objectKey: 'batches/batch-1/sealed/cert.jpg',
  sizeBytes: JPEG.length,
};
const callOptions = { timeout: 25_000, retry: { retryCodes: [] } };
async function pdf(pages: number) {
  const document = await PDFDocument.create();
  for (let n = 0; n < pages; n++) document.addPage();
  return Buffer.from(await document.save({ addDefaultPage: false }));
}
function fixture() {
  const storage = {
    getObjectInfo: jest
      .fn()
      .mockResolvedValue({ size: JPEG.length, contentType: 'image/jpeg' }),
    getObject: jest.fn().mockResolvedValue(JPEG),
  };
  const client = {
    auth: { getClient: jest.fn().mockResolvedValue({}) },
    batchAnnotateImages: jest
      .fn()
      .mockResolvedValue([
        { responses: [{ fullTextAnnotation: { text: 'Clase: Amigo' } }] },
      ]),
    batchAnnotateFiles: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const factory = jest.fn().mockReturnValue(client);
  const config = {
    get: (key: string) =>
      ({
        GOOGLE_CLOUD_PROJECT: 'test-project',
        GOOGLE_APPLICATION_CREDENTIALS: '/etc/secrets/vision.json',
      })[key],
  };
  const ocr = new GoogleVisionCertificateOcrProvider(
    storage as unknown as FileStorageService,
    config as unknown as ConfigService,
    factory,
  );
  return { storage, client, factory, ocr };
}
async function pdfFixture(pages: number) {
  const f = fixture();
  const bytes = await pdf(pages);
  f.storage.getObject.mockResolvedValue(bytes);
  f.storage.getObjectInfo.mockResolvedValue({
    size: bytes.length,
    contentType: 'application/pdf',
  });
  f.client.batchAnnotateFiles.mockResolvedValue([
    {
      responses: [
        {
          responses: Array.from({ length: pages }, (_, n) => ({
            context: { pageNumber: n + 1 },
            fullTextAnnotation: { text: `Clase: Clase${n + 1}` },
          })),
        },
      ],
    },
  ]);
  return {
    ...f,
    bytes,
    file: {
      ...file,
      fileName: 'cert.pdf',
      fileType: 'application/pdf',
      sizeBytes: bytes.length,
    },
  };
}
describe('GoogleVisionCertificateOcrProvider ADC', () => {
  it('lazily reuses ADC gRPC client with no key or public object reference', async () => {
    const f = fixture();
    expect(f.factory).not.toHaveBeenCalled();
    const result = await f.ocr.extract([file]);
    await f.ocr.extract([file]);
    expect(f.factory).toHaveBeenCalledTimes(1);
    expect(f.client.auth.getClient).toHaveBeenCalledTimes(1);
    expect(f.factory).toHaveBeenCalledWith({
      fallback: false,
      projectId: 'test-project',
      keyFilename: '/etc/secrets/vision.json',
      'grpc.max_send_message_length': 12 * 1024 * 1024,
      'grpc.max_receive_message_length': 16 * 1024 * 1024,
    });
    expect(f.client.batchAnnotateImages).toHaveBeenCalledWith(
      {
        requests: [
          {
            image: { content: JPEG },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            imageContext: { languageHints: ['es'] },
          },
        ],
      },
      callOptions,
    );
    expect(result.items[0].detectedName).toBe('Amigo');
    expect(
      JSON.stringify(f.client.batchAnnotateImages.mock.calls),
    ).not.toContain('batches/');
  });
  it('waits for credential availability before issuing an RPC', async () => {
    const f = fixture();
    let release!: () => void;
    f.client.auth.getClient.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({});
        }),
    );
    const extraction = f.ocr.extract([file]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.client.batchAnnotateImages).not.toHaveBeenCalled();
    release();
    await extraction;
    expect(f.client.batchAnnotateImages).toHaveBeenCalledTimes(1);
  });
  it('retries credential loading after a recoverable local failure', async () => {
    const f = fixture();
    f.client.auth.getClient.mockRejectedValueOnce(
      new Error('invalid synthetic credentials'),
    );
    await expect(f.ocr.extract([file])).rejects.toThrow(
      'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
    );
    await f.ocr.extract([file]);
    expect(f.client.auth.getClient).toHaveBeenCalledTimes(2);
  });
  it.each([1, 5])(
    'reads the whole %i-page PDF, using inline private bytes',
    async (pages) => {
      const f = await pdfFixture(pages);
      const result = await f.ocr.extract([f.file]);
      expect(f.client.batchAnnotateFiles).toHaveBeenCalledWith(
        {
          requests: [
            {
              inputConfig: { content: f.bytes, mimeType: 'application/pdf' },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
              imageContext: { languageHints: ['es'] },
              pages: Array.from({ length: pages }, (_, n) => n + 1),
            },
          ],
        },
        callOptions,
      );
      expect(result.items).toHaveLength(pages);
      expect(f.client.batchAnnotateImages).not.toHaveBeenCalled();
    },
  );
  it('orders OCR text by page number', async () => {
    const f = await pdfFixture(2);
    f.client.batchAnnotateFiles.mockResolvedValue([
      {
        responses: [
          {
            responses: [
              {
                context: { pageNumber: 2 },
                fullTextAnnotation: { text: 'Clase: Segundo' },
              },
              {
                context: { pageNumber: 1 },
                fullTextAnnotation: { text: 'Clase: Primero' },
              },
            ],
          },
        ],
      },
    ]);
    expect(
      (await f.ocr.extract([f.file])).items.map((i) => i.detectedName),
    ).toEqual(['Primero', 'Segundo']);
  });
  it.each([[1], [1, 1], [1, 3], [1, 2, 3], [1, undefined]])(
    'rejects incomplete/duplicate/extra page coverage %j',
    async (...numbers) => {
      const f = await pdfFixture(2);
      f.client.batchAnnotateFiles.mockResolvedValue([
        {
          responses: [
            {
              responses: numbers.map((pageNumber) => ({
                context: { pageNumber },
                fullTextAnnotation: { text: 'Clase: Amigo' },
              })),
            },
          ],
        },
      ]);
      await expect(f.ocr.extract([f.file])).rejects.toThrow(
        'CERTIFICATE_IMPORT_OCR_FAILED',
      );
    },
  );
  it.each([6, 0])(
    'rejects legacy confirmed PDF with %i pages before any SDK use',
    async (pages) => {
      const f = await pdfFixture(pages);
      await expect(f.ocr.extract([f.file])).rejects.toThrow(
        pages === 6
          ? 'CERTIFICATE_IMPORT_PDF_TOO_MANY_PAGES'
          : 'CERTIFICATE_IMPORT_PDF_INVALID',
      );
      expect(f.factory).not.toHaveBeenCalled();
    },
  );
  it.each([
    [8, 'CERTIFICATE_IMPORT_OCR_QUOTA'],
    [429, 'CERTIFICATE_IMPORT_OCR_QUOTA'],
    ['RESOURCE_EXHAUSTED', 'CERTIFICATE_IMPORT_OCR_QUOTA'],
    [7, 'CERTIFICATE_IMPORT_OCR_UNAVAILABLE'],
    [16, 'CERTIFICATE_IMPORT_OCR_UNAVAILABLE'],
    [4, 'CERTIFICATE_IMPORT_OCR_FAILED'],
    [13, 'CERTIFICATE_IMPORT_OCR_FAILED'],
  ])('maps SDK code %s to safe error', async (code, expected) => {
    const f = fixture();
    f.client.batchAnnotateImages.mockRejectedValue({
      code,
      message: 'secret detail',
    });
    await expect(f.ocr.extract([file])).rejects.toThrow(expected);
  });
  it.each(['ENOENT', 'EACCES'])(
    'maps credential file %s at the SDK auth boundary',
    async (code) => {
      const f = fixture();
      const error = Object.assign(new Error('private credential path'), {
        code,
      });
      f.client.auth = { getClient: jest.fn().mockRejectedValue(error) };
      await expect(f.ocr.extract([file])).rejects.toThrow(
        'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
      );
      expect(f.client.batchAnnotateImages).not.toHaveBeenCalled();
    },
  );
  it.each(['missing-file', 'invalid-json', 'invalid-credential'])(
    'maps actual SDK getClient %s without RPC or real ADC',
    async (kind) => {
      const directory = mkdtempSync(join(tmpdir(), 'vision-test-credentials-'));
      const keyFilename = join(directory, 'fixture.json');
      if (kind !== 'missing-file')
        writeFileSync(
          keyFilename,
          kind === 'invalid-json' ? '{invalid synthetic JSON' : '{}',
        );
      let error: unknown;
      try {
        const output = execFileSync(
          process.execPath,
          [
            '-e',
            `
        const { ImageAnnotatorClient } = require('@google-cloud/vision');
        const client = new ImageAnnotatorClient({ fallback:false, projectId:'test-project', keyFilename:process.argv[1] });
        client.auth.getClient().then(() => { throw new Error('unexpected synthetic credential success'); })
          .catch(error => process.stdout.write(JSON.stringify({ code:error.code, message:error.message })))
          .finally(() => client.close());
      `,
            keyFilename,
          ],
          { cwd: process.cwd(), encoding: 'utf8', timeout: 4000 },
        );
        error = JSON.parse(output);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
      expect(error).toBeDefined();
      const f = fixture();
      f.client.auth = { getClient: jest.fn().mockRejectedValue(error) };
      await expect(f.ocr.extract([file])).rejects.toThrow(
        'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
      );
      expect(f.client.batchAnnotateImages).not.toHaveBeenCalled();
    },
  );
  it('maps missing ADC initialization safely', async () => {
    const f = fixture();
    f.factory.mockImplementation(() => {
      throw new Error('Could not load the default credentials. secret');
    });
    await expect(f.ocr.extract([file])).rejects.toThrow(
      'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
    );
  });
  it.each([
    { responses: [{ error: { code: 8 } }] },
    {
      responses: [
        {
          responses: [
            {
              context: { pageNumber: 1 },
              error: { code: 8 },
              fullTextAnnotation: { text: 'partial' },
            },
          ],
        },
      ],
    },
  ])(
    'rejects file or per-page error even if text is present',
    async (response) => {
      const f = await pdfFixture(1);
      f.client.batchAnnotateFiles.mockResolvedValue([response]);
      await expect(f.ocr.extract([f.file])).rejects.toThrow(
        'CERTIFICATE_IMPORT_OCR_QUOTA',
      );
    },
  );
  it.each([
    undefined,
    {},
    { responses: [] },
    { responses: [{}] },
    { responses: [{ fullTextAnnotation: { text: '  ' } }] },
  ])(
    'does not report success on missing/blank response %j',
    async (response) => {
      const f = fixture();
      f.client.batchAnnotateImages.mockResolvedValue([response]);
      await expect(f.ocr.extract([file])).rejects.toThrow(
        'CERTIFICATE_IMPORT_OCR_FAILED',
      );
    },
  );
  it('limits stored text without truncating page verification', async () => {
    const f = fixture();
    f.client.batchAnnotateImages.mockResolvedValue([
      { responses: [{ fullTextAnnotation: { text: 'x'.repeat(25_000) } }] },
    ]);
    expect((await f.ocr.extract([file])).rawText).toHaveLength(20_000);
  });
  it('keeps storage errors recoverable and does not instantiate vendor', async () => {
    const f = fixture();
    f.storage.getObject.mockRejectedValue(
      new AppInternalServerErrorException(ErrorCode.R2_VALIDATION_FAILED),
    );
    await expect(f.ocr.extract([file])).rejects.toThrow(
      'CERTIFICATE_IMPORT_STORAGE_UNAVAILABLE',
    );
    expect(f.factory).not.toHaveBeenCalled();
  });
  it('refuses arbitrary keys, oversized actual bytes and MIME/magic mismatches', async () => {
    const f = fixture();
    await expect(
      f.ocr.extract([{ ...file, objectKey: 'https://evil.example' }]),
    ).rejects.toThrow('CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED');
    await expect(
      f.ocr.extract([{ ...file, sizeBytes: CERTIFICATE_IMPORT_MAX_BYTES + 1 }]),
    ).rejects.toThrow('CERTIFICATE_IMPORT_OCR_FILE_TOO_LARGE');
    f.storage.getObject.mockResolvedValueOnce(
      Buffer.alloc(CERTIFICATE_IMPORT_MAX_BYTES + 1),
    );
    await expect(f.ocr.extract([file])).rejects.toThrow(
      'CERTIFICATE_IMPORT_OCR_FILE_TOO_LARGE',
    );
    f.storage.getObject.mockResolvedValueOnce(Buffer.from('not jpeg'));
    await expect(f.ocr.extract([file])).rejects.toThrow(
      'CERTIFICATE_IMPORT_FILE_CONTENT_MISMATCH',
    );
    f.storage.getObjectInfo.mockResolvedValueOnce({
      size: JPEG.length,
      contentType: 'text/plain',
    });
    await expect(f.ocr.extract([file])).rejects.toThrow(
      'CERTIFICATE_IMPORT_OCR_UNSUPPORTED_TYPE',
    );
    expect(f.factory).not.toHaveBeenCalled();
  });
  it('closes only an initialized singleton on shutdown', async () => {
    const f = fixture();
    await f.ocr.onModuleDestroy();
    expect(f.client.close).not.toHaveBeenCalled();
    await f.ocr.extract([file]);
    await f.ocr.onModuleDestroy();
    expect(f.client.close).toHaveBeenCalledTimes(1);
  });
  it('resolves real Nest constructor tokens without attempting ADC at boot', async () => {
    const f = fixture();
    const module = await Test.createTestingModule({
      providers: [
        GoogleVisionCertificateOcrProvider,
        { provide: FILE_STORAGE_SERVICE, useValue: f.storage },
        { provide: ConfigService, useValue: { get: () => undefined } },
        googleVisionClientFactoryProvider,
      ],
    }).compile();
    expect(module.get(GoogleVisionCertificateOcrProvider)).toBeDefined();
    expect(ImageAnnotatorClient).not.toHaveBeenCalled();
    await module.close();
  });
});

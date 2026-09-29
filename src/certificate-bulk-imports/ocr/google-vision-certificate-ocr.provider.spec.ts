import { ConfigService } from '@nestjs/config';
import { AppInternalServerErrorException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { FileStorageService } from '../../common/services/file-storage.service';
import { CERTIFICATE_IMPORT_MAX_BYTES } from '../certificate-import-files.constants';
import { GoogleVisionCertificateOcrProvider } from './google-vision-certificate-ocr.provider';

const file = {
  fileUrl: 'batches/batch-1/sealed/cert.jpg',
  fileName: 'cert.jpg',
  fileType: 'image/jpeg',
  objectKey: 'batches/batch-1/sealed/cert.jpg',
  sizeBytes: 1200,
};

function provider(fetchImpl: typeof fetch, apiKey = 'vision-key') {
  const storage = {
    getObjectInfo: jest.fn().mockResolvedValue({
      size: 1200,
      contentType: 'image/jpeg',
    }),
    getObject: jest.fn().mockResolvedValue(Buffer.from('jpeg-bytes')),
  };
  const config = {
    get: (key: string) => (key === 'GOOGLE_VISION_API_KEY' ? apiKey : undefined),
  };
  const ocr = new GoogleVisionCertificateOcrProvider(
    storage as unknown as FileStorageService,
    config as unknown as ConfigService,
  );
  ocr.setFetchForTests(fetchImpl);
  return { storage, ocr };
}

describe('GoogleVisionCertificateOcrProvider', () => {
  it('reads the private image and proposes rows without sending the object key', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        responses: [
          {
            fullTextAnnotation: {
              text: 'Clase: Guía Mayor Avanzado\nFecha: 2008-07-07',
            },
          },
        ],
      }),
    });
    const { ocr, storage } = provider(fetchImpl);

    const result = await ocr.extract([file]);

    expect(storage.getObject).toHaveBeenCalledWith(
      'CERTIFICATE_IMPORTS',
      'batches/batch-1/sealed/cert.jpg',
      CERTIFICATE_IMPORT_MAX_BYTES,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://vision.googleapis.com/v1/images:annotate',
      expect.objectContaining({ method: 'POST', redirect: 'error' }),
    );
    const request = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(request.headers).toEqual(
      expect.objectContaining({ 'x-goog-api-key': 'vision-key' }),
    );
    const body = JSON.parse(String(request.body)) as {
      requests: Array<{
        image: { content: string };
        features: Array<{ type: string }>;
        imageContext: { languageHints: string[] };
      }>;
    };
    expect(body.requests[0].image.content).toBe(
      Buffer.from('jpeg-bytes').toString('base64'),
    );
    expect(body.requests[0].features[0].type).toBe('DOCUMENT_TEXT_DETECTION');
    expect(body.requests[0].imageContext.languageHints).toEqual(['es']);
    expect(JSON.stringify(body)).not.toContain('batches/');
    expect(result.items).toEqual([
      expect.objectContaining({
        detectedName: 'Guía Mayor Avanzado',
        fieldConfidence: expect.objectContaining({ institutional: 1 }),
      }),
    ]);
    expect(result.rawText).not.toMatch(/vision-key/);
  });

  it('stays manual without a key, for a PDF, and above the storage ceiling', async () => {
    const fetchImpl = jest.fn();
    const missing = provider(fetchImpl, '');
    await expect(missing.ocr.extract([file])).rejects.toThrow(
      'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
    );

    const { ocr, storage } = provider(fetchImpl);
    await expect(
      ocr.extract([{ ...file, fileType: 'application/pdf', fileName: 'cert.pdf' }]),
    ).rejects.toThrow('CERTIFICATE_IMPORT_OCR_UNSUPPORTED_TYPE');

    storage.getObjectInfo.mockResolvedValue({
      size: CERTIFICATE_IMPORT_MAX_BYTES + 1,
      contentType: 'image/jpeg',
    });
    await expect(ocr.extract([file])).rejects.toThrow(
      'CERTIFICATE_IMPORT_OCR_FILE_TOO_LARGE',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('keeps the sealed file when storage cannot be read', async () => {
    const fetchImpl = jest.fn();
    const { ocr, storage } = provider(fetchImpl);
    storage.getObject.mockRejectedValue(
      new AppInternalServerErrorException(ErrorCode.R2_VALIDATION_FAILED),
    );

    await expect(ocr.extract([file])).rejects.toThrow(
      'CERTIFICATE_IMPORT_STORAGE_UNAVAILABLE',
    );
    expect(fetchImpl).not.toHaveBeenCalled();

    storage.getObject.mockResolvedValue(Buffer.from('jpeg-bytes'));
    fetchImpl.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        responses: [{ fullTextAnnotation: { text: 'Clase: Amigo' } }],
      }),
    });
    await ocr.extract([file]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps a Vision quota response to the stable stop', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' },
      }),
    });
    const { ocr } = provider(fetchImpl);

    await expect(ocr.extract([file])).rejects.toThrow(
      'CERTIFICATE_IMPORT_OCR_QUOTA',
    );
  });
});

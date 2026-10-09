import { AppInternalServerErrorException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  clipStoredOcrText,
  readSealedCertificateObject,
  STORED_TEXT_LIMIT,
} from './sealed-certificate-object';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0x00]);

function storage(overrides: Record<string, unknown> = {}) {
  return {
    getObjectInfo: jest
      .fn()
      .mockResolvedValue({ size: JPEG.length, contentType: 'image/jpeg' }),
    getObject: jest.fn().mockResolvedValue(JPEG),
    ...overrides,
  };
}

const file = {
  fileUrl: 'k',
  fileName: 'a.jpg',
  fileType: 'image/jpeg',
  objectKey: 'batches/b/sealed/a.jpg',
  sizeBytes: JPEG.length,
};

describe('readSealedCertificateObject', () => {
  it('returns the verified bytes', async () => {
    await expect(
      readSealedCertificateObject(storage() as never, file),
    ).resolves.toBe(JPEG);
  });

  it.each([
    [{ fileType: 'text/plain' }, 'CERTIFICATE_IMPORT_OCR_UNSUPPORTED_TYPE'],
    [{ objectKey: ' ' }, 'CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED'],
    [
      { objectKey: 'https://evil.example/x' },
      'CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED',
    ],
    [{ sizeBytes: 0 }, 'CERTIFICATE_IMPORT_OCR_FILE_TOO_LARGE'],
    [{ sizeBytes: 3 }, 'CERTIFICATE_IMPORT_FILE_CONTENT_MISMATCH'],
  ])('maps %j to %s', async (patch, code) => {
    await expect(
      readSealedCertificateObject(storage() as never, { ...file, ...patch }),
    ).rejects.toMatchObject({ message: code });
  });

  it('checks the declared MIME before touching storage', async () => {
    const s = storage();
    await expect(
      readSealedCertificateObject(s as never, { ...file, fileType: 'x/y' }),
    ).rejects.toMatchObject({
      message: 'CERTIFICATE_IMPORT_OCR_UNSUPPORTED_TYPE',
    });
    expect(s.getObjectInfo).not.toHaveBeenCalled();
  });

  it('maps a storage outage to a retryable code', async () => {
    const s = storage({
      getObjectInfo: jest
        .fn()
        .mockRejectedValue(
          new AppInternalServerErrorException(
            ErrorCode.CERTIFICATE_IMPORT_STORAGE_UNAVAILABLE,
          ),
        ),
    });
    await expect(
      readSealedCertificateObject(s as never, file),
    ).rejects.toMatchObject({
      message: 'CERTIFICATE_IMPORT_STORAGE_UNAVAILABLE',
    });
  });
});

describe('clipStoredOcrText', () => {
  it('keeps at most STORED_TEXT_LIMIT characters', () => {
    expect(clipStoredOcrText('a'.repeat(STORED_TEXT_LIMIT + 5))).toHaveLength(
      STORED_TEXT_LIMIT,
    );
    expect(clipStoredOcrText('short')).toBe('short');
  });
});

import { ConfigService } from '@nestjs/config';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { PassThrough } from 'node:stream';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { R2FinanceEvidenceStorageAdapter } from './r2-finance-evidence-storage.adapter';

const send = jest.fn();
const sign = getSignedUrl as jest.Mock;
const realS3 =
  jest.requireActual<typeof import('@aws-sdk/client-s3')>('@aws-sdk/client-s3');
const realPresigner = jest.requireActual<
  typeof import('@aws-sdk/s3-request-presigner')
>('@aws-sdk/s3-request-presigner');

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return { ...actual, S3Client: jest.fn(() => ({ send })) };
});
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));

const upload = {
  uploadId: '4d20e0c2-990e-4d80-a844-d5925cd2cc79',
  clubId: 18,
  clubSectionId: 42,
};
const env = {
  R2_ACCOUNT_ID: 'account',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_EVIDENCE_FILES: 'evidence',
};
const config = { get: (key: keyof typeof env) => env[key] } as ConfigService;
const issue = {
  ...upload,
  mimeType: 'image/png' as const,
  size: 120,
  expiresInSeconds: 300,
};
const metadata = {
  'finance-upload-id': upload.uploadId,
  'finance-club-id': '18',
  'finance-club-section-id': '42',
  'finance-size': '120',
};

describe('R2FinanceEvidenceStorageAdapter', () => {
  let storage: R2FinanceEvidenceStorageAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    storage = new R2FinanceEvidenceStorageAdapter(config);
  });

  it('presigns a create-only PUT with server-derived key, metadata and short TTL', async () => {
    sign.mockResolvedValue('https://signed.example/upload');

    const result = await storage.issueCreateOnlyPut(issue);
    expect(result.requiredHeaders).toMatchObject({
      'if-none-match': '*',
    });

    const command = sign.mock.calls[0][1] as PutObjectCommand;
    expect(command.input).toMatchObject({
      Bucket: 'evidence',
      Key: `finance-ledger/18/42/${upload.uploadId}`,
      IfNoneMatch: '*',
      ContentType: 'image/png',
      ContentLength: 120,
      Metadata: metadata,
    });
    expect(sign.mock.calls[0][2]).toEqual(
      expect.objectContaining({ expiresIn: 300 }),
    );
    expect(
      jest.requireMock('@aws-sdk/client-s3').S3Client,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ requestChecksumCalculation: 'WHEN_REQUIRED' }),
    );
  });

  it('uses a real presigner without phantom checksum headers', async () => {
    const url = await realPresigner.getSignedUrl(
      new realS3.S3Client({
        region: 'auto',
        endpoint: 'https://account.r2.cloudflarestorage.com',
        forcePathStyle: true,
        credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
        requestChecksumCalculation: 'WHEN_REQUIRED',
      }),
      new PutObjectCommand({
        Bucket: 'evidence',
        Key: 'finance-ledger/18/42/object',
        IfNoneMatch: '*',
        ContentType: 'image/png',
        ContentLength: 120,
      }),
      { expiresIn: 300, signableHeaders: new Set(['content-type']) },
    );
    expect(url).toContain(
      'X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost%3Bif-none-match',
    );
    expect(url).not.toContain('x-amz-checksum-crc32');
    expect(url).not.toContain('x-amz-sdk-checksum-algorithm');
  });

  it('fails closed for unsafe key, MIME, size and TTL', async () => {
    const valid = { ...issue, size: 1 };
    for (const unsafe of [
      { uploadId: '../unsafe' },
      { key: '../unsafe' },
      { mimeType: 'application/pdf' },
      { size: 0 },
      { expiresInSeconds: 901 },
    ])
      await expect(
        storage.issueCreateOnlyPut({ ...valid, ...unsafe }),
      ).rejects.toHaveProperty('code', 'R2_VALIDATION_FAILED');
    expect(sign).not.toHaveBeenCalled();
  });

  it('heads only the derived key and returns immutable observation plus allowlisted metadata', async () => {
    send.mockResolvedValue({
      ETag: '"r2-etag"',
      ContentLength: 120,
      ContentType: 'image/png',
      Metadata: metadata,
    });

    await expect(storage.head(upload)).resolves.toMatchObject({
      etag: '"r2-etag"',
      size: 120,
      mimeType: 'image/png',
      metadata: { ...upload, size: 120 },
    });
    expect(send.mock.calls[0][0].input).toMatchObject({
      Bucket: 'evidence',
      Key: `finance-ledger/18/42/${upload.uploadId}`,
    });
  });

  it('streams a version-pinned GET without buffering and sanitizes object-store failures', async () => {
    const stream = new PassThrough();
    send.mockResolvedValueOnce({ Body: stream });

    const observed = { ...upload, etag: '"r2-etag"' };
    await expect(storage.getStream(observed)).resolves.toBe(stream);
    expect(send.mock.calls[0][0].input).toEqual({
      Bucket: 'evidence',
      Key: `finance-ledger/18/42/${upload.uploadId}`,
      IfMatch: '"r2-etag"',
    });

    send.mockRejectedValueOnce(new Error('object key must not leak'));
    await expect(storage.getStream(observed)).rejects.toHaveProperty(
      'code',
      'R2_VALIDATION_FAILED',
    );
  });
});

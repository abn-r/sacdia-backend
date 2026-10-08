import type { ConfigService } from '@nestjs/config';
import { StorageBucketAlias } from './file-storage.service';

/**
 * The AWS SDK (client-s3 + presigner) costs ~16 MiB RSS. It must not be loaded
 * when R2FileStorageService is imported or constructed (application boot) and
 * must be loaded on the first storage operation.
 */
describe('R2FileStorageService AWS SDK lazy loading', () => {
  const s3Loaded = jest.fn();
  const presignerLoaded = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    s3Loaded.mockClear();
    presignerLoaded.mockClear();
    jest.doMock('@aws-sdk/client-s3', () => {
      s3Loaded();
      return jest.requireActual('@aws-sdk/client-s3');
    });
    jest.doMock('@aws-sdk/s3-request-presigner', () => {
      presignerLoaded();
      return jest.requireActual('@aws-sdk/s3-request-presigner');
    });
  });

  afterEach(() => {
    jest.dontMock('@aws-sdk/client-s3');
    jest.dontMock('@aws-sdk/s3-request-presigner');
  });

  const env: Record<string, string> = {
    R2_ACCOUNT_ID: 'test-account',
    R2_ACCESS_KEY_ID: 'test-key',
    R2_SECRET_ACCESS_KEY: 'test-secret',
    R2_REGION: 'auto',
    R2_BUCKET_EVIDENCE_FILES: 'sacdia-evidence',
    R2_PUBLIC_URL_EVIDENCE_FILES: 'https://priv.r2.dev',
  };
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;

  function loadService() {
    const { R2FileStorageService } = require('./r2-file-storage.service') as {
      R2FileStorageService: new (config: ConfigService) => any;
    };
    return new R2FileStorageService(config);
  }

  it('does not load the AWS SDK when the service is imported or constructed', () => {
    loadService();

    expect(s3Loaded).not.toHaveBeenCalled();
    expect(presignerLoaded).not.toHaveBeenCalled();
  });

  it('loads the SDK on the first signed URL and returns a real presigned URL', async () => {
    const service = loadService();

    const url: string = await service.getSignedDownloadUrl(
      StorageBucketAlias.EVIDENCE_FILES,
      'folder/file.pdf',
    );

    expect(s3Loaded).toHaveBeenCalledTimes(1);
    expect(presignerLoaded).toHaveBeenCalledTimes(1);
    expect(url).toContain('test-account.r2.cloudflarestorage.com');
    expect(url).toContain('X-Amz-Signature=');

    await service.getSignedDownloadUrl(
      StorageBucketAlias.EVIDENCE_FILES,
      'folder/other.pdf',
    );
    expect(s3Loaded).toHaveBeenCalledTimes(1);
    expect(presignerLoaded).toHaveBeenCalledTimes(1);
  });
});

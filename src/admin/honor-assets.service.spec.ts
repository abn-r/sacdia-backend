import 'multer';
import { ErrorCode } from '../common/errors/error-codes';
import { StorageBucketAlias } from '../common/services/file-storage.service';
import { HonorAssetsService } from './honor-assets.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = Buffer.from('%PDF-1.7\n');

function file(
  mimetype: string,
  buffer: Buffer,
  size = buffer.length,
): Express.Multer.File {
  return { mimetype, buffer, size, originalname: 'x' } as Express.Multer.File;
}

describe('HonorAssetsService', () => {
  const storage = {
    upload: jest.fn(async (_bucket: string, key: string) => ({
      key,
      url: `https://pub.example/${key}`,
    })),
  };
  const service = new HonorAssetsService(storage as never);

  beforeEach(() => storage.upload.mockClear());

  it('uploads an image to the honors images bucket under a random key', async () => {
    const result = await service.upload('image', file('image/png', PNG));

    expect(storage.upload).toHaveBeenCalledWith(
      StorageBucketAlias.HONORS_IMAGES,
      expect.stringMatching(/^admin-uploads\/[0-9a-f-]{36}\.png$/),
      PNG,
      { contentType: 'image/png' },
    );
    expect(result.kind).toBe('image');
    expect(result.url).toBe(`https://pub.example/${result.key}`);
  });

  it('uploads the material PDF to the honors PDF bucket', async () => {
    const result = await service.upload(
      'material',
      file('application/pdf', PDF),
    );

    expect(storage.upload).toHaveBeenCalledWith(
      StorageBucketAlias.HONORS_PDF,
      expect.stringMatching(/\.pdf$/),
      PDF,
      { contentType: 'application/pdf' },
    );
    expect(result.kind).toBe('material');
  });

  it('requires a non-empty file', async () => {
    await expect(service.upload('image', undefined)).rejects.toMatchObject({
      code: ErrorCode.HONOR_ASSET_FILE_REQUIRED,
    });
    await expect(
      service.upload('image', file('image/png', Buffer.alloc(0))),
    ).rejects.toMatchObject({ code: ErrorCode.HONOR_ASSET_FILE_REQUIRED });
  });

  it('rejects a PDF sent as image and an image sent as material', async () => {
    await expect(
      service.upload('image', file('application/pdf', PDF)),
    ).rejects.toMatchObject({ code: ErrorCode.FILE_TYPE_INVALID });
    await expect(
      service.upload('material', file('image/png', PNG)),
    ).rejects.toMatchObject({ code: ErrorCode.FILE_TYPE_INVALID });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects a file whose bytes do not match the declared type', async () => {
    await expect(
      service.upload('image', file('image/png', PDF)),
    ).rejects.toMatchObject({ code: ErrorCode.FILE_TYPE_INVALID });
  });

  it('rejects SVG images', async () => {
    await expect(
      service.upload('image', file('image/svg+xml', Buffer.from('<svg/>'))),
    ).rejects.toMatchObject({ code: ErrorCode.FILE_TYPE_INVALID });
  });

  it('rejects an image above 5 MB', async () => {
    const error = await service
      .upload('image', file('image/png', PNG, 5 * 1024 * 1024 + 1))
      .catch((e) => e);
    expect(error).toMatchObject({ code: ErrorCode.HONOR_FILE_TOO_LARGE });
    expect(error.getResponse()).toMatchObject({ namedArgs: { max_mb: 5 } });
    expect(storage.upload).not.toHaveBeenCalled();
  });
});

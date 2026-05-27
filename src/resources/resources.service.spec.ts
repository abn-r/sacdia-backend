import {
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ResourcesService } from './resources.service';

describe('ResourcesService scope authorization', () => {
  const fileStorage = {
    getSignedUploadUrl: jest.fn().mockResolvedValue({
      url: 'https://r2.example/upload',
      key: 'resources/test.pdf',
      expiresInSeconds: 900,
    }),
  };

  const service = new ResourcesService({} as any, fileStorage as any);

  const baseDto = {
    resource_type: 'document' as const,
    file_name: 'cuadernillo.pdf',
    mime_type: 'application/pdf',
    file_size: 1024,
  };

  beforeEach(() => {
    fileStorage.getSignedUploadUrl.mockClear();
  });

  it('accepts the direct authorization snapshot provided by request guards', async () => {
    await expect(
      service.generateUploadUrl(
        {
          ...baseDto,
          scope_level: 'system',
        },
        {
          effective: {
            permissions: ['resources:create'],
            scope: {
              global: {
                country: { id: 1, name: 'México' },
              },
              club: null,
            },
          },
        },
      ),
    ).resolves.toMatchObject({
      upload_url: 'https://r2.example/upload',
      file_key: 'resources/test.pdf',
    });
  });

  it('allows unscoped global admins to create resources for explicit scopes', async () => {
    await expect(
      service.generateUploadUrl(
        {
          ...baseDto,
          scope_level: 'union',
          scope_id: 7,
        },
        {
          effective: {
            permissions: ['resources:create'],
            scope: {
              global: {},
              club: null,
            },
          },
        },
      ),
    ).resolves.toMatchObject({
      upload_url: 'https://r2.example/upload',
      file_key: 'resources/test.pdf',
    });
  });

  it('keeps scoped union admins constrained to their own union', async () => {
    await expect(
      service.generateUploadUrl(
        {
          ...baseDto,
          scope_level: 'union',
          scope_id: 8,
        },
        {
          effective: {
            permissions: ['resources:create'],
            scope: {
              global: {
                union: { id: 7, name: 'Unión 7' },
              },
              club: null,
            },
          },
        },
      ),
    ).rejects.toBeInstanceOf(AppForbiddenException);
  });
});

describe('ResourcesService file replacement', () => {
  it('replaces the stored file metadata and removes the previous object after update', async () => {
    const prisma = {
      resources: {
        findUnique: jest.fn().mockResolvedValue({
          resource_id: 'res-1',
          resource_type: 'document',
          scope_level: 'system',
          scope_id: null,
          file_key: 'system/system/old.pdf',
        }),
        update: jest.fn().mockResolvedValue({
          resource_id: 'res-1',
          file_key: 'system/system/new.pdf',
        }),
      },
    };
    const fileStorage = {
      upload: jest.fn().mockResolvedValue({
        key: 'system/system/new.pdf',
        url: 'https://r2.example/new.pdf',
      }),
      deleteMany: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ResourcesService(prisma as any, fileStorage as any);

    await service.update('res-1', { title: 'Manual actualizado' }, {
      buffer: Buffer.from('%PDF-1.4\n'),
      originalname: 'manual.pdf',
      mimetype: 'application/pdf',
      size: 9,
    } as Express.Multer.File);

    expect(fileStorage.upload).toHaveBeenCalledWith(
      'RESOURCES_FILES',
      expect.stringMatching(/^system\/system\/.+\.pdf$/),
      Buffer.from('%PDF-1.4\n'),
      { contentType: 'application/pdf' },
    );
    expect(prisma.resources.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Manual actualizado',
          file_key: 'system/system/new.pdf',
          file_name: 'manual.pdf',
          file_size: 9,
          file_mime_type: 'application/pdf',
        }),
      }),
    );
    expect(fileStorage.deleteMany).toHaveBeenCalledWith('RESOURCES_FILES', [
      'system/system/old.pdf',
    ]);
  });

  it('does not issue signed URLs for inactive resources', async () => {
    const service = new ResourcesService(
      {
        resources: {
          findUnique: jest.fn().mockResolvedValue({
            resource_id: 'res-1',
            file_key: 'system/system/file.pdf',
            active: false,
          }),
        },
      } as any,
      {} as any,
    );

    await expect(service.getSignedUrl('res-1')).rejects.toBeInstanceOf(
      AppNotFoundException,
    );
  });
});

import {
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { InstitutionalHierarchyService } from '../common/services/institutional-hierarchy.service';
import { PrismaService } from '../prisma/prisma.service';
import { ResourcesService } from './resources.service';

describe('ResourcesService scope authorization', () => {
  const prisma = {
    unions: {
      findUnique: jest.fn(),
    },
    local_fields: {
      findUnique: jest.fn(),
    },
  };
  const fileStorage = {
    getSignedUploadUrl: jest.fn().mockResolvedValue({
      url: 'https://r2.example/upload',
      key: 'resources/test.pdf',
      expiresInSeconds: 900,
    }),
  };
  const hierarchy = {
    resolveCurrent: jest.fn(),
  };

  const service = new ResourcesService(
    prisma as any,
    hierarchy as unknown as InstitutionalHierarchyService,
    fileStorage as any,
  );

  const baseDto = {
    resource_type: 'document' as const,
    file_name: 'cuadernillo.pdf',
    mime_type: 'application/pdf',
    file_size: 1024,
  };

  beforeEach(() => {
    fileStorage.getSignedUploadUrl.mockClear();
    hierarchy.resolveCurrent.mockReset();
    prisma.unions.findUnique.mockReset();
    prisma.local_fields.findUnique.mockReset();
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

  it('keeps scoped country admins constrained to unions inside their country', async () => {
    prisma.unions.findUnique.mockResolvedValue({ country_id: 2 });

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
                country: { id: 1, name: 'México' },
              },
              club: null,
            },
          },
        },
      ),
    ).rejects.toBeInstanceOf(AppForbiddenException);

    expect(fileStorage.getSignedUploadUrl).not.toHaveBeenCalled();
  });
});

describe('ResourcesService file replacement', () => {
  const unscopedGlobalAdmin = {
    effective: {
      permissions: ['resources:update', 'resources:delete', 'resources:read'],
      scope: {
        global: {},
        club: null,
      },
    },
  };

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
    const hierarchy = {
      resolveCurrent: jest.fn(),
    };
    const fileStorage = {
      upload: jest.fn().mockResolvedValue({
        key: 'system/system/new.pdf',
        url: 'https://r2.example/new.pdf',
      }),
      deleteMany: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ResourcesService(
      prisma as any,
      hierarchy as unknown as InstitutionalHierarchyService,
      fileStorage as any,
    );

    await service.update(
      'res-1',
      { title: 'Manual actualizado' },
      {
        buffer: Buffer.from('%PDF-1.4\n'),
        originalname: 'manual.pdf',
        mimetype: 'application/pdf',
        size: 9,
      } as Express.Multer.File,
      unscopedGlobalAdmin,
    );

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
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as any,
      { resolveCurrent: jest.fn() } as unknown as InstitutionalHierarchyService,
      {} as any,
    );

    await expect(
      service.getSignedUrl('res-1', unscopedGlobalAdmin),
    ).rejects.toBeInstanceOf(AppNotFoundException);
  });

  it('does not upload or update when actor cannot access the existing resource scope', async () => {
    const prisma = {
      resources: {
        findUnique: jest.fn().mockResolvedValue({
          resource_id: 'res-1',
          resource_type: 'document',
          scope_level: 'union',
          scope_id: 8,
          file_key: 'union/8/old.pdf',
        }),
        update: jest.fn(),
      },
    };
    const fileStorage = {
      upload: jest.fn(),
      deleteMany: jest.fn(),
    };
    const service = new ResourcesService(
      prisma as any,
      { resolveCurrent: jest.fn() } as unknown as InstitutionalHierarchyService,
      fileStorage as any,
    );

    await expect(
      service.update(
        'res-1',
        { title: 'Manual externo' },
        {
          buffer: Buffer.from('%PDF-1.4\n'),
          originalname: 'manual.pdf',
          mimetype: 'application/pdf',
          size: 9,
        } as Express.Multer.File,
        {
          effective: {
            permissions: ['resources:update'],
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

    expect(fileStorage.upload).not.toHaveBeenCalled();
    expect(prisma.resources.update).not.toHaveBeenCalled();
  });
});

describe('ResourcesService institutional scope policy', () => {
  const mockPrisma = {
    resources: {
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    resource_categories: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockHierarchy = {
    resolveCurrent: jest.fn(),
  };

  const mockFileStorage = {
    getSignedUploadUrl: jest.fn(),
    upload: jest.fn(),
    getObjectInfo: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
  };

  let service: ResourcesService;

  const authorization = {
    grants: {
      global_roles: [
        {
          role_name: 'director-dia',
          permissions: ['resources:create', 'resources:read'],
          scope: {
            division: { id: 1, name: 'DIA' },
          },
        },
      ],
      club_assignments: [
        {
          assignment_id: 'assignment-1',
          role_name: 'director',
          permissions: ['resources:read'],
          club: { club_id: 99, club_name: 'Club Centro' },
          section: { club_section_id: 123, club_type_id: 2 },
          scope: {
            union: { id: 20, name: 'Unión Norte' },
            local_field: { id: 30, name: 'Campo Centro' },
          },
          status: 'active',
        },
      ],
    },
    active_assignment: { assignment_id: 'assignment-1' },
    effective: {
      permissions: ['resources:create', 'resources:read'],
      scope: {
        global: {
          division: { id: 1, name: 'DIA' },
        },
        club: {
          assignment_id: 'assignment-1',
          role_name: 'director',
          club: { club_id: 99, club_name: 'Club Centro' },
          section: { club_section_id: 123, club_type_id: 2 },
        },
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ResourcesService(
      mockPrisma as unknown as PrismaService,
      mockHierarchy as unknown as InstitutionalHierarchyService,
      mockFileStorage as never,
    );

    mockPrisma.resource_categories.findUnique.mockResolvedValue(null);
    mockPrisma.resources.create.mockResolvedValue({
      resource_id: 'resource-1',
    });
    mockPrisma.resources.findMany.mockResolvedValue([]);
    mockPrisma.resources.count.mockResolvedValue(0);
    mockFileStorage.getSignedUploadUrl.mockResolvedValue({
      url: 'https://r2.example/upload',
      key: 'resources/division/1/manual.pdf',
      expiresInSeconds: 900,
    });
    mockPrisma.$transaction.mockImplementation((ops: Promise<unknown>[]) =>
      Promise.all(ops),
    );
  });

  it('allows division-scoped resources for a matching division actor', async () => {
    await service.create(
      {
        title: 'Manual DIA',
        resource_type: 'text',
        scope_level: 'division',
        scope_id: 1,
        content: 'contenido',
      },
      undefined,
      'user-1',
      authorization,
    );

    expect(mockPrisma.resources.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scope_level: 'division',
          scope_id: 1,
        }),
      }),
    );
  });

  it('allows union-scoped resources through the actor division using hierarchy resolution', async () => {
    mockHierarchy.resolveCurrent.mockResolvedValueOnce({
      division_id: 1,
      union_id: 77,
    });

    await service.generateUploadUrl(
      {
        resource_type: 'document',
        scope_level: 'union',
        scope_id: 77,
        file_name: 'manual.pdf',
        mime_type: 'application/pdf',
        file_size: 1024,
      },
      authorization,
    );

    expect(mockHierarchy.resolveCurrent).toHaveBeenCalledWith({ unionId: 77 });
  });

  it('denies a division-scoped resource outside the actor division', async () => {
    await expect(
      service.create(
        {
          title: 'Manual externo',
          resource_type: 'text',
          scope_level: 'division',
          scope_id: 2,
          content: 'contenido',
        },
        undefined,
        'user-1',
        authorization,
      ),
    ).rejects.toBeInstanceOf(AppForbiddenException);

    await expect(
      service.create(
        {
          title: 'Manual externo',
          resource_type: 'text',
          scope_level: 'division',
          scope_id: 2,
          content: 'contenido',
        },
        undefined,
        'user-1',
        authorization,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_SCOPE_ACCESS_DENIED_DIVISION,
    });
  });

  it('includes system, division, union and local-field resources in app visibility', async () => {
    await service.getVisibleResources({}, authorization);

    expect(mockPrisma.resources.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: expect.arrayContaining([
                { scope_level: 'system' },
                { scope_level: 'division', scope_id: 1 },
                { scope_level: 'union', scope_id: 20 },
                { scope_level: 'local_field', scope_id: 30 },
              ]),
            },
          ]),
        }),
      }),
    );
  });

  it('includes resources for the active club type in app visibility', async () => {
    await service.getVisibleResources({}, authorization);

    expect(mockPrisma.resources.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: expect.arrayContaining([
                { club_type_id: null },
                { club_type_id: 2 },
              ]),
            },
          ]),
        }),
      }),
    );
  });
});

describe('ResourcesService createFromUploaded magic bytes', () => {
  const prisma = {
    resource_categories: { findUnique: jest.fn() },
    resources: { create: jest.fn() },
  };
  const fileStorage = {
    getObjectInfo: jest.fn(),
    getObjectPrefix: jest.fn(),
  };
  const hierarchy = { resolveCurrent: jest.fn() };
  const service = new ResourcesService(
    prisma as any,
    hierarchy as unknown as InstitutionalHierarchyService,
    fileStorage as any,
  );
  const actor = {
    effective: {
      permissions: ['resources:create'],
      scope: {
        global: { country: { id: 1, name: 'México' } },
        club: null,
      },
    },
  };
  const dto = {
    title: 'Manual',
    resource_type: 'document' as const,
    scope_level: 'system' as const,
    file_key: 'system/system/abc.pdf',
    file_name: 'manual.pdf',
    file_mime_type: 'application/pdf',
    file_size: 1024,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.resource_categories.findUnique.mockResolvedValue(null);
    prisma.resources.create.mockResolvedValue({ resource_id: 'resource-1' });
    fileStorage.getObjectInfo.mockResolvedValue({
      size: 1024,
      contentType: 'application/pdf',
    });
  });

  it('persists when the R2 prefix matches the declared PDF MIME', async () => {
    fileStorage.getObjectPrefix.mockResolvedValue(Buffer.from('%PDF-1.7\n'));

    await expect(
      service.createFromUploaded(dto, 'user-1', actor),
    ).resolves.toEqual({ resource_id: 'resource-1' });
    expect(prisma.resources.create).toHaveBeenCalled();
  });

  it('rejects when magic bytes do not match the declared MIME', async () => {
    fileStorage.getObjectPrefix.mockResolvedValue(
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    );

    await expect(
      service.createFromUploaded(dto, 'user-1', actor),
    ).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_FILE_CONTENT_MISMATCH,
    });
    expect(prisma.resources.create).not.toHaveBeenCalled();
  });
});

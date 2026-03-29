import { Test, TestingModule } from '@nestjs/testing';
import { HonorsService } from './honors.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';

describe('HonorsService', () => {
  let service: HonorsService;

  const mockPrismaService: any = {
    honors: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    honors_categories: {
      findMany: jest.fn(),
    },
    users_honors: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      count: jest.fn(),
    },
  };

  mockPrismaService.$transaction = jest.fn(async (callback: any) =>
    callback(mockPrismaService),
  );

  const mockFileStorageService = {
    upload: jest.fn(async (bucket: StorageBucketAlias, key: string) => ({
      key,
      url:
        bucket === StorageBucketAlias.USERS_HONORS_CERT
          ? `https://cdn.r2.example/users-honors-cert/${key}`
          : `https://cdn.r2.example/users-honors/${key}`,
    })),
    deleteMany: jest.fn().mockResolvedValue(undefined),
    extractKeyFromPublicUrl: jest.fn(
      (bucket: StorageBucketAlias, publicUrl: string) => {
        const marker =
          bucket === StorageBucketAlias.USERS_HONORS_CERT
            ? '/users-honors-cert/'
            : '/users-honors/';
        const index = publicUrl.indexOf(marker);
        return index === -1 ? null : publicUrl.slice(index + marker.length);
      },
    ),
    getSignedDownloadUrl: jest.fn(
      async (_bucket: StorageBucketAlias, value: string) => value,
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HonorsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
      ],
    }).compile();

    service = module.get<HonorsService>(HonorsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated honors', async () => {
      const mockHonors = [
        { honor_id: 1, name: 'Nudos', active: true },
        { honor_id: 2, name: 'Fogatas', active: true },
      ];

      mockPrismaService.honors.findMany.mockResolvedValue(mockHonors);
      mockPrismaService.honors.count.mockResolvedValue(2);

      const result = await service.findAll();

      expect(result.data).toEqual(mockHonors);
      expect(result.meta.total).toBe(2);
    });

    it('should filter by category', async () => {
      mockPrismaService.honors.findMany.mockResolvedValue([]);
      mockPrismaService.honors.count.mockResolvedValue(0);

      await service.findAll({ categoryId: 5 });

      expect(mockPrismaService.honors.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            honors_category_id: 5,
          }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return honor by id', async () => {
      const mockHonor = { honor_id: 1, name: 'Nudos', active: true };
      mockPrismaService.honors.findUnique.mockResolvedValue(mockHonor);

      const result = await service.findOne(1);

      expect(result).toEqual(mockHonor);
    });

    it('should throw NotFoundException when honor not found', async () => {
      mockPrismaService.honors.findUnique.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getCategories', () => {
    it('should return active categories', async () => {
      const mockCategories = [{ honor_category_id: 1, name: 'Naturaleza' }];

      mockPrismaService.honors_categories.findMany.mockResolvedValue(
        mockCategories,
      );

      const result = await service.getCategories();

      expect(result).toEqual(mockCategories);
    });
  });

  describe('getGroupedByCategory', () => {
    it('should group honors by category', async () => {
      mockPrismaService.honors.findMany.mockResolvedValue([
        {
          honor_id: 1,
          name: 'Aves',
          description: 'Desc Aves',
          honor_image: null,
          skill_level: 1,
          club_type_id: 1,
          honors_category_id: 10,
          honors_categories: {
            honor_category_id: 10,
            name: 'Naturaleza',
            description: 'Especialidades de naturaleza',
            icon: 'leaf',
          },
          club_types: { name: 'Conquistadores' },
        },
        {
          honor_id: 2,
          name: 'Plantas',
          description: 'Desc Plantas',
          honor_image: null,
          skill_level: 2,
          club_type_id: 1,
          honors_category_id: 10,
          honors_categories: {
            honor_category_id: 10,
            name: 'Naturaleza',
            description: 'Especialidades de naturaleza',
            icon: 'leaf',
          },
          club_types: { name: 'Conquistadores' },
        },
        {
          honor_id: 3,
          name: 'Especialidad Legacy',
          description: null,
          honor_image: null,
          skill_level: 1,
          club_type_id: null,
          honors_category_id: null,
          honors_categories: null,
          club_types: null,
        },
      ]);

      const result = await service.getGroupedByCategory();

      expect(result).toHaveLength(2);

      const naturalezaGroup = result.find(
        (group) => group.category.honor_category_id === 10,
      );
      expect(naturalezaGroup).toBeDefined();
      expect(naturalezaGroup?.honors).toHaveLength(2);

      const uncategorizedGroup = result.find(
        (group) => group.category.honor_category_id === null,
      );
      expect(uncategorizedGroup).toBeDefined();
      expect(uncategorizedGroup?.category.name).toBe('Sin categoría');

      expect(mockPrismaService.honors.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { active: true },
        }),
      );
    });

    it('should apply filters when grouping honors', async () => {
      mockPrismaService.honors.findMany.mockResolvedValue([]);

      await service.getGroupedByCategory({
        categoryId: 2,
        clubTypeId: 3,
        skillLevel: 1,
      });

      expect(mockPrismaService.honors.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            active: true,
            honors_category_id: 2,
            club_type_id: 3,
            skill_level: 1,
          },
        }),
      );
    });
  });

  describe('startHonor', () => {
    it('should create user honor', async () => {
      const mockHonor = { honor_id: 1, name: 'Nudos' };
      const mockUserHonor = {
        user_honor_id: 1,
        user_id: 'user-123',
        honor_id: 1,
        active: true,
      };

      mockPrismaService.honors.findUnique.mockResolvedValue(mockHonor);
      mockPrismaService.users_honors.findFirst.mockResolvedValue(null);
      mockPrismaService.users_honors.create.mockResolvedValue(mockUserHonor);

      const result = await service.startHonor('user-123', 1);

      expect(result).toEqual(mockUserHonor);
    });

    it('should throw ConflictException if already has honor', async () => {
      const mockHonor = { honor_id: 1, name: 'Nudos' };
      const existingUserHonor = {
        user_honor_id: 1,
        user_id: 'user-123',
        active: true,
      };

      mockPrismaService.honors.findUnique.mockResolvedValue(mockHonor);
      mockPrismaService.users_honors.findFirst.mockResolvedValue(
        existingUserHonor,
      );

      await expect(service.startHonor('user-123', 1)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('createUserHonor', () => {
    it('should create user honor with initial payload data', async () => {
      const created = { user_honor_id: 99, user_id: 'user-123', honor_id: 5 };

      mockPrismaService.honors.findUnique.mockResolvedValue({
        honor_id: 5,
        active: true,
      });
      mockPrismaService.users_honors.findFirst.mockResolvedValue(null);
      mockPrismaService.users_honors.create.mockResolvedValue(created);

      const result = await service.createUserHonor('user-123', {
        honorId: 5,
        date: '2026-03-03',
        validate: true,
        certificate: 'https://cdn.example.com/cert.pdf',
        images: ['https://cdn.example.com/evidence-1.jpg'],
        document: 'https://cdn.example.com/evidence-doc.pdf',
      });

      expect(result).toEqual(created);
      expect(mockPrismaService.users_honors.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: 'user-123',
            honor_id: 5,
            validate: true,
            certificate: 'https://cdn.example.com/cert.pdf',
            document: 'https://cdn.example.com/evidence-doc.pdf',
          }),
        }),
      );
    });

    it('should update existing user honor instead of creating duplicate', async () => {
      const updated = { user_honor_id: 7, user_id: 'user-123', honor_id: 8 };

      mockPrismaService.honors.findUnique.mockResolvedValue({
        honor_id: 8,
        active: true,
      });
      mockPrismaService.users_honors.findFirst.mockResolvedValue({
        user_honor_id: 7,
      });
      mockPrismaService.users_honors.update.mockResolvedValue(updated);

      const result = await service.createUserHonor('user-123', {
        honorId: 8,
        images: [],
        document: null,
      });

      expect(result).toEqual(updated);
      expect(mockPrismaService.users_honors.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_honor_id: 7 },
          data: expect.objectContaining({
            active: true,
            images: [],
            document: null,
          }),
        }),
      );
    });
  });

  describe('createUserHonorsBulk', () => {
    it('should throw BadRequestException for duplicate honor ids', async () => {
      await expect(
        service.createUserHonorsBulk('user-123', {
          honors: [{ honorId: 10 }, { honorId: 10 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create or update honors in bulk', async () => {
      mockPrismaService.honors.findMany.mockResolvedValue([
        { honor_id: 1 },
        { honor_id: 2 },
      ]);
      mockPrismaService.users_honors.findMany.mockResolvedValue([
        { user_honor_id: 200, honor_id: 1 },
      ]);
      mockPrismaService.users_honors.update.mockResolvedValue({
        user_honor_id: 200,
      });
      mockPrismaService.users_honors.create.mockResolvedValue({
        user_honor_id: 201,
      });

      const result = await service.createUserHonorsBulk('user-123', {
        honors: [{ honorId: 1 }, { honorId: 2 }],
      });

      expect(result).toHaveLength(2);
      expect(mockPrismaService.users_honors.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_honor_id: 200 },
        }),
      );
      expect(mockPrismaService.users_honors.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: 'user-123',
            honor_id: 2,
          }),
        }),
      );
    });
  });

  describe('uploadUserHonorFiles', () => {
    it('should throw when no files are provided', async () => {
      await expect(
        service.uploadUserHonorFiles('user-123', 15, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('should upload files to R2 and persist generated URLs', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        honor_id: 15,
        active: true,
      } as any);
      mockPrismaService.users_honors.findFirst.mockResolvedValue({
        user_honor_id: 70,
        user_id: 'user-123',
        honor_id: 15,
        certificate: '',
        images: [
          'https://cdn.example.com/old-1.jpg',
          'https://cdn.example.com/old-2.jpg',
        ],
        document: null,
      });
      mockPrismaService.users_honors.upsert.mockResolvedValue({
        user_honor_id: 70,
        user_id: 'user-123',
        honor_id: 15,
        certificate:
          'https://cdn.r2.example/users-honors-cert/new-certificate.pdf',
        images: [],
      } as any);

      const certificateFile = {
        originalname: 'certificado.pdf',
        mimetype: 'application/pdf',
        size: 1024,
        buffer: Buffer.from('cert'),
      } as Express.Multer.File;
      const image1 = {
        originalname: 'img1.jpg',
        mimetype: 'image/jpeg',
        size: 1024,
        buffer: Buffer.from('img1'),
      } as Express.Multer.File;
      const image2 = {
        originalname: 'img2.png',
        mimetype: 'image/png',
        size: 1024,
        buffer: Buffer.from('img2'),
      } as Express.Multer.File;

      await service.uploadUserHonorFiles('user-123', 15, {
        certificate: [certificateFile],
        images: [image1, image2],
      });

      expect(mockFileStorageService.upload).toHaveBeenCalledTimes(3);
      expect(mockFileStorageService.upload).toHaveBeenNthCalledWith(
        1,
        StorageBucketAlias.USERS_HONORS_CERT,
        expect.stringMatching(/^cert-user-123-15-\d+\.pdf$/),
        certificateFile.buffer,
        expect.objectContaining({ contentType: 'application/pdf' }),
      );
      expect(mockFileStorageService.upload).toHaveBeenNthCalledWith(
        2,
        StorageBucketAlias.USERS_HONORS,
        'img-user-123-15-img3.jpg',
        image1.buffer,
        expect.objectContaining({ contentType: 'image/jpeg' }),
      );
      expect(mockFileStorageService.upload).toHaveBeenNthCalledWith(
        3,
        StorageBucketAlias.USERS_HONORS,
        'img-user-123-15-img4.png',
        image2.buffer,
        expect.objectContaining({ contentType: 'image/png' }),
      );
      expect(mockPrismaService.users_honors.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            certificate: expect.stringMatching(
              /^https:\/\/cdn\.r2\.example\/users-honors-cert\/cert-user-123-15-\d+\.pdf$/,
            ),
            images: [
              'https://cdn.example.com/old-1.jpg',
              'https://cdn.example.com/old-2.jpg',
              'https://cdn.r2.example/users-honors/img-user-123-15-img3.jpg',
              'https://cdn.r2.example/users-honors/img-user-123-15-img4.png',
            ],
          }),
        }),
      );
    });

    it('should abort DB persistence and rollback uploaded objects when any upload fails', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        honor_id: 15,
        active: true,
      } as any);
      mockPrismaService.users_honors.findFirst.mockResolvedValue({
        user_honor_id: 70,
        user_id: 'user-123',
        honor_id: 15,
        certificate: '',
        images: [],
      });

      mockFileStorageService.upload
        .mockResolvedValueOnce({
          key: 'cert-user-123-15-1000.pdf',
          url: 'https://cdn.r2.example/users-honors-cert/cert-user-123-15-1000.pdf',
        })
        .mockRejectedValueOnce(new Error('R2 unavailable'));

      const certificateFile = {
        originalname: 'certificado.pdf',
        mimetype: 'application/pdf',
        size: 1024,
        buffer: Buffer.from('cert'),
      } as Express.Multer.File;
      const image1 = {
        originalname: 'img1.jpg',
        mimetype: 'image/jpeg',
        size: 1024,
        buffer: Buffer.from('img1'),
      } as Express.Multer.File;

      await expect(
        service.uploadUserHonorFiles('user-123', 15, {
          certificate: [certificateFile],
          images: [image1],
        }),
      ).rejects.toThrow(InternalServerErrorException);

      expect(mockPrismaService.users_honors.upsert).not.toHaveBeenCalled();
      expect(mockFileStorageService.deleteMany).toHaveBeenCalledWith(
        StorageBucketAlias.USERS_HONORS_CERT,
        ['cert-user-123-15-1000.pdf'],
      );
    });

    it('should rollback all uploaded objects when DB save fails', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        honor_id: 15,
        active: true,
      } as any);
      mockPrismaService.users_honors.findFirst.mockResolvedValue({
        user_honor_id: 70,
        user_id: 'user-123',
        honor_id: 15,
        certificate: '',
        images: [],
        document: null,
      });
      mockPrismaService.users_honors.upsert.mockRejectedValueOnce(
        new Error('db failed'),
      );

      mockFileStorageService.upload
        .mockResolvedValueOnce({
          key: 'cert-user-123-15-2000.pdf',
          url: 'https://cdn.r2.example/users-honors-cert/cert-user-123-15-2000.pdf',
        })
        .mockResolvedValueOnce({
          key: 'img-user-123-15-img1.jpg',
          url: 'https://cdn.r2.example/users-honors/img-user-123-15-img1.jpg',
        });

      const certificateFile = {
        originalname: 'certificado.pdf',
        mimetype: 'application/pdf',
        size: 1024,
        buffer: Buffer.from('cert'),
      } as Express.Multer.File;
      const image1 = {
        originalname: 'img1.jpg',
        mimetype: 'image/jpeg',
        size: 1024,
        buffer: Buffer.from('img1'),
      } as Express.Multer.File;

      await expect(
        service.uploadUserHonorFiles('user-123', 15, {
          certificate: [certificateFile],
          images: [image1],
        }),
      ).rejects.toThrow(InternalServerErrorException);

      expect(mockFileStorageService.deleteMany).toHaveBeenNthCalledWith(
        1,
        StorageBucketAlias.USERS_HONORS_CERT,
        ['cert-user-123-15-2000.pdf'],
      );
      expect(mockFileStorageService.deleteMany).toHaveBeenNthCalledWith(
        2,
        StorageBucketAlias.USERS_HONORS,
        ['img-user-123-15-img1.jpg'],
      );
    });

    it('should upload document file and persist its URL', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        honor_id: 15,
        active: true,
      } as any);
      mockPrismaService.users_honors.findFirst.mockResolvedValue({
        user_honor_id: 70,
        user_id: 'user-123',
        honor_id: 15,
        certificate: '',
        images: [],
        document: null,
      });
      mockPrismaService.users_honors.upsert.mockResolvedValue({
        user_honor_id: 70,
        user_id: 'user-123',
        honor_id: 15,
        certificate: '',
        images: [],
        document:
          'https://cdn.r2.example/users-honors/doc-user-123-15-1000.pdf',
      });

      const documentFile = {
        originalname: 'evidencia.pdf',
        mimetype: 'application/pdf',
        size: 1024,
        buffer: Buffer.from('doc'),
      } as Express.Multer.File;

      await service.uploadUserHonorFiles('user-123', 15, {
        document: [documentFile],
      });

      expect(mockFileStorageService.upload).toHaveBeenCalledWith(
        StorageBucketAlias.USERS_HONORS,
        expect.stringMatching(/^doc-user-123-15-\d+\.pdf$/),
        documentFile.buffer,
        expect.objectContaining({ contentType: 'application/pdf' }),
      );
      expect(mockPrismaService.users_honors.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            document: expect.stringMatching(
              /^https:\/\/cdn\.r2\.example\/users-honors\/doc-user-123-15-\d+\.pdf$/,
            ),
          }),
        }),
      );
    });
  });

  describe('getUserHonorStats', () => {
    it('should return user honor statistics', async () => {
      mockPrismaService.users_honors.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(5) // approved
        .mockResolvedValueOnce(3) // pending_review
        .mockResolvedValueOnce(1) // rejected
        .mockResolvedValueOnce(1); // in_progress

      const result = await service.getUserHonorStats('user-123');

      expect(result).toEqual({
        total: 10,
        validated: 5,
        approved: 5,
        pending_review: 3,
        rejected: 1,
        in_progress: 1,
      });
    });
  });
});

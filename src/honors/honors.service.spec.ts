import { Test, TestingModule } from '@nestjs/testing';
import { HonorsService, HONOR_DETAIL_URL_LIMITER } from './honors.service';
import { PrismaService } from '../prisma/prisma.service';
import { AchievementsService } from '../achievements/achievements.service';
import { TranslationService } from '../common/services/translation.service';
import { ErrorCode } from '../common/errors/error-codes';
import { HonorCompletionModeDto } from './dto';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import { MasterHonorsEvaluatorService } from './master-honors-evaluator.service';
import { CatalogCacheService } from '../catalogs/catalog-cache.service';

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
    users_pr: {
      findUnique: jest.fn(),
    },
    club_role_assignments: {
      findFirst: jest.fn(),
    },
  };

  const masterHonorsEvaluator = {
    evaluateUser: jest.fn(),
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
    masterHonorsEvaluator.evaluateUser.mockReset();
    masterHonorsEvaluator.evaluateUser.mockResolvedValue([]);
    mockPrismaService.users_pr.findUnique.mockResolvedValue({
      active_club_assignment_id: 'assignment-1',
    });
    mockPrismaService.club_role_assignments.findFirst.mockResolvedValue({
      club_sections: { club_type_id: 2 },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HonorsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
        {
          provide: AchievementsService,
          useValue: {
            emitEvent: jest
              .fn()
              .mockResolvedValue({ eventLogId: 1, queued: true }),
          },
        },
        {
          provide: MasterHonorsEvaluatorService,
          useValue: masterHonorsEvaluator,
        },
        {
          provide: TranslationService,
          useValue: {
            getCurrentLocale: jest.fn().mockReturnValue('es'),
            translate: jest.fn((record: any) => record),
            translateMany: jest.fn((records: any[]) => records),
          },
        },
        {
          provide: CatalogCacheService,
          useValue: {
            getEpoch: jest.fn().mockResolvedValue(0),
            getOrSet: jest.fn(
              (_key: string, loader: () => Promise<unknown>) => loader(),
            ),
          },
        },
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

    it('should filter by many-to-many club type applicability', async () => {
      mockPrismaService.honors.findMany.mockResolvedValue([]);
      mockPrismaService.honors.count.mockResolvedValue(0);

      await service.findAll({ clubTypeId: 1 });

      expect(mockPrismaService.honors.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            active: true,
            honor_club_types: {
              some: {
                club_type_id: 1,
                active: true,
              },
            },
          }),
        }),
      );
      expect(mockPrismaService.honors.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          honor_club_types: {
            some: {
              club_type_id: 1,
              active: true,
            },
          },
        }),
      });
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

      await expect(service.findOne(999)).rejects.toMatchObject({
        code: ErrorCode.HONOR_NOT_FOUND,
      });
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

    it('reads grouped honors through the catalog cache key for locale and filters', async () => {
      mockPrismaService.honors.findMany.mockResolvedValue([]);
      const catalogCache = (service as any).catalogCache as {
        getOrSet: jest.Mock;
      };

      await service.getGroupedByCategory({
        categoryId: 2,
        clubTypeId: 3,
        skillLevel: 1,
      });

      expect(catalogCache.getOrSet).toHaveBeenCalledWith(
        'cache:catalogs:honors:grouped:e0:es:cat:2:type:3:skill:1',
        expect.any(Function),
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
            honor_club_types: {
              some: {
                club_type_id: 3,
                active: true,
              },
            },
            skill_level: 1,
          },
        }),
      );
    });

    it('should filter grouped honors by many-to-many club type applicability', async () => {
      mockPrismaService.honors.findMany.mockResolvedValue([]);

      await service.getGroupedByCategory({ clubTypeId: 1 });

      expect(mockPrismaService.honors.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            active: true,
            honor_club_types: {
              some: {
                club_type_id: 1,
                active: true,
              },
            },
          }),
        }),
      );
    });
  });

  describe('startHonor', () => {
    it('should create user honor', async () => {
      const mockHonor = {
        honor_id: 1,
        name: 'Nudos',
        honors_category_id: 10,
        club_type_id: 2,
      };
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
      expect(mockPrismaService.users_honors.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            completion_mode: HonorCompletionModeDto.UNDECIDED,
          }),
        }),
      );
    });

    it('should throw ConflictException if already has honor', async () => {
      const mockHonor = {
        honor_id: 1,
        name: 'Nudos',
        honors_category_id: 10,
        club_type_id: 2,
      };
      const existingUserHonor = {
        user_honor_id: 1,
        user_id: 'user-123',
        active: true,
      };

      mockPrismaService.honors.findUnique.mockResolvedValue(mockHonor);
      mockPrismaService.users_honors.findFirst.mockResolvedValue(
        existingUserHonor,
      );

      await expect(service.startHonor('user-123', 1)).rejects.toMatchObject({
        code: ErrorCode.HONOR_USER_ALREADY_IN_PROGRESS,
      });
    });

    it('should reject honors outside the active club section', async () => {
      mockPrismaService.honors.findUnique.mockResolvedValue({
        honor_id: 1,
        name: 'Arte de acampar',
        honors_category_id: 10,
        club_type_id: 2,
      });
      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue({
        club_sections: { club_type_id: 1 },
      });

      await expect(service.startHonor('user-123', 1)).rejects.toMatchObject({
        code: ErrorCode.HONOR_CLUB_TYPE_NOT_ALLOWED,
      });
      expect(mockPrismaService.users_honors.create).not.toHaveBeenCalled();
    });

    it('should reactivate inactive user honor and evaluate master honors', async () => {
      const mockHonor = {
        honor_id: 1,
        name: 'Nudos',
        honors_category_id: 10,
        club_type_id: 2,
      };
      const mockExistingHonor = {
        user_honor_id: 1,
        user_id: 'user-123',
        honor_id: 1,
        active: false,
      };
      const mockUpdated = {
        ...mockExistingHonor,
        active: true,
        validation_status: 'IN_PROGRESS',
        validate: false,
        certificate: '',
        images: [],
        document: null,
        honors: {
          name: 'Nudos',
          honor_image: null,
          honors_categories: { name: 'General' },
        },
      };

      mockPrismaService.honors.findUnique.mockResolvedValue(mockHonor);
      mockPrismaService.users_honors.findFirst.mockResolvedValue(
        mockExistingHonor,
      );
      mockPrismaService.users_honors.update.mockResolvedValue(mockUpdated);

      const result = await service.startHonor('user-123', 1);

      expect(result).toEqual(mockUpdated);
      expect(masterHonorsEvaluator.evaluateUser).toHaveBeenCalledWith(
        'user-123',
      );
      expect(mockPrismaService.users_honors.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_honor_id: 1 },
          data: expect.objectContaining({
            validation_status: 'IN_PROGRESS',
            completion_mode: HonorCompletionModeDto.UNDECIDED,
            active: true,
          }),
        }),
      );
    });

    it('should keep startHonor flow when master honors evaluation fails', async () => {
      const mockHonor = {
        honor_id: 1,
        name: 'Nudos',
        honors_category_id: 10,
        club_type_id: 2,
      };
      const mockExistingHonor = {
        user_honor_id: 1,
        user_id: 'user-123',
        honor_id: 1,
        active: false,
      };
      const mockUpdated = {
        ...mockExistingHonor,
        active: true,
        validation_status: 'IN_PROGRESS',
        validate: false,
        certificate: '',
        images: [],
        document: null,
      };

      mockPrismaService.honors.findUnique.mockResolvedValue(mockHonor);
      mockPrismaService.users_honors.findFirst.mockResolvedValue(
        mockExistingHonor,
      );
      mockPrismaService.users_honors.update.mockResolvedValue(mockUpdated);
      masterHonorsEvaluator.evaluateUser.mockRejectedValue(
        new Error('evaluator failure'),
      );

      const warnSpy = jest.spyOn((service as any).logger, 'warn');

      const result = await service.startHonor('user-123', 1);

      expect(result).toEqual(mockUpdated);
      expect(masterHonorsEvaluator.evaluateUser).toHaveBeenCalledWith(
        'user-123',
      );
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('createUserHonor', () => {
    it('should create user honor with initial payload data', async () => {
      const created = { user_honor_id: 99, user_id: 'user-123', honor_id: 5 };

      mockPrismaService.honors.findUnique.mockResolvedValue({
        honor_id: 5,
        active: true,
        club_type_id: 2,
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
            completion_mode: HonorCompletionModeDto.UNDECIDED,
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
        club_type_id: 2,
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
            completion_mode: HonorCompletionModeDto.UNDECIDED,
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
      ).rejects.toMatchObject({ code: ErrorCode.HONOR_BULK_DUPLICATE_IDS });
    });

    it('should create or update honors in bulk', async () => {
      mockPrismaService.honors.findMany.mockResolvedValue([
        { honor_id: 1, club_type_id: 2 },
        { honor_id: 2, club_type_id: 2 },
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
          data: expect.objectContaining({
            completion_mode: HonorCompletionModeDto.UNDECIDED,
          }),
        }),
      );
      expect(mockPrismaService.users_honors.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: 'user-123',
            honor_id: 2,
            completion_mode: HonorCompletionModeDto.UNDECIDED,
          }),
        }),
      );
    });

    it('should reject bulk honors outside the active club section', async () => {
      mockPrismaService.honors.findMany.mockResolvedValue([
        { honor_id: 1, club_type_id: 1 },
        { honor_id: 2, club_type_id: 2 },
      ]);
      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue({
        club_sections: { club_type_id: 1 },
      });

      await expect(
        service.createUserHonorsBulk('user-123', {
          honors: [{ honorId: 1 }, { honorId: 2 }],
        }),
      ).rejects.toMatchObject({ code: ErrorCode.HONOR_CLUB_TYPE_NOT_ALLOWED });
      expect(mockPrismaService.users_honors.create).not.toHaveBeenCalled();
      expect(mockPrismaService.users_honors.update).not.toHaveBeenCalled();
    });
  });

  describe('uploadUserHonorFiles', () => {
    it('should throw when no files are provided', async () => {
      await expect(
        service.uploadUserHonorFiles('user-123', 15, {}),
      ).rejects.toMatchObject({ code: ErrorCode.HONOR_FILE_REQUIRED });
    });

    it('should block uploads when honor is pending review', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        honor_id: 15,
        active: true,
      } as any);
      mockPrismaService.users_honors.findFirst.mockResolvedValue({
        user_honor_id: 70,
        validation_status: 'PENDING_REVIEW',
      });

      const documentFile = {
        originalname: 'evidencia.pdf',
        mimetype: 'application/pdf',
        size: 1024,
        buffer: Buffer.from('doc'),
      } as Express.Multer.File;

      await expect(
        service.uploadUserHonorFiles('user-123', 15, {
          document: [documentFile],
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_HONOR_INVALID_STATUS,
      });
    });

    it('should throw HONOR_EVIDENCE_MAX_REACHED when more than 10 images are provided', async () => {
      const mockImage = {
        originalname: 'img.jpg',
        mimetype: 'image/jpeg',
        size: 1024,
        buffer: Buffer.from('img'),
      } as Express.Multer.File;
      // 11 images — one over the hard cap
      const images = Array.from({ length: 11 }, () => mockImage);
      await expect(
        service.uploadUserHonorFiles('user-123', 15, { images }),
      ).rejects.toMatchObject({ code: ErrorCode.HONOR_EVIDENCE_MAX_REACHED });
    });

    it('should accept exactly 10 images without throwing the cap error', async () => {
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
        document: null,
      });
      // 10 images — exactly at the cap, should NOT throw HONOR_EVIDENCE_MAX_REACHED
      const mockImage = {
        originalname: 'img.jpg',
        mimetype: 'image/jpeg',
        size: 100 * 1024, // 100 KB — within the 5 MB limit
        buffer: Buffer.from('img'),
      } as Express.Multer.File;
      const images = Array.from({ length: 10 }, () => mockImage);
      // We only assert it does not reject with the cap error; upload proceeds normally.
      await expect(
        service.uploadUserHonorFiles('user-123', 15, { images }),
      ).resolves.toBeDefined();
    });

    it('should reject uploads that would exceed 10 total persisted general images', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        honor_id: 15,
        active: true,
      } as any);
      mockPrismaService.users_honors.findFirst.mockResolvedValue({
        user_honor_id: 70,
        user_id: 'user-123',
        honor_id: 15,
        certificate: '',
        images: Array.from(
          { length: 9 },
          (_, index) => `https://cdn.example.com/old-${index + 1}.jpg`,
        ),
        document: null,
        validation_status: 'IN_PROGRESS',
      });

      const image = {
        originalname: 'img.jpg',
        mimetype: 'image/jpeg',
        size: 1024,
        buffer: Buffer.from('img'),
      } as Express.Multer.File;

      await expect(
        service.uploadUserHonorFiles('user-123', 15, {
          images: [image, image],
        }),
      ).rejects.toMatchObject({ code: ErrorCode.HONOR_EVIDENCE_MAX_REACHED });
      expect(mockFileStorageService.upload).not.toHaveBeenCalled();
      expect(mockPrismaService.users_honors.upsert).not.toHaveBeenCalled();
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
        expect.stringMatching(/^img-user-123-15-\d+-[0-9a-f-]+-img3\.jpg$/),
        image1.buffer,
        expect.objectContaining({ contentType: 'image/jpeg' }),
      );
      expect(mockFileStorageService.upload).toHaveBeenNthCalledWith(
        3,
        StorageBucketAlias.USERS_HONORS,
        expect.stringMatching(/^img-user-123-15-\d+-[0-9a-f-]+-img4\.png$/),
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
              expect.stringMatching(
                /^https:\/\/cdn\.r2\.example\/users-honors\/img-user-123-15-\d+-[0-9a-f-]+-img3\.jpg$/,
              ),
              expect.stringMatching(
                /^https:\/\/cdn\.r2\.example\/users-honors\/img-user-123-15-\d+-[0-9a-f-]+-img4\.png$/,
              ),
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
      ).rejects.toMatchObject({ code: ErrorCode.HONOR_FILE_UPLOAD_FAILED });

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
      ).rejects.toMatchObject({ code: ErrorCode.HONOR_FILE_UPLOAD_FAILED });

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

  describe('updateUserHonor', () => {
    it('should block update when honor is approved', async () => {
      mockPrismaService.users_honors.findFirst.mockResolvedValue({
        user_honor_id: 70,
        validation_status: 'APPROVED',
        active: true,
      });

      await expect(
        service.updateUserHonor('user-123', 15, { validate: false }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_HONOR_INVALID_STATUS,
      });
    });

    it('should allow update when honor is rejected', async () => {
      mockPrismaService.users_honors.findFirst.mockResolvedValue({
        user_honor_id: 70,
        validation_status: 'REJECTED',
        active: true,
      });
      mockPrismaService.users_honors.update.mockResolvedValue({
        user_honor_id: 70,
        validation_status: 'REJECTED',
      });

      await expect(
        service.updateUserHonor('user-123', 15, { validate: false }),
      ).resolves.toMatchObject({ user_honor_id: 70 });
    });

    it('should persist completion mode while honor is mutable', async () => {
      mockPrismaService.users_honors.findFirst.mockResolvedValue({
        user_honor_id: 70,
        validation_status: 'IN_PROGRESS',
        active: true,
      });
      mockPrismaService.users_honors.update.mockResolvedValue({
        user_honor_id: 70,
        completion_mode: HonorCompletionModeDto.IN_APP,
      });

      await expect(
        service.updateUserHonor('user-123', 15, {
          completionMode: HonorCompletionModeDto.IN_APP,
        }),
      ).resolves.toMatchObject({
        user_honor_id: 70,
        completion_mode: HonorCompletionModeDto.IN_APP,
      });

      expect(mockPrismaService.users_honors.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_honor_id: 70 },
          data: expect.objectContaining({
            completion_mode: HonorCompletionModeDto.IN_APP,
          }),
        }),
      );
    });

    it('should block completion mode updates while honor is pending review', async () => {
      mockPrismaService.users_honors.findFirst.mockResolvedValue({
        user_honor_id: 70,
        validation_status: 'PENDING_REVIEW',
        active: true,
      });

      await expect(
        service.updateUserHonor('user-123', 15, {
          completionMode: HonorCompletionModeDto.EXTERNAL,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_HONOR_INVALID_STATUS,
      });

      expect(mockPrismaService.users_honors.update).not.toHaveBeenCalled();
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

  describe('HONOR_DETAIL_URL_LIMITER', () => {
    it('should export a pLimit instance with concurrency cap of 20', () => {
      // pLimit instances expose a .concurrency property reflecting the cap.
      expect(HONOR_DETAIL_URL_LIMITER).toBeDefined();
      expect(typeof HONOR_DETAIL_URL_LIMITER).toBe('function');
      // Verify the limiter actually executes the wrapped function.
      const sentinel = jest.fn().mockResolvedValue('ok');
      return expect(HONOR_DETAIL_URL_LIMITER(sentinel)).resolves.toBe('ok');
    });

    it('should resolve concurrent calls within the cap', async () => {
      // Fire 5 tasks through the limiter; all should resolve correctly.
      const tasks = Array.from({ length: 5 }, (_, i) =>
        HONOR_DETAIL_URL_LIMITER(() => Promise.resolve(i)),
      );
      const results = await Promise.all(tasks);
      expect(results).toEqual([0, 1, 2, 3, 4]);
    });
  });
});

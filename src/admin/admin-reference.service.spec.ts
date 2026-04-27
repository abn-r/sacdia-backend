import { Test, TestingModule } from '@nestjs/testing';
import { ErrorCode } from '../common/errors/error-codes';
import { AdminReferenceService } from './admin-reference.service';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogCacheService } from '../catalogs/catalog-cache.service';
import { TranslationService } from '../common/services/translation.service';

describe('AdminReferenceService', () => {
  let service: AdminReferenceService;

  const mockPrismaService: any = {
    honors_categories: {
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    club_ideals: {
      findMany: jest.fn(),
    },
    honors: {
      count: jest.fn(),
    },
    // $transaction: executes the callback with a tx client that mirrors the mock prisma
    $transaction: jest.fn().mockImplementation(async (callback: (tx: any) => Promise<any>) => {
      const tx = {
        honors_categories: {
          create: mockPrismaService.honors_categories.create,
          update: mockPrismaService.honors_categories.update,
        },
        honors_categories_translations: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          upsert: jest.fn().mockResolvedValue({}),
        },
      };
      return callback(tx);
    }),
  };

  const mockCatalogCacheService: Partial<CatalogCacheService> = {
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
    invalidateAll: jest.fn().mockResolvedValue(undefined),
  };

  const mockTranslationService: Partial<TranslationService> = {
    validateTranslations: jest.fn(),
    upsertTranslations: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminReferenceService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: CatalogCacheService, useValue: mockCatalogCacheService },
        { provide: TranslationService, useValue: mockTranslationService },
      ],
    }).compile();

    service = module.get<AdminReferenceService>(AdminReferenceService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listHonorCategories', () => {
    it('should return paginated honor categories', async () => {
      const items = [
        {
          honor_category_id: 1,
          name: 'Naturaleza',
          _count: { honors: 2 },
        },
      ];

      mockPrismaService.honors_categories.findMany.mockResolvedValue(items);
      mockPrismaService.honors_categories.count.mockResolvedValue(1);

      const result = await service.listHonorCategories({
        page: 2,
        limit: 10,
        search: 'nature',
      } as unknown as Parameters<typeof service.listHonorCategories>[0]);

      expect(result).toEqual({
        items,
        total: 1,
        page: 2,
        limit: 10,
      });
      expect(mockPrismaService.honors_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            name: {
              contains: 'nature',
              mode: 'insensitive',
            },
          },
          skip: 10,
          take: 10,
          orderBy: { name: 'asc' },
          include: {
            _count: {
              select: { honors: true },
            },
          },
        }),
      );
    });

    it('should list all categories without search', async () => {
      mockPrismaService.honors_categories.findMany.mockResolvedValue([]);
      mockPrismaService.honors_categories.count.mockResolvedValue(0);

      await service.listHonorCategories();

      expect(mockPrismaService.honors_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          skip: 0,
          take: 20,
        }),
      );
    });
  });

  describe('getHonorCategory', () => {
    it('should return honor category by id', async () => {
      const category = {
        honor_category_id: 3,
        name: 'Espiritualidad',
        _count: { honors: 4 },
      };

      mockPrismaService.honors_categories.findUniqueOrThrow.mockResolvedValue(
        category,
      );

      const result = await service.getHonorCategory(3);

      expect(result).toEqual(category);
      expect(
        mockPrismaService.honors_categories.findUniqueOrThrow,
      ).toHaveBeenCalledWith({
        where: { honor_category_id: 3 },
        include: {
          _count: {
            select: { honors: true },
          },
        },
      });
    });
  });

  describe('createHonorCategory', () => {
    it('should create a new honor category', async () => {
      const created = {
        honor_category_id: 7,
        name: 'Naturaleza',
        description: 'Especialidades de naturaleza',
        icon: 12,
        active: true,
        _count: { honors: 0 },
      };

      mockPrismaService.honors_categories.findFirst.mockResolvedValue(null);
      mockPrismaService.honors_categories.create.mockResolvedValue(created);

      const result = await service.createHonorCategory(
        {
          name: '  Naturaleza  ',
          description: 'Especialidades de naturaleza',
          icon: 12,
        },
        'actor-1',
      );

      expect(result).toEqual(created);
      expect(
        mockPrismaService.honors_categories.findFirst,
      ).toHaveBeenCalledWith({
        where: {
          name: { equals: 'Naturaleza', mode: 'insensitive' },
        },
      });
      expect(mockPrismaService.honors_categories.create).toHaveBeenCalledWith({
        data: {
          name: 'Naturaleza',
          description: 'Especialidades de naturaleza',
          icon: 12,
          active: true,
        },
        include: {
          _count: {
            select: { honors: true },
          },
        },
      });
    });

    it('should throw when honor category already exists', async () => {
      mockPrismaService.honors_categories.findFirst.mockResolvedValue({
        honor_category_id: 1,
      });

      await expect(
        service.createHonorCategory({ name: 'Naturaleza' }, 'actor-1'),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_HONOR_CATEGORY_NAME_CONFLICT });
    });
  });

  describe('updateHonorCategory', () => {
    it('should update an honor category', async () => {
      const current = { honor_category_id: 5, name: 'Naturaleza' };
      const updated = {
        honor_category_id: 5,
        name: 'Naturaleza renovada',
        description: 'Nueva descripción',
        icon: null,
        active: false,
        modified_at: new Date('2026-03-18T00:00:00.000Z'),
        _count: { honors: 1 },
      };

      mockPrismaService.honors_categories.findUnique.mockResolvedValue(current);
      mockPrismaService.honors_categories.findFirst.mockResolvedValue(null);
      mockPrismaService.honors_categories.update.mockResolvedValue(updated);

      const result = await service.updateHonorCategory(
        5,
        {
          name: ' Naturaleza renovada ',
          description: 'Nueva descripción',
          icon: null,
          active: false,
        },
        'actor-2',
      );

      expect(result).toEqual(updated);
      expect(
        mockPrismaService.honors_categories.findUnique,
      ).toHaveBeenCalledWith({
        where: { honor_category_id: 5 },
      });
      expect(mockPrismaService.honors_categories.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { honor_category_id: 5 },
          data: expect.objectContaining({
            name: 'Naturaleza renovada',
            description: 'Nueva descripción',
            icon: null,
            active: false,
          }),
          include: {
            _count: {
              select: { honors: true },
            },
          },
        }),
      );
    });

    it('should throw when honor category is missing', async () => {
      mockPrismaService.honors_categories.findUnique.mockResolvedValue(null);

      await expect(
        service.updateHonorCategory(9, { name: 'Nuevo nombre' }, 'actor-2'),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_HONOR_CATEGORY_NOT_FOUND });
    });
  });

  describe('deleteHonorCategory', () => {
    it('should deactivate an honor category when not in use', async () => {
      const existing = { honor_category_id: 11, name: 'Servicio' };
      const deleted = {
        honor_category_id: 11,
        name: 'Servicio',
        active: false,
        _count: { honors: 0 },
      };

      mockPrismaService.honors_categories.findUnique.mockResolvedValue(
        existing,
      );
      mockPrismaService.honors.count.mockResolvedValue(0);
      mockPrismaService.honors_categories.update.mockResolvedValue(deleted);

      const result = await service.deleteHonorCategory(11, 'actor-3');

      expect(result).toEqual(deleted);
      expect(mockPrismaService.honors.count).toHaveBeenCalledWith({
        where: {
          honors_category_id: 11,
          active: true,
        },
      });
      expect(mockPrismaService.honors_categories.update).toHaveBeenCalledWith({
        where: { honor_category_id: 11 },
        data: {
          active: false,
          modified_at: expect.any(Date),
        },
        include: {
          _count: {
            select: { honors: true },
          },
        },
      });
    });

    it('should throw when honor category is in use', async () => {
      mockPrismaService.honors_categories.findUnique.mockResolvedValue({
        honor_category_id: 12,
      });
      mockPrismaService.honors.count.mockResolvedValue(1);

      await expect(service.deleteHonorCategory(12, 'actor-3')).rejects.toMatchObject({
        code: ErrorCode.ADMIN_HONOR_CATEGORY_IN_USE,
      });
    });
  });

  describe('listClubIdeals', () => {
    it('should return all club ideals ordered by club type and ideal order', async () => {
      const ideals = [
        {
          club_ideal_id: 2,
          name: 'Amor',
          ideal_order: 1,
          club_type_id: 1,
        },
        {
          club_ideal_id: 4,
          name: 'Servicio',
          ideal_order: 2,
          club_type_id: 1,
        },
      ];

      mockPrismaService.club_ideals.findMany.mockResolvedValue(ideals);

      const result = await service.listClubIdeals();

      expect(result).toEqual(ideals);
      expect(mockPrismaService.club_ideals.findMany).toHaveBeenCalledWith({
        orderBy: [{ club_type_id: 'asc' }, { ideal_order: 'asc' }],
        take: 200,
      });
    });
  });
});

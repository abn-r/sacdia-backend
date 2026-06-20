import { Test, TestingModule } from '@nestjs/testing';
import { ErrorCode } from '../common/errors/error-codes';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { TranslationService } from '../common/services/translation.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';

describe('InventoryService', () => {
  let service: InventoryService;

  const mockPrismaService = {
    club_inventory: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    inventory_categories: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    club_sections: {
      findUnique: jest.fn(),
    },
    inventory_history: {
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
    },
    inventory_evidence_files: {
      count: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockFileStorageService = {
    upload: jest.fn(async (_bucket: StorageBucketAlias, key: string) => ({
      key,
      url: `https://cdn.example/${key}`,
    })),
    deleteMany: jest.fn(),
    getSignedDownloadUrl: jest.fn(
      async (_bucket: StorageBucketAlias, value: string) => value,
    ),
  };

  // ---- shared fixtures ----

  const baseCategory = {
    inventory_category_id: 1,
    name: 'Camping',
    active: true,
  };

  const baseSection = {
    club_section_id: 10,
    main_club_id: 5,
    club_type_id: 2,
    name: 'Conquistadores',
    active: true,
  };

  const baseItem = {
    club_inventory_id: 100,
    name: 'Carpas 4 personas',
    description: 'Carpas Coleman',
    inventory_category_id: 1,
    amount: 8,
    club_section_id: 10,
    active: true,
    created_at: new Date('2026-01-01'),
    modified_at: new Date('2026-01-02'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockTranslationService: Partial<TranslationService> = {
      getCurrentLocale: jest.fn().mockReturnValue('es'),
      translateMany: jest.fn().mockImplementation((records) => records),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: TranslationService, useValue: mockTranslationService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);

    // Stub private helpers that call prisma.inventory_history
    jest.spyOn(service as any, 'getInventoryHistory').mockResolvedValue([]);
    jest
      .spyOn(service as any, 'logInventoryChange')
      .mockResolvedValue(undefined);
    mockPrismaService.club_sections.findUnique.mockResolvedValue(baseSection);
    mockPrismaService.inventory_evidence_files.findMany.mockResolvedValue([]);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================================
  // findAllCategories
  // ============================================================

  describe('findAllCategories', () => {
    it('TC01 - happy path: returns active categories ordered by name', async () => {
      const categories = [
        baseCategory,
        { ...baseCategory, inventory_category_id: 2, name: 'Herramientas' },
      ];
      mockPrismaService.inventory_categories.findMany.mockResolvedValue(
        categories,
      );

      const result = await service.findAllCategories();

      expect(result).toEqual(categories);
      expect(
        mockPrismaService.inventory_categories.findMany,
      ).toHaveBeenCalledWith({
        where: { active: true },
        orderBy: { name: 'asc' },
      });
    });

    it('TC02 - returns empty array when no categories exist', async () => {
      mockPrismaService.inventory_categories.findMany.mockResolvedValue([]);

      const result = await service.findAllCategories();

      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // findAllByClub
  // ============================================================

  describe('findAllByClub', () => {
    it('TC03 - happy path: returns items for the requested club section', async () => {
      mockPrismaService.club_inventory.findMany.mockResolvedValue([baseItem]);
      mockPrismaService.inventory_categories.findMany.mockResolvedValue([
        baseCategory,
      ]);

      const result = await service.findAllByClub(10);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].inventory_id).toBe(100);
      expect(result.data[0].category?.name).toBe('Camping');
      expect(result.meta.total_items).toBe(1);
      expect(result.meta.club_id).toBe(5);
      expect(result.meta.club_section_id).toBe(10);
      expect(mockPrismaService.club_inventory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            active: true,
            club_section_id: 10,
          }),
        }),
      );
    });

    it('TC04 - filters by categoryId when provided', async () => {
      mockPrismaService.club_inventory.findMany.mockResolvedValue([]);
      mockPrismaService.inventory_categories.findMany.mockResolvedValue([]);

      await service.findAllByClub(10, 1);

      expect(mockPrismaService.club_inventory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            club_section_id: 10,
            inventory_category_id: 1,
          }),
        }),
      );
    });

    it('TC05 - returns items without category when inventory_category_id is null', async () => {
      const itemNoCategory = { ...baseItem, inventory_category_id: null };
      mockPrismaService.club_inventory.findMany.mockResolvedValue([
        itemNoCategory,
      ]);
      mockPrismaService.inventory_categories.findMany.mockResolvedValue([]);

      const result = await service.findAllByClub(10);

      expect(result.data[0].category).toBeNull();
    });

    it('TC06 - returns empty data and meta.total_items=0 when no items', async () => {
      mockPrismaService.club_inventory.findMany.mockResolvedValue([]);
      mockPrismaService.inventory_categories.findMany.mockResolvedValue([]);

      const result = await service.findAllByClub(10);

      expect(result.data).toHaveLength(0);
      expect(result.meta.total_items).toBe(0);
    });

    it('TC07 - does not reinterpret the requested section as main_club_id', async () => {
      mockPrismaService.club_inventory.findMany.mockResolvedValue([baseItem]);
      mockPrismaService.inventory_categories.findMany.mockResolvedValue([
        baseCategory,
      ]);

      const result = await service.findAllByClub(10);

      expect(mockPrismaService.club_inventory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            club_section_id: 10,
          }),
        }),
      );
      const calledWith =
        mockPrismaService.club_inventory.findMany.mock.calls[0][0];
      expect(calledWith.where.club_sections).toBeUndefined();
      expect(result.meta.club_id).toBe(5);
      expect(result.meta.club_section_id).toBe(10);
    });

    it('TC08 - error: club section not found → NotFoundException', async () => {
      mockPrismaService.club_sections.findUnique.mockResolvedValue(null);

      await expect(service.findAllByClub(999)).rejects.toMatchObject({
        code: ErrorCode.INVENTORY_SECTION_NOT_FOUND,
      });
      expect(mockPrismaService.club_inventory.findMany).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // findOne
  // ============================================================

  describe('findOne', () => {
    it('TC07 - happy path: returns item with category and history', async () => {
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(baseItem);
      mockPrismaService.inventory_categories.findUnique.mockResolvedValue(
        baseCategory,
      );

      const result = await service.findOne(100);

      expect(result.inventory_id).toBe(100);
      expect(result.category?.category_id).toBe(1);
      expect(result.category?.name).toBe('Camping');
      expect(result.history).toEqual([]);
    });

    it('TC07b - maps CREATE history performer as created_by for detail audit', async () => {
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(baseItem);
      mockPrismaService.inventory_categories.findUnique.mockResolvedValue(
        baseCategory,
      );
      (service as any).getInventoryHistory.mockResolvedValue([
        {
          history_id: 1,
          action: 'CREATE',
          field_changed: 'name',
          old_value: null,
          new_value: 'Carpas 4 personas',
          performed_by: {
            user_id: 'user-abc',
            name: 'Ana',
            paternal_last_name: 'López',
            avatar_url: 'https://signed.example/ana.jpg',
          },
          created_at: new Date('2026-01-01'),
        },
      ]);

      const result = await service.findOne(100);

      expect(result.created_by).toEqual({
        user_id: 'user-abc',
        name: 'Ana',
        paternal_last_name: 'López',
        avatar_url: 'https://signed.example/ana.jpg',
      });
      expect(result.created_by_name).toBe('Ana López');
    });

    it('TC08 - happy path: returns item with null category when no inventory_category_id', async () => {
      const itemNoCategory = { ...baseItem, inventory_category_id: null };
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(
        itemNoCategory,
      );

      const result = await service.findOne(100);

      expect(result.category).toBeNull();
      expect(
        mockPrismaService.inventory_categories.findUnique,
      ).not.toHaveBeenCalled();
    });

    it('TC09 - error: item not found → NotFoundException', async () => {
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toMatchObject({
        code: ErrorCode.INVENTORY_NOT_FOUND,
      });
    });

    it('TC10 - returns null category when category record not found in DB', async () => {
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(baseItem);
      mockPrismaService.inventory_categories.findUnique.mockResolvedValue(null);

      const result = await service.findOne(100);

      expect(result.category).toBeNull();
    });
  });

  // ============================================================
  // getInventoryHistory
  // ============================================================

  describe('getInventoryHistory', () => {
    it('maps performer profile picture to signed avatar_url when available', async () => {
      ((service as any).getInventoryHistory as jest.Mock).mockRestore();
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(baseItem);
      mockPrismaService.inventory_history.findMany.mockResolvedValue([
        {
          history_id: 1,
          action: 'CREATE',
          field_changed: 'name',
          old_value: null,
          new_value: 'Carpas 4 personas',
          users: {
            user_id: 'user-abc',
            name: 'Ana',
            paternal_last_name: 'López',
            user_image: 'user-profiles/ana.jpg',
          },
          created_at: new Date('2026-01-01'),
        },
      ]);
      mockFileStorageService.getSignedDownloadUrl.mockResolvedValueOnce(
        'https://signed.example/ana.jpg',
      );

      const result = await service.getInventoryHistory(100);

      expect(mockPrismaService.inventory_history.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            users: {
              select: {
                user_id: true,
                name: true,
                paternal_last_name: true,
                user_image: true,
              },
            },
          },
        }),
      );
      expect(mockFileStorageService.getSignedDownloadUrl).toHaveBeenCalledWith(
        StorageBucketAlias.USER_PROFILES,
        'user-profiles/ana.jpg',
        { expiresInSeconds: expect.any(Number) },
      );
      expect(result[0].performed_by).toEqual({
        user_id: 'user-abc',
        name: 'Ana',
        paternal_last_name: 'López',
        avatar_url: 'https://signed.example/ana.jpg',
      });
    });
  });

  // ============================================================
  // create
  // ============================================================

  describe('create', () => {
    const createDto: CreateItemDto = {
      name: 'Carpas 4 personas',
      description: 'Carpas Coleman',
      inventory_category_id: 1,
      amount: 8,
      instanceType: 'pathf',
    };

    it('TC11 - happy path: creates item and returns mapped response', async () => {
      mockPrismaService.inventory_categories.findUnique.mockResolvedValue(
        baseCategory,
      );
      mockPrismaService.club_sections.findUnique.mockResolvedValue(baseSection);
      mockPrismaService.club_inventory.create.mockResolvedValue(baseItem);

      const result = await service.create(10, createDto, 'user-abc');

      expect(result.inventory_id).toBe(100);
      expect(result.name).toBe('Carpas 4 personas');
      expect(result.category.name).toBe('Camping');
      expect(result.active).toBe(true);
      expect(mockPrismaService.club_inventory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: createDto.name,
            active: true,
            club_section_id: 10,
          }),
        }),
      );
    });

    it('TC12 - error: category not found → NotFoundException', async () => {
      mockPrismaService.inventory_categories.findUnique.mockResolvedValue(null);

      await expect(
        service.create(10, createDto, 'user-abc'),
      ).rejects.toMatchObject({
        code: ErrorCode.INVENTORY_CATEGORY_NOT_FOUND,
      });
    });

    it('TC13 - error: category inactive → NotFoundException', async () => {
      mockPrismaService.inventory_categories.findUnique.mockResolvedValue({
        ...baseCategory,
        active: false,
      });

      await expect(
        service.create(10, createDto, 'user-abc'),
      ).rejects.toMatchObject({
        code: ErrorCode.INVENTORY_CATEGORY_NOT_FOUND,
      });
    });

    it('TC14 - error: club section not found → NotFoundException', async () => {
      mockPrismaService.inventory_categories.findUnique.mockResolvedValue(
        baseCategory,
      );
      mockPrismaService.club_sections.findUnique.mockResolvedValue(null);

      await expect(
        service.create(10, createDto, 'user-abc'),
      ).rejects.toMatchObject({
        code: ErrorCode.INVENTORY_SECTION_NOT_FOUND,
      });
    });

    it('TC15 - logInventoryChange is called after successful create', async () => {
      mockPrismaService.inventory_categories.findUnique.mockResolvedValue(
        baseCategory,
      );
      mockPrismaService.club_sections.findUnique.mockResolvedValue(baseSection);
      mockPrismaService.club_inventory.create.mockResolvedValue(baseItem);

      await service.create(10, createDto, 'user-abc');

      expect((service as any).logInventoryChange).toHaveBeenCalledWith(
        baseItem.club_inventory_id,
        'CREATE',
        expect.any(Array),
        'user-abc',
      );
    });
  });

  // ============================================================
  // uploadEvidence
  // ============================================================

  describe('uploadEvidence', () => {
    const imageFile = {
      originalname: 'carpa.jpg',
      mimetype: 'image/jpeg',
      size: 128,
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    } as Express.Multer.File;

    it('uploads an image evidence while the item has fewer than 3 active evidences', async () => {
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(baseItem);
      mockPrismaService.inventory_evidence_files.count.mockResolvedValue(2);
      mockPrismaService.inventory_evidence_files.create.mockResolvedValue({
        inventory_evidence_file_id: 12,
        inventory_id: 100,
        file_url: 'https://cdn.example/inventory/100/evidence.jpg',
        file_name: 'carpa.jpg',
        file_type: 'image/jpeg',
        file_size: 128,
        uploaded_by_id: 'user-abc',
        uploaded_at: new Date('2026-06-18T23:00:00.000Z'),
        active: true,
      });

      const result = await service.uploadEvidence(100, 'user-abc', imageFile);

      expect(mockFileStorageService.upload).toHaveBeenCalledWith(
        StorageBucketAlias.EVIDENCE_FILES,
        expect.stringMatching(/^inventory\/100\/evidence-/),
        imageFile.buffer,
        { contentType: 'image/jpeg' },
      );
      expect(result).toMatchObject({
        evidence_id: 12,
        inventory_id: 100,
        file_name: 'carpa.jpg',
        file_type: 'image/jpeg',
      });
    });

    it('rejects evidence upload when the item already has 3 active evidences', async () => {
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(baseItem);
      mockPrismaService.inventory_evidence_files.count.mockResolvedValue(3);

      await expect(
        service.uploadEvidence(100, 'user-abc', imageFile),
      ).rejects.toMatchObject({
        code: ErrorCode.INVENTORY_EVIDENCE_LIMIT_EXCEEDED,
      });
      expect(mockFileStorageService.upload).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // update
  // ============================================================

  describe('update', () => {
    const updateDto: UpdateItemDto = {
      name: 'Carpas 6 personas',
      amount: 5,
    };

    const updatedItem = { ...baseItem, name: 'Carpas 6 personas', amount: 5 };

    it('TC16 - happy path: updates item and returns mapped response', async () => {
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(baseItem);
      mockPrismaService.club_inventory.update.mockResolvedValue(updatedItem);
      mockPrismaService.inventory_categories.findUnique.mockResolvedValue(
        baseCategory,
      );

      const result = await service.update(100, updateDto, 'user-abc');

      expect(result.name).toBe('Carpas 6 personas');
      expect(result.amount).toBe(5);
      expect(mockPrismaService.club_inventory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { club_inventory_id: 100 },
        }),
      );
    });

    it('TC17 - error: item not found → NotFoundException', async () => {
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(null);

      await expect(
        service.update(999, updateDto, 'user-abc'),
      ).rejects.toMatchObject({
        code: ErrorCode.INVENTORY_NOT_FOUND,
      });
    });

    it('TC18 - error: new category not found → NotFoundException', async () => {
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(baseItem);
      const dtoWithCategory: UpdateItemDto = {
        ...updateDto,
        inventory_category_id: 99,
      };
      mockPrismaService.inventory_categories.findUnique.mockResolvedValue(null);

      await expect(
        service.update(100, dtoWithCategory, 'user-abc'),
      ).rejects.toMatchObject({ code: ErrorCode.INVENTORY_CATEGORY_NOT_FOUND });
    });

    it('TC19 - error: new category inactive → NotFoundException', async () => {
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(baseItem);
      const dtoWithCategory: UpdateItemDto = {
        ...updateDto,
        inventory_category_id: 99,
      };
      mockPrismaService.inventory_categories.findUnique.mockResolvedValue({
        inventory_category_id: 99,
        name: 'Inactiva',
        active: false,
      });

      await expect(
        service.update(100, dtoWithCategory, 'user-abc'),
      ).rejects.toMatchObject({ code: ErrorCode.INVENTORY_CATEGORY_NOT_FOUND });
    });

    it('TC20 - returns null category when updated item has no category', async () => {
      const itemNoCategory = { ...updatedItem, inventory_category_id: null };
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(baseItem);
      mockPrismaService.club_inventory.update.mockResolvedValue(itemNoCategory);

      const result = await service.update(100, updateDto, 'user-abc');

      expect(result.category).toBeNull();
      // findUnique for category should not be called when there's no category_id
      expect(
        mockPrismaService.inventory_categories.findUnique,
      ).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // delete (soft delete)
  // ============================================================

  describe('delete', () => {
    it('TC21 - happy path: soft deletes item and returns success message', async () => {
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(baseItem);
      mockPrismaService.club_inventory.update.mockResolvedValue({
        ...baseItem,
        active: false,
      });

      const result = await service.delete(100, 'user-abc');

      expect(result.message).toBe('Inventory item deleted successfully');
      expect(mockPrismaService.club_inventory.update).toHaveBeenCalledWith({
        where: { club_inventory_id: 100 },
        data: { active: false },
      });
    });

    it('TC22 - error: item not found → NotFoundException', async () => {
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(null);

      await expect(service.delete(999, 'user-abc')).rejects.toMatchObject({
        code: ErrorCode.INVENTORY_NOT_FOUND,
      });
    });

    it('TC23 - logInventoryChange is called with DELETE action', async () => {
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(baseItem);
      mockPrismaService.club_inventory.update.mockResolvedValue({
        ...baseItem,
        active: false,
      });

      await service.delete(100, 'user-abc');

      expect((service as any).logInventoryChange).toHaveBeenCalledWith(
        100,
        'DELETE',
        expect.arrayContaining([
          expect.objectContaining({ field: 'active', newValue: 'false' }),
        ]),
        'user-abc',
      );
    });
  });
});

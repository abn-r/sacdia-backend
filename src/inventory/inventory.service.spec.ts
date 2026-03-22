import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';

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
    },
  };

  // ---- shared fixtures ----

  const baseCategory = {
    inventory_category_id: 1,
    name: 'Camping',
    active: true,
  };

  const baseSection = {
    club_section_id: 10,
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);

    // Stub private helpers that call prisma.inventory_history
    jest
      .spyOn(service as any, 'getInventoryHistory')
      .mockResolvedValue([]);
    jest
      .spyOn(service as any, 'logInventoryChange')
      .mockResolvedValue(undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================================
  // findAllCategories
  // ============================================================

  describe('findAllCategories', () => {
    it('TC01 - happy path: returns active categories ordered by name', async () => {
      const categories = [baseCategory, { ...baseCategory, inventory_category_id: 2, name: 'Herramientas' }];
      mockPrismaService.inventory_categories.findMany.mockResolvedValue(categories);

      const result = await service.findAllCategories();

      expect(result).toEqual(categories);
      expect(mockPrismaService.inventory_categories.findMany).toHaveBeenCalledWith({
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
    it('TC03 - happy path: returns items with category info mapped', async () => {
      mockPrismaService.club_inventory.findMany.mockResolvedValue([baseItem]);
      mockPrismaService.inventory_categories.findMany.mockResolvedValue([baseCategory]);

      const result = await service.findAllByClub(10);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].inventory_id).toBe(100);
      expect(result.data[0].category?.name).toBe('Camping');
      expect(result.meta.total_items).toBe(1);
      expect(result.meta.club_section_id).toBe(10);
    });

    it('TC04 - filters by categoryId when provided', async () => {
      mockPrismaService.club_inventory.findMany.mockResolvedValue([]);
      mockPrismaService.inventory_categories.findMany.mockResolvedValue([]);

      await service.findAllByClub(10, 1);

      expect(mockPrismaService.club_inventory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ inventory_category_id: 1 }),
        }),
      );
    });

    it('TC05 - returns items without category when inventory_category_id is null', async () => {
      const itemNoCategory = { ...baseItem, inventory_category_id: null };
      mockPrismaService.club_inventory.findMany.mockResolvedValue([itemNoCategory]);
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
  });

  // ============================================================
  // findOne
  // ============================================================

  describe('findOne', () => {
    it('TC07 - happy path: returns item with category and history', async () => {
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(baseItem);
      mockPrismaService.inventory_categories.findUnique.mockResolvedValue(baseCategory);

      const result = await service.findOne(100);

      expect(result.inventory_id).toBe(100);
      expect(result.category?.category_id).toBe(1);
      expect(result.category?.name).toBe('Camping');
      expect(result.history).toEqual([]);
    });

    it('TC08 - happy path: returns item with null category when no inventory_category_id', async () => {
      const itemNoCategory = { ...baseItem, inventory_category_id: null };
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(itemNoCategory);

      const result = await service.findOne(100);

      expect(result.category).toBeNull();
      expect(mockPrismaService.inventory_categories.findUnique).not.toHaveBeenCalled();
    });

    it('TC09 - error: item not found → NotFoundException', async () => {
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });

    it('TC10 - returns null category when category record not found in DB', async () => {
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(baseItem);
      mockPrismaService.inventory_categories.findUnique.mockResolvedValue(null);

      const result = await service.findOne(100);

      expect(result.category).toBeNull();
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
      mockPrismaService.inventory_categories.findUnique.mockResolvedValue(baseCategory);
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

      await expect(service.create(10, createDto, 'user-abc')).rejects.toThrow(NotFoundException);
    });

    it('TC13 - error: category inactive → NotFoundException', async () => {
      mockPrismaService.inventory_categories.findUnique.mockResolvedValue({
        ...baseCategory,
        active: false,
      });

      await expect(service.create(10, createDto, 'user-abc')).rejects.toThrow(NotFoundException);
    });

    it('TC14 - error: club section not found → NotFoundException', async () => {
      mockPrismaService.inventory_categories.findUnique.mockResolvedValue(baseCategory);
      mockPrismaService.club_sections.findUnique.mockResolvedValue(null);

      await expect(service.create(10, createDto, 'user-abc')).rejects.toThrow(NotFoundException);
    });

    it('TC15 - logInventoryChange is called after successful create', async () => {
      mockPrismaService.inventory_categories.findUnique.mockResolvedValue(baseCategory);
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
      mockPrismaService.inventory_categories.findUnique.mockResolvedValue(baseCategory);

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

      await expect(service.update(999, updateDto, 'user-abc')).rejects.toThrow(NotFoundException);
    });

    it('TC18 - error: new category not found → NotFoundException', async () => {
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(baseItem);
      const dtoWithCategory: UpdateItemDto = { ...updateDto, inventory_category_id: 99 };
      mockPrismaService.inventory_categories.findUnique.mockResolvedValue(null);

      await expect(service.update(100, dtoWithCategory, 'user-abc')).rejects.toThrow(NotFoundException);
    });

    it('TC19 - error: new category inactive → NotFoundException', async () => {
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(baseItem);
      const dtoWithCategory: UpdateItemDto = { ...updateDto, inventory_category_id: 99 };
      mockPrismaService.inventory_categories.findUnique.mockResolvedValue({
        inventory_category_id: 99,
        name: 'Inactiva',
        active: false,
      });

      await expect(service.update(100, dtoWithCategory, 'user-abc')).rejects.toThrow(NotFoundException);
    });

    it('TC20 - returns null category when updated item has no category', async () => {
      const itemNoCategory = { ...updatedItem, inventory_category_id: null };
      mockPrismaService.club_inventory.findUnique.mockResolvedValue(baseItem);
      mockPrismaService.club_inventory.update.mockResolvedValue(itemNoCategory);

      const result = await service.update(100, updateDto, 'user-abc');

      expect(result.category).toBeNull();
      // findUnique for category should not be called when there's no category_id
      expect(mockPrismaService.inventory_categories.findUnique).not.toHaveBeenCalled();
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

      await expect(service.delete(999, 'user-abc')).rejects.toThrow(NotFoundException);
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

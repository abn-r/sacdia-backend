import { Test, TestingModule } from '@nestjs/testing';
import { AppBadRequestException } from '../../common/errors/app.exception';
import { award_tier_enum } from '@prisma/client';
import { AwardCategoriesService } from '../award-categories.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';

describe('AwardCategoriesService', () => {
  let service: AwardCategoriesService;

  const mockPrismaService = {
    club_types: {
      findUnique: jest.fn(),
    },
    award_categories: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AwardCategoriesService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<AwardCategoriesService>(AwardCategoriesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ================================================================
  // create
  // ================================================================

  describe('create', () => {
    const baseDto = {
      name: 'Placa de Honor',
      min_points: 80,
    };

    const mockCategory = {
      award_category_id: 'cat-uuid-1',
      name: 'Placa de Honor',
      description: null,
      club_type_id: null,
      min_points: 80,
      max_points: null,
      icon: null,
      order: 0,
      active: true,
      tier: null as award_tier_enum | null,
    };

    it('should create a category successfully without club_type_id', async () => {
      mockPrismaService.award_categories.create.mockResolvedValue(mockCategory);

      const result = await service.create(baseDto);

      expect(mockPrismaService.club_types.findUnique).not.toHaveBeenCalled();
      expect(result).toEqual(mockCategory);
    });

    it('should create a category successfully with a valid club_type_id', async () => {
      const dto = { ...baseDto, club_type_id: 2 };
      const categoryWithClub = {
        ...mockCategory,
        club_type_id: 2,
        club_type: { club_type_id: 2, name: 'Conquistadores' },
      };

      mockPrismaService.club_types.findUnique.mockResolvedValue({
        club_type_id: 2,
        name: 'Conquistadores',
      });
      mockPrismaService.award_categories.create.mockResolvedValue(
        categoryWithClub,
      );

      const result = await service.create(dto);

      expect(mockPrismaService.club_types.findUnique).toHaveBeenCalledWith({
        where: { club_type_id: 2 },
      });
      expect(result.club_type_id).toBe(2);
    });

    it('should reject if club_type_id does not exist', async () => {
      const dto = { ...baseDto, club_type_id: 999 };
      mockPrismaService.club_types.findUnique.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toMatchObject({
        code: ErrorCode.AWARD_CATEGORY_CLUB_TYPE_NOT_FOUND,
      });
    });

    it('should skip club_type validation when club_type_id is null', async () => {
      const dto = { ...baseDto, club_type_id: null };
      mockPrismaService.award_categories.create.mockResolvedValue(mockCategory);

      await service.create(dto as any);

      expect(mockPrismaService.club_types.findUnique).not.toHaveBeenCalled();
    });

    it('should use defaults when optional fields are not provided', async () => {
      mockPrismaService.award_categories.create.mockResolvedValue(mockCategory);

      await service.create(baseDto);

      expect(mockPrismaService.award_categories.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            order: 0,
            active: true,
            club_type_id: null,
            icon: null,
          }),
        }),
      );
    });

    it('should throw AppBadRequestException when min_composite_pct >= max_composite_pct', async () => {
      const dto = { ...baseDto, min_composite_pct: 80, max_composite_pct: 70 };

      await expect(service.create(dto)).rejects.toThrow(AppBadRequestException);
      expect(mockPrismaService.award_categories.create).not.toHaveBeenCalled();
    });

    it('should create successfully when min_composite_pct < max_composite_pct', async () => {
      const dto = { ...baseDto, min_composite_pct: 70, max_composite_pct: 80 };
      mockPrismaService.award_categories.create.mockResolvedValue({
        ...mockCategory,
        min_composite_pct: 70,
        max_composite_pct: 80,
      });

      const result = await service.create(dto);

      expect(mockPrismaService.award_categories.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            min_composite_pct: 70,
            max_composite_pct: 80,
          }),
        }),
      );
      expect(result).toMatchObject({
        min_composite_pct: 70,
        max_composite_pct: 80,
      });
    });

    it('should include tier=GOLD in Prisma data when tier is provided', async () => {
      const dto = { ...baseDto, tier: award_tier_enum.GOLD };
      mockPrismaService.award_categories.create.mockResolvedValue({
        ...mockCategory,
        tier: award_tier_enum.GOLD,
      });

      const result = await service.create(dto);

      expect(mockPrismaService.award_categories.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tier: award_tier_enum.GOLD }),
        }),
      );
      expect(result.tier).toBe(award_tier_enum.GOLD);
    });

    it('should NOT include tier key in Prisma data when tier is omitted', async () => {
      mockPrismaService.award_categories.create.mockResolvedValue(mockCategory);

      await service.create(baseDto);

      const callArg =
        mockPrismaService.award_categories.create.mock.calls[0][0];
      expect(callArg.data).not.toHaveProperty('tier');
    });

    it('should expose tier=null from DB row when tier was not set', async () => {
      mockPrismaService.award_categories.create.mockResolvedValue({
        ...mockCategory,
        tier: null,
      });

      const result = await service.create(baseDto);

      expect(result.tier).toBeNull();
    });
  });

  // ================================================================
  // findAll
  // ================================================================

  describe('findAll', () => {
    const mockCategories = [
      { award_category_id: 'cat-1', name: 'Alpha', order: 1, active: true },
      { award_category_id: 'cat-2', name: 'Beta', order: 2, active: true },
    ];

    it('should return all active categories by default', async () => {
      mockPrismaService.award_categories.findMany.mockResolvedValue(
        mockCategories,
      );

      const result = await service.findAll();

      expect(mockPrismaService.award_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: true }),
        }),
      );
      expect(result).toEqual(mockCategories);
    });

    it('should filter categories by club_type_id', async () => {
      mockPrismaService.award_categories.findMany.mockResolvedValue([
        mockCategories[0],
      ]);

      await service.findAll(2);

      expect(mockPrismaService.award_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ club_type_id: 2 }),
        }),
      );
    });

    it('should filter categories by active=false when explicitly requested', async () => {
      mockPrismaService.award_categories.findMany.mockResolvedValue([]);

      await service.findAll(undefined, false);

      expect(mockPrismaService.award_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: false }),
        }),
      );
    });

    it('should return categories ordered by order then name', async () => {
      mockPrismaService.award_categories.findMany.mockResolvedValue(
        mockCategories,
      );

      await service.findAll();

      expect(mockPrismaService.award_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ order: 'asc' }, { name: 'asc' }],
        }),
      );
    });

    it('should return empty array when no categories match', async () => {
      mockPrismaService.award_categories.findMany.mockResolvedValue([]);

      const result = await service.findAll(999);

      expect(result).toHaveLength(0);
    });

    it('scope=club → where clause includes { scope: "club" }', async () => {
      mockPrismaService.award_categories.findMany.mockResolvedValue([
        {
          award_category_id: 'cat-1',
          name: 'Alpha',
          scope: 'club',
          active: true,
        },
      ]);

      await service.findAll(undefined, undefined, 'club');

      expect(mockPrismaService.award_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ scope: 'club' }),
        }),
      );
    });

    it('should filter out legacy categories by default (include_legacy=false)', async () => {
      mockPrismaService.award_categories.findMany.mockResolvedValue(
        mockCategories,
      );

      await service.findAll(undefined, undefined, undefined, false);

      expect(mockPrismaService.award_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ is_legacy: false }),
        }),
      );
    });
  });

  // ================================================================
  // findOne
  // ================================================================

  describe('findOne', () => {
    it('should return a category by ID', async () => {
      const mockCategory = {
        award_category_id: 'cat-uuid-1',
        name: 'Placa de Honor',
        active: true,
      };
      mockPrismaService.award_categories.findUnique.mockResolvedValue(
        mockCategory,
      );

      const result = await service.findOne('cat-uuid-1');

      expect(result).toEqual(mockCategory);
    });

    it('should throw NotFoundException for non-existent category', async () => {
      mockPrismaService.award_categories.findUnique.mockResolvedValue(null);

      await expect(service.findOne('non-existent-id')).rejects.toMatchObject({
        code: ErrorCode.AWARD_CATEGORY_NOT_FOUND,
      });
    });
  });

  // ================================================================
  // update
  // ================================================================

  describe('update', () => {
    const categoryId = 'cat-uuid-1';

    const existingCategory = {
      award_category_id: categoryId,
      name: 'Placa de Honor',
      min_points: 80,
      club_type_id: null,
      active: true,
      club_type: null,
    };

    it('should update partial fields only', async () => {
      mockPrismaService.award_categories.findUnique.mockResolvedValue(
        existingCategory,
      );
      mockPrismaService.award_categories.update.mockResolvedValue({
        ...existingCategory,
        name: 'Placa de Plata',
      });

      const result = await service.update(categoryId, {
        name: 'Placa de Plata',
      });

      expect(mockPrismaService.award_categories.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Placa de Plata' }),
        }),
      );
      expect(result.name).toBe('Placa de Plata');
    });

    it('should validate club_type_id when updating', async () => {
      mockPrismaService.award_categories.findUnique.mockResolvedValue(
        existingCategory,
      );
      mockPrismaService.club_types.findUnique.mockResolvedValue({
        club_type_id: 3,
        name: 'Aventureros',
      });
      mockPrismaService.award_categories.update.mockResolvedValue({
        ...existingCategory,
        club_type_id: 3,
      });

      await service.update(categoryId, { club_type_id: 3 });

      expect(mockPrismaService.club_types.findUnique).toHaveBeenCalledWith({
        where: { club_type_id: 3 },
      });
    });

    it('should reject update if new club_type_id does not exist', async () => {
      mockPrismaService.award_categories.findUnique.mockResolvedValue(
        existingCategory,
      );
      mockPrismaService.club_types.findUnique.mockResolvedValue(null);

      await expect(
        service.update(categoryId, { club_type_id: 999 }),
      ).rejects.toMatchObject({
        code: ErrorCode.AWARD_CATEGORY_CLUB_TYPE_NOT_FOUND,
      });
    });

    it('should throw NotFoundException when category does not exist', async () => {
      mockPrismaService.award_categories.findUnique.mockResolvedValue(null);

      await expect(
        service.update('non-existent', { name: 'New Name' }),
      ).rejects.toMatchObject({ code: ErrorCode.AWARD_CATEGORY_NOT_FOUND });

      expect(mockPrismaService.award_categories.update).not.toHaveBeenCalled();
    });

    it('should skip club_type validation when club_type_id is not in update dto', async () => {
      mockPrismaService.award_categories.findUnique.mockResolvedValue(
        existingCategory,
      );
      mockPrismaService.award_categories.update.mockResolvedValue({
        ...existingCategory,
        min_points: 90,
      });

      await service.update(categoryId, { min_points: 90 });

      expect(mockPrismaService.club_types.findUnique).not.toHaveBeenCalled();
    });

    it('should throw AppBadRequestException when min_composite_pct >= max_composite_pct on update', async () => {
      mockPrismaService.award_categories.findUnique.mockResolvedValue(
        existingCategory,
      );

      await expect(
        service.update(categoryId, {
          min_composite_pct: 50,
          max_composite_pct: 40,
        }),
      ).rejects.toThrow(AppBadRequestException);

      expect(mockPrismaService.award_categories.update).not.toHaveBeenCalled();
    });

    it('should update tier from NULL to SILVER when tier is provided', async () => {
      mockPrismaService.award_categories.findUnique.mockResolvedValue(
        existingCategory,
      );
      mockPrismaService.award_categories.update.mockResolvedValue({
        ...existingCategory,
        tier: award_tier_enum.SILVER,
      });

      const result = await service.update(categoryId, {
        tier: award_tier_enum.SILVER,
      });

      expect(mockPrismaService.award_categories.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tier: award_tier_enum.SILVER }),
        }),
      );
      expect(result.tier).toBe(award_tier_enum.SILVER);
    });

    it('should NOT include tier key in Prisma data when tier is omitted from update dto', async () => {
      mockPrismaService.award_categories.findUnique.mockResolvedValue(
        existingCategory,
      );
      mockPrismaService.award_categories.update.mockResolvedValue({
        ...existingCategory,
        name: 'Updated Name',
      });

      await service.update(categoryId, { name: 'Updated Name' });

      const callArg =
        mockPrismaService.award_categories.update.mock.calls[0][0];
      expect(callArg.data).not.toHaveProperty('tier');
    });
  });

  // ================================================================
  // remove (soft delete)
  // ================================================================

  describe('remove', () => {
    const categoryId = 'cat-uuid-1';

    const existingCategory = {
      award_category_id: categoryId,
      name: 'Placa de Honor',
      active: true,
      club_type: null,
    };

    it('should soft-delete by setting active=false', async () => {
      mockPrismaService.award_categories.findUnique.mockResolvedValue(
        existingCategory,
      );
      mockPrismaService.award_categories.update.mockResolvedValue({
        ...existingCategory,
        active: false,
      });

      const result = await service.remove(categoryId);

      expect(mockPrismaService.award_categories.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { award_category_id: categoryId },
          data: { active: false },
        }),
      );
      expect(result.message).toBe('Award category deactivated successfully');
    });

    it('should NOT hard-delete the record', async () => {
      mockPrismaService.award_categories.findUnique.mockResolvedValue(
        existingCategory,
      );
      mockPrismaService.award_categories.update.mockResolvedValue({
        ...existingCategory,
        active: false,
      });

      await service.remove(categoryId);

      // Ensure delete was never called — only update (soft-delete)
      expect(mockPrismaService.award_categories).not.toHaveProperty('delete');
    });

    it('should return 404 for non-existent category', async () => {
      mockPrismaService.award_categories.findUnique.mockResolvedValue(null);

      await expect(service.remove('non-existent-id')).rejects.toMatchObject({
        code: ErrorCode.AWARD_CATEGORY_NOT_FOUND,
      });

      expect(mockPrismaService.award_categories.update).not.toHaveBeenCalled();
    });
  });
});

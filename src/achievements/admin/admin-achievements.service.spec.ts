import { Test, TestingModule } from '@nestjs/testing';
import { AdminAchievementsService } from './admin-achievements.service';
import { AchievementsService } from '../achievements.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../../common/services/file-storage.service';
import { ACHIEVEMENT_DEFAULT_BADGE_URL } from '../achievements.constants';

describe('AdminAchievementsService', () => {
  let service: AdminAchievementsService;

  const mockPrismaService: any = {
    achievement_categories: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    achievements: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    user_achievements: {
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    users: {
      findMany: jest.fn(),
    },
  };

  const mockAchievementsService = {
    findAllAchievements: jest.fn(),
    getAchievementDetail: jest.fn(),
    validateCriteria: jest.fn().mockReturnValue({ valid: true }),
    enqueueRetroactiveEvaluation: jest.fn().mockResolvedValue({ queued: true }),
    resolveBadgeUrl: jest
      .fn()
      .mockImplementation(
        (key: string | null | undefined) =>
          key
            ? `https://cdn.r2.example/achievements-badges/${key}`
            : ACHIEVEMENT_DEFAULT_BADGE_URL,
      ),
  };

  const mockFileStorageService = {
    upload: jest.fn().mockResolvedValue({
      key: 'achievements/badges/1_bronze.png',
      url: 'https://cdn.r2.example/achievements-badges/achievements/badges/1_bronze.png',
    }),
    resolvePublicUrl: jest
      .fn()
      .mockImplementation(
        (_bucket: string, key: string) =>
          `https://cdn.r2.example/achievements-badges/${key}`,
      ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAchievementsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AchievementsService, useValue: mockAchievementsService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
      ],
    }).compile();

    service = module.get<AdminAchievementsService>(AdminAchievementsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Category CRUD
  // ---------------------------------------------------------------------------

  describe('createCategory', () => {
    it('should create a new category with provided fields', async () => {
      const mockCategory = {
        achievement_category_id: 1,
        name: 'Naturaleza',
        description: 'Categoría de naturaleza',
        icon: 'leaf',
        display_order: 1,
        active: true,
      };
      mockPrismaService.achievement_categories.create.mockResolvedValue(
        mockCategory,
      );

      const result = await service.createCategory({
        name: 'Naturaleza',
        description: 'Categoría de naturaleza',
        icon: 'leaf',
        display_order: 1,
        active: true,
      });

      expect(result).toEqual(mockCategory);
      expect(
        mockPrismaService.achievement_categories.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Naturaleza' }),
        }),
      );
    });
  });

  describe('updateCategory', () => {
    it('should update an existing category', async () => {
      const mockCategory = {
        achievement_category_id: 1,
        name: 'Naturaleza',
        active: true,
      };
      const updated = { ...mockCategory, name: 'Naturaleza Actualizada' };

      mockPrismaService.achievement_categories.findUnique.mockResolvedValue(
        mockCategory,
      );
      mockPrismaService.achievement_categories.update.mockResolvedValue(
        updated,
      );

      const result = await service.updateCategory(1, {
        name: 'Naturaleza Actualizada',
      });

      expect(result.name).toBe('Naturaleza Actualizada');
    });

    it('should throw NotFoundException when category does not exist', async () => {
      mockPrismaService.achievement_categories.findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.updateCategory(999, { name: 'X' }),
      ).rejects.toMatchObject({
        code: ErrorCode.ACHIEVEMENT_CATEGORY_NOT_FOUND,
      });
    });
  });

  describe('deleteCategory', () => {
    it('should soft-delete a category with no active achievements', async () => {
      const mockCategory = {
        achievement_category_id: 1,
        name: 'Naturaleza',
        active: true,
      };
      const softDeleted = { ...mockCategory, active: false };

      mockPrismaService.achievement_categories.findUnique.mockResolvedValue(
        mockCategory,
      );
      mockPrismaService.achievements.count.mockResolvedValue(0); // no active achievements
      mockPrismaService.achievement_categories.update.mockResolvedValue(
        softDeleted,
      );

      const result = await service.deleteCategory(1);

      expect(result.active).toBe(false);
    });

    it('should throw ConflictException when category has active achievements', async () => {
      const mockCategory = {
        achievement_category_id: 1,
        name: 'Naturaleza',
        active: true,
      };

      mockPrismaService.achievement_categories.findUnique.mockResolvedValue(
        mockCategory,
      );
      mockPrismaService.achievements.count.mockResolvedValue(3); // 3 active achievements

      await expect(service.deleteCategory(1)).rejects.toMatchObject({
        code: ErrorCode.ACHIEVEMENT_CATEGORY_HAS_ACTIVE,
      });
    });

    it('should throw NotFoundException when category to delete does not exist', async () => {
      mockPrismaService.achievement_categories.findUnique.mockResolvedValue(
        null,
      );

      await expect(service.deleteCategory(999)).rejects.toMatchObject({
        code: ErrorCode.ACHIEVEMENT_CATEGORY_NOT_FOUND,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Achievement CRUD
  // ---------------------------------------------------------------------------

  describe('createAchievement', () => {
    const createDto: any = {
      name: 'Primer Logro',
      description: 'Descripción',
      category_id: 1,
      type: 'THRESHOLD',
      scope: 'CLUB',
      tier: 'BRONZE',
      points: 50,
      criteria: { event: 'attendance.marked', operator: 'gte', target: 5 },
      secret: false,
      repeatable: false,
      active: true,
    };

    it('should create an achievement after validating category and criteria', async () => {
      const mockCategory = {
        achievement_category_id: 1,
        name: 'Naturaleza',
        active: true,
      };
      const mockCreated = {
        achievement_id: 1,
        ...createDto,
        category: mockCategory,
      };

      mockPrismaService.achievement_categories.findUnique.mockResolvedValue(
        mockCategory,
      );
      mockAchievementsService.validateCriteria.mockReturnValue({ valid: true });
      mockPrismaService.achievements.create.mockResolvedValue(mockCreated);

      const result = await service.createAchievement(createDto);

      // Result is mockCreated enriched with badge_image_url.
      // mockCreated has no badge_image_key → default URL applied.
      expect(result).toMatchObject(mockCreated);
      expect(result.badge_image_url).toBe(ACHIEVEMENT_DEFAULT_BADGE_URL);
      expect(mockAchievementsService.validateCriteria).toHaveBeenCalledWith(
        'THRESHOLD',
        createDto.criteria,
      );
    });

    it('should throw NotFoundException when category does not exist', async () => {
      mockPrismaService.achievement_categories.findUnique.mockResolvedValue(
        null,
      );

      await expect(service.createAchievement(createDto)).rejects.toMatchObject({
        code: ErrorCode.ACHIEVEMENT_CATEGORY_NOT_FOUND,
      });
    });
  });

  describe('updateAchievement', () => {
    it('should update an existing achievement', async () => {
      const mockAchievement = {
        achievement_id: 1,
        name: 'Old Name',
        active: true,
        type: 'THRESHOLD',
        tier: 'BRONZE',
        criteria: {},
        category: { achievement_category_id: 1 },
      };
      const updated = { ...mockAchievement, name: 'New Name' };

      mockAchievementsService.getAchievementDetail.mockResolvedValue({
        achievement: mockAchievement,
      });
      mockPrismaService.achievements.update.mockResolvedValue(updated);

      const result = await service.updateAchievement(1, { name: 'New Name' });

      expect(result.name).toBe('New Name');
    });

    it('should throw NotFoundException when achievement does not exist', async () => {
      mockAchievementsService.getAchievementDetail.mockResolvedValue(null);

      await expect(
        service.updateAchievement(999, { name: 'X' }),
      ).rejects.toMatchObject({
        code: ErrorCode.ACHIEVEMENT_NOT_FOUND,
      });
    });

    it('should re-validate criteria when both type and criteria are provided in update', async () => {
      const mockAchievement = {
        achievement_id: 1,
        name: 'Test',
        active: true,
        type: 'THRESHOLD',
        tier: 'BRONZE',
        criteria: {},
        category: { achievement_category_id: 1 },
      };
      const updated = { ...mockAchievement, type: 'COLLECTION' };

      mockAchievementsService.getAchievementDetail.mockResolvedValue({
        achievement: mockAchievement,
      });
      mockAchievementsService.validateCriteria.mockReturnValue({ valid: true });
      mockPrismaService.achievements.update.mockResolvedValue(updated);

      await service.updateAchievement(1, {
        type: 'COLLECTION' as any,
        criteria: {
          event: 'honor.earned',
          operator: 'distinct_count',
          distinct_field: 'honor_id',
          target: 10,
        },
      });

      expect(mockAchievementsService.validateCriteria).toHaveBeenCalled();
    });
  });

  describe('deleteAchievement', () => {
    it('should soft-delete an achievement by setting active=false', async () => {
      const mockAchievement = {
        achievement_id: 1,
        name: 'Test',
        active: true,
        tier: 'BRONZE',
        category: { achievement_category_id: 1 },
      };
      const softDeleted = { ...mockAchievement, active: false };

      mockAchievementsService.getAchievementDetail.mockResolvedValue({
        achievement: mockAchievement,
      });
      mockPrismaService.achievements.update.mockResolvedValue(softDeleted);

      const result = await service.deleteAchievement(1);

      expect(result.active).toBe(false);
      expect(mockPrismaService.achievements.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { achievement_id: 1 },
          data: expect.objectContaining({ active: false }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Circular prerequisite detection
  // ---------------------------------------------------------------------------

  describe('circular prerequisite detection', () => {
    it('should throw BadRequestException for a direct circular dependency A→B→A', async () => {
      // Achievement A (id=1) tries to set prerequisite to B (id=2)
      // B already has prerequisite = A (id=1) → circular
      const achievementA = {
        achievement_id: 1,
        name: 'A',
        active: true,
        tier: 'BRONZE',
        category: { achievement_category_id: 1 },
      };
      const achievementB = {
        achievement_id: 2,
        active: true,
        prerequisite_id: 1,
      }; // B → A

      mockAchievementsService.getAchievementDetail.mockResolvedValue({
        achievement: achievementA,
      });
      mockAchievementsService.validateCriteria.mockReturnValue({ valid: true });

      // First findUnique: check if B (prerequisite) exists
      // Second findUnique: walk B's prerequisite_id (which is 1 = currentId A) → circular detected
      mockPrismaService.achievements.findUnique
        .mockResolvedValueOnce(achievementB) // B exists and is active
        .mockResolvedValueOnce({ prerequisite_id: 1 }); // B's prerequisite chain reaches A

      await expect(
        service.updateAchievement(1, { prerequisite_id: 2 }),
      ).rejects.toMatchObject({
        code: ErrorCode.ACHIEVEMENT_CIRCULAR_PREREQUISITE,
      });
    });

    it('should allow setting a valid (non-circular) prerequisite', async () => {
      const achievementA = {
        achievement_id: 1,
        name: 'A',
        active: true,
        tier: 'BRONZE',
        criteria: {},
        category: { achievement_category_id: 1 },
      };
      const achievementB = {
        achievement_id: 2,
        active: true,
        prerequisite_id: null,
      }; // B has no prerequisites
      const updatedA = { ...achievementA, prerequisite_id: 2 };

      mockAchievementsService.getAchievementDetail.mockResolvedValue({
        achievement: achievementA,
      });
      mockPrismaService.achievements.findUnique.mockResolvedValue(achievementB); // B exists, no chain
      mockPrismaService.achievements.update.mockResolvedValue(updatedA);

      const result = await service.updateAchievement(1, { prerequisite_id: 2 });

      expect(result.prerequisite_id).toBe(2);
    });

    it('should throw NotFoundException when prerequisite achievement does not exist', async () => {
      const achievementA = {
        achievement_id: 1,
        name: 'A',
        active: true,
        tier: 'BRONZE',
        criteria: {},
        category: { achievement_category_id: 1 },
      };

      mockAchievementsService.getAchievementDetail.mockResolvedValue({
        achievement: achievementA,
      });
      mockPrismaService.achievements.findUnique.mockResolvedValue(null); // prerequisite not found

      await expect(
        service.updateAchievement(1, { prerequisite_id: 999 }),
      ).rejects.toMatchObject({
        code: ErrorCode.ACHIEVEMENT_PREREQUISITE_NOT_FOUND,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Badge image upload
  // ---------------------------------------------------------------------------

  describe('uploadBadgeImage', () => {
    it('should upload a PNG badge and persist the key in the achievement', async () => {
      const mockAchievement = {
        achievement_id: 1,
        name: 'Test Achievement',
        tier: 'BRONZE',
        active: true,
        category: { achievement_category_id: 1 },
      };

      mockAchievementsService.getAchievementDetail.mockResolvedValue({
        achievement: mockAchievement,
      });
      mockFileStorageService.upload.mockResolvedValue({
        key: 'achievements/badges/1_bronze.png',
        url: 'https://cdn.r2.example/achievements/badges/1_bronze.png',
      });
      mockPrismaService.achievements.update.mockResolvedValue({
        ...mockAchievement,
        badge_image_key: 'achievements/badges/1_bronze.png',
      });

      const pngFile: Express.Multer.File = {
        originalname: 'badge.png',
        mimetype: 'image/png',
        size: 512 * 1024, // 512 KB
        buffer: Buffer.from('png-data'),
      } as Express.Multer.File;

      const result = await service.uploadBadgeImage(1, pngFile);

      expect(result.badge_image_key).toBe('achievements/badges/1_bronze.png');
      expect(mockFileStorageService.upload).toHaveBeenCalledWith(
        StorageBucketAlias.ACHIEVEMENTS_BADGES,
        'achievements/badges/1_bronze.png',
        pngFile.buffer,
        expect.objectContaining({ contentType: 'image/png' }),
      );
      expect(mockPrismaService.achievements.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { achievement_id: 1 },
          data: expect.objectContaining({
            badge_image_key: 'achievements/badges/1_bronze.png',
          }),
        }),
      );
    });

    it('should throw BadRequestException for an unsupported MIME type', async () => {
      const mockAchievement = {
        achievement_id: 1,
        name: 'Test',
        tier: 'BRONZE',
        active: true,
        category: { achievement_category_id: 1 },
      };
      mockAchievementsService.getAchievementDetail.mockResolvedValue({
        achievement: mockAchievement,
      });

      const jpgFile: Express.Multer.File = {
        originalname: 'badge.jpg',
        mimetype: 'image/jpeg', // not allowed
        size: 100 * 1024,
        buffer: Buffer.from('jpg-data'),
      } as Express.Multer.File;

      await expect(service.uploadBadgeImage(1, jpgFile)).rejects.toMatchObject({
        code: ErrorCode.ACHIEVEMENT_BADGE_INVALID_TYPE,
      });
    });

    it('should throw BadRequestException when file size exceeds 2 MB', async () => {
      const mockAchievement = {
        achievement_id: 1,
        name: 'Test',
        tier: 'BRONZE',
        active: true,
        category: { achievement_category_id: 1 },
      };
      mockAchievementsService.getAchievementDetail.mockResolvedValue({
        achievement: mockAchievement,
      });

      const oversizedFile: Express.Multer.File = {
        originalname: 'big.png',
        mimetype: 'image/png',
        size: 3 * 1024 * 1024, // 3 MB — exceeds the 2 MB limit
        buffer: Buffer.from('big-data'),
      } as Express.Multer.File;

      await expect(
        service.uploadBadgeImage(1, oversizedFile),
      ).rejects.toMatchObject({
        code: ErrorCode.ACHIEVEMENT_BADGE_TOO_LARGE,
      });
    });

    it('should reject SVG badge uploads because badges are served publicly', async () => {
      const mockAchievement = {
        achievement_id: 2,
        name: 'SVG Test',
        tier: 'GOLD',
        active: true,
        category: { achievement_category_id: 1 },
      };
      mockAchievementsService.getAchievementDetail.mockResolvedValue({
        achievement: mockAchievement,
      });

      const svgFile: Express.Multer.File = {
        originalname: 'badge.svg',
        mimetype: 'image/svg+xml',
        size: 50 * 1024,
        buffer: Buffer.from('<svg/>'),
      } as Express.Multer.File;

      await expect(service.uploadBadgeImage(2, svgFile)).rejects.toMatchObject({
        code: ErrorCode.ACHIEVEMENT_BADGE_INVALID_TYPE,
      });

      expect(mockFileStorageService.upload).not.toHaveBeenCalled();
      expect(mockPrismaService.achievements.update).not.toHaveBeenCalled();
    });
  });
});

import { ErrorCode } from '../common/errors/error-codes';
import { ScoringCategoriesService } from './scoring-categories.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { TranslationService } from '../common/services/translation.service';
import { InstitutionalHierarchyService } from '../common/services/institutional-hierarchy.service';

describe('ScoringCategoriesService', () => {
  const mockTx = {
    scoring_categories: {
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockPrisma = {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (callback: (tx: typeof mockTx) => unknown) =>
      callback(mockTx),
    ),
    scoring_categories: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    system_config: {
      findUnique: jest.fn(),
    },
    local_fields: {
      findUnique: jest.fn(),
    },
    club_role_assignments: {
      findFirst: jest.fn(),
    },
  };

  const mockAuthContext = {
    isSuperAdmin: jest.fn(),
  };

  const mockTranslationService = {
    getCurrentLocale: jest.fn().mockReturnValue('es'),
    validateTranslations: jest.fn(),
    translateMany: jest
      .fn()
      .mockImplementation((records: unknown[]) => records),
    upsertTranslations: jest.fn(),
  };

  const mockHierarchy = {
    resolveCurrent: jest.fn(),
  };

  const service = new ScoringCategoriesService(
    mockPrisma as unknown as PrismaService,
    mockAuthContext as unknown as AuthorizationContextService,
    mockTranslationService as unknown as TranslationService,
    mockHierarchy as unknown as InstitutionalHierarchyService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: not a super-admin so existing territory checks run normally.
    mockAuthContext.isSuperAdmin.mockResolvedValue(false);
    mockPrisma.$queryRaw.mockResolvedValue([{ division_id: 1 }]);
    mockHierarchy.resolveCurrent.mockImplementation(
      ({
        unionId,
        localFieldId,
      }: {
        unionId?: number;
        localFieldId?: number;
      }) =>
        Promise.resolve({
          division_id: 1,
          union_id: unionId ?? 7,
          local_field_id: localFieldId ?? null,
          as_of: new Date('2026-01-01'),
          source: 'current',
          precision: 'exact',
        }),
    );
  });

  describe('division categories', () => {
    it('reads categories from the real DIA division instead of sentinel origin_id=0', async () => {
      const categories = [
        {
          scoring_category_id: 1,
          name: 'Asistencia',
          max_points: 100,
          origin_level: 'DIVISION',
          origin_id: 1,
          active: true,
          created_at: new Date('2026-04-15T00:00:00.000Z'),
          modified_at: new Date('2026-04-15T00:00:00.000Z'),
        },
      ];

      mockPrisma.$queryRaw.mockResolvedValue([{ division_id: 1 }]);
      mockPrisma.scoring_categories.findMany.mockResolvedValue(categories);

      await expect(service.findDivisionCategories()).resolves.toEqual(
        categories.map((category) => ({
          ...category,
          readonly: false,
          origin_badge: 'Division',
        })),
      );

      expect(mockPrisma.scoring_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { origin_level: 'DIVISION', origin_id: 1 },
        }),
      );
    });

    it('creates division categories with DIA division_id and never origin_id=0', async () => {
      const created = {
        scoring_category_id: 10,
        name: 'Puntualidad',
        max_points: 100,
        origin_level: 'DIVISION',
        origin_id: 1,
        active: true,
      };

      mockPrisma.$queryRaw.mockResolvedValue([{ division_id: 1 }]);
      mockPrisma.system_config.findUnique.mockResolvedValue({
        config_value: '100',
      });
      mockTx.scoring_categories.create.mockResolvedValue(created);

      await expect(
        service.createDivisionCategory({
          name: 'Puntualidad',
          max_points: 100,
        }),
      ).resolves.toEqual(created);

      expect(mockTx.scoring_categories.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          origin_level: 'DIVISION',
          origin_id: 1,
          scoring_mode: 'numeric',
        }),
      });
      expect(mockTx.scoring_categories.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ origin_id: 0 }),
        }),
      );
    });

    it('creates division categories with explicit boolean_full scoring mode', async () => {
      const created = {
        scoring_category_id: 11,
        name: 'Trajo Biblia',
        max_points: 10,
        scoring_mode: 'boolean_full',
        origin_level: 'DIVISION',
        origin_id: 1,
        active: true,
      };

      mockPrisma.$queryRaw.mockResolvedValue([{ division_id: 1 }]);
      mockPrisma.system_config.findUnique.mockResolvedValue({
        config_value: '20',
      });
      mockTx.scoring_categories.create.mockResolvedValue(created);

      await expect(
        service.createDivisionCategory({
          name: 'Trajo Biblia',
          max_points: 10,
          scoring_mode: 'boolean_full',
        }),
      ).resolves.toEqual(created);

      expect(mockTx.scoring_categories.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          scoring_mode: 'boolean_full',
        }),
      });
    });
  });

  describe('category max points cap', () => {
    it('rejects create when max_points exceeds configured cap', async () => {
      mockPrisma.system_config.findUnique.mockResolvedValue({
        config_value: '15',
      });

      await expect(
        service.createDivisionCategory({
          name: 'Exceso',
          max_points: 16,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.SCORING_CATEGORY_MAX_POINTS_EXCEEDS_CAP,
      });

      expect(mockTx.scoring_categories.create).not.toHaveBeenCalled();
    });

    it('falls back to default cap=20 when config is missing', async () => {
      mockPrisma.system_config.findUnique.mockResolvedValue(null);

      await expect(
        service.createDivisionCategory({
          name: 'Exceso',
          max_points: 21,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.SCORING_CATEGORY_MAX_POINTS_EXCEEDS_CAP,
      });

      expect(mockTx.scoring_categories.create).not.toHaveBeenCalled();
    });

    it('falls back to default cap=20 when config is invalid', async () => {
      mockPrisma.system_config.findUnique.mockResolvedValue({
        config_value: 'NaN',
      });

      await expect(
        service.createDivisionCategory({
          name: 'Exceso',
          max_points: 21,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.SCORING_CATEGORY_MAX_POINTS_EXCEEDS_CAP,
      });

      expect(mockTx.scoring_categories.create).not.toHaveBeenCalled();
    });

    it('treats non-integer numeric-like config values as invalid and falls back to 20', async () => {
      const warnSpy = jest.spyOn((service as any).logger, 'warn');

      for (const rawValue of ['20abc', '20.5']) {
        mockPrisma.system_config.findUnique.mockResolvedValue({
          config_value: rawValue,
        });

        await expect(
          service.createDivisionCategory({
            name: `Exceso-${rawValue}`,
            max_points: 21,
          }),
        ).rejects.toMatchObject({
          code: ErrorCode.SCORING_CATEGORY_MAX_POINTS_EXCEEDS_CAP,
        });
      }

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'system_config[scoring.category_max_points_cap] invalid',
        ),
      );
      expect(mockTx.scoring_categories.create).not.toHaveBeenCalled();
    });

    it('rejects update when max_points exceeds cap', async () => {
      mockAuthContext.isSuperAdmin.mockResolvedValue(true);
      mockPrisma.system_config.findUnique.mockResolvedValue({
        config_value: '20',
      });
      mockPrisma.scoring_categories.findUnique.mockResolvedValue({
        scoring_category_id: 99,
        origin_level: 'UNION',
        origin_id: 20,
      });

      await expect(
        service.updateUnionCategory(
          20,
          99,
          { max_points: 30 },
          'super-admin-user',
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.SCORING_CATEGORY_MAX_POINTS_EXCEEDS_CAP,
      });

      expect(mockTx.scoring_categories.update).not.toHaveBeenCalled();
    });
  });

  describe('findUnionCategories', () => {
    it('rejects a caller whose active assignment belongs to another union', async () => {
      mockPrisma.club_role_assignments.findFirst.mockResolvedValue(null);
      mockPrisma.scoring_categories.findMany.mockResolvedValue([]);

      await expect(
        service.findUnionCategories(20, 'user-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.SCORING_CATEGORY_UNION_FORBIDDEN,
      });
    });

    it('returns categories when the caller belongs to the requested union', async () => {
      const categories = [
        {
          scoring_category_id: 1,
          name: 'Uniforme',
          max_points: 10,
          origin_level: 'UNION',
          origin_id: 20,
          active: true,
          created_at: new Date('2026-04-15T00:00:00.000Z'),
          modified_at: new Date('2026-04-15T00:00:00.000Z'),
        },
      ];

      mockPrisma.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'assignment-1',
      });
      mockPrisma.$queryRaw.mockResolvedValue([{ division_id: 1 }]);
      mockPrisma.scoring_categories.findMany.mockResolvedValue(categories);

      await expect(service.findUnionCategories(20, 'user-1')).resolves.toEqual(
        categories.map((category) => ({
          ...category,
          readonly: false,
          origin_badge: 'Union',
        })),
      );

      expect(mockPrisma.club_role_assignments.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id: 'user-1',
            active: true,
            status: 'active',
            club_sections: {
              clubs: {
                local_fields: {
                  union_id: 20,
                },
              },
            },
          }),
          select: { assignment_id: true },
        }),
      );
      expect(mockPrisma.scoring_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { origin_level: 'DIVISION', origin_id: 1 },
              { origin_level: 'UNION', origin_id: 20 },
            ],
          },
        }),
      );
      expect(mockHierarchy.resolveCurrent).toHaveBeenCalledWith({
        unionId: 20,
      });
    });
  });

  describe('findLocalFieldCategories', () => {
    it('rejects a caller whose active assignment belongs to another local field', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          union_id: 7,
          division_id: 1,
        },
      ]);
      mockPrisma.club_role_assignments.findFirst.mockResolvedValue(null);
      mockPrisma.scoring_categories.findMany.mockResolvedValue([]);

      await expect(
        service.findLocalFieldCategories(99, 'user-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.SCORING_CATEGORY_LOCAL_FIELD_FORBIDDEN,
      });
    });

    it('returns categories when the caller belongs to the requested local field', async () => {
      const categories = [
        {
          scoring_category_id: 2,
          name: 'Silencio',
          max_points: 5,
          origin_level: 'LOCAL_FIELD',
          origin_id: 99,
          active: true,
          created_at: new Date('2026-04-15T00:00:00.000Z'),
          modified_at: new Date('2026-04-15T00:00:00.000Z'),
        },
      ];

      mockPrisma.$queryRaw.mockResolvedValue([
        {
          union_id: 7,
          division_id: 1,
        },
      ]);
      mockPrisma.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'assignment-2',
      });
      mockPrisma.scoring_categories.findMany.mockResolvedValue(categories);

      await expect(
        service.findLocalFieldCategories(99, 'user-1'),
      ).resolves.toEqual(
        categories.map((category) => ({
          ...category,
          readonly: false,
          origin_badge: 'Campo Local',
        })),
      );

      expect(mockPrisma.club_role_assignments.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id: 'user-1',
            active: true,
            status: 'active',
            club_sections: {
              clubs: {
                local_field_id: 99,
              },
            },
          }),
          select: { assignment_id: true },
        }),
      );
      expect(mockPrisma.scoring_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { origin_level: 'DIVISION', origin_id: 1 },
              { origin_level: 'UNION', origin_id: 7 },
              { origin_level: 'LOCAL_FIELD', origin_id: 99 },
            ],
          },
        }),
      );
      expect(mockHierarchy.resolveCurrent).toHaveBeenCalledWith({
        localFieldId: 99,
      });
    });
  });

  describe('super-admin bypass (H-02)', () => {
    it('allows super-admin to read union categories without a club_role_assignment', async () => {
      mockAuthContext.isSuperAdmin.mockResolvedValue(true);
      mockPrisma.$queryRaw.mockResolvedValue([{ division_id: 1 }]);
      mockPrisma.scoring_categories.findMany.mockResolvedValue([]);

      await expect(service.findUnionCategories(20, 'super-1')).resolves.toEqual(
        [],
      );
      // club_role_assignments must NOT be queried — super-admin exits early
      expect(mockPrisma.club_role_assignments.findFirst).not.toHaveBeenCalled();
    });

    it('allows super-admin to read local field categories without a club_role_assignment', async () => {
      mockAuthContext.isSuperAdmin.mockResolvedValue(true);
      mockPrisma.$queryRaw.mockResolvedValue([{ union_id: 7, division_id: 1 }]);
      mockPrisma.scoring_categories.findMany.mockResolvedValue([]);

      await expect(
        service.findLocalFieldCategories(99, 'super-1'),
      ).resolves.toEqual([]);
      expect(mockPrisma.club_role_assignments.findFirst).not.toHaveBeenCalled();
    });
  });
});

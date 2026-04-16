import { ForbiddenException } from '@nestjs/common';
import { ScoringCategoriesService } from './scoring-categories.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ScoringCategoriesService', () => {
  const mockPrisma = {
    scoring_categories: {
      findMany: jest.fn(),
    },
    local_fields: {
      findUnique: jest.fn(),
    },
    club_role_assignments: {
      findFirst: jest.fn(),
    },
  };

  const service = new ScoringCategoriesService(
    mockPrisma as unknown as PrismaService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findUnionCategories', () => {
    it('rejects a caller whose active assignment belongs to another union', async () => {
      mockPrisma.club_role_assignments.findFirst.mockResolvedValue(null);
      mockPrisma.scoring_categories.findMany.mockResolvedValue([]);

      await expect(service.findUnionCategories(20, 'user-1')).rejects.toThrow(
        new ForbiddenException(
          'No tiene permisos para gestionar categorías de esta unión',
        ),
      );
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
    });
  });

  describe('findLocalFieldCategories', () => {
    it('rejects a caller whose active assignment belongs to another local field', async () => {
      mockPrisma.local_fields.findUnique.mockResolvedValue({
        union_id: 7,
      });
      mockPrisma.club_role_assignments.findFirst.mockResolvedValue(null);
      mockPrisma.scoring_categories.findMany.mockResolvedValue([]);

      await expect(service.findLocalFieldCategories(99, 'user-1')).rejects.toThrow(
        new ForbiddenException(
          'No tiene permisos para gestionar categorías de este campo local',
        ),
      );
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

      mockPrisma.local_fields.findUnique.mockResolvedValue({
        union_id: 7,
      });
      mockPrisma.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'assignment-2',
      });
      mockPrisma.scoring_categories.findMany.mockResolvedValue(categories);

      await expect(service.findLocalFieldCategories(99, 'user-1')).resolves.toEqual(
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
    });
  });
});

import { Prisma } from '@prisma/client';
import {
  FinanceAggregationService,
  financePeriodKey,
} from './finance-aggregation.service';
import { ErrorCode } from '../common/errors/error-codes';

describe('FinanceAggregationService', () => {
  const mockPrisma = {
    $queryRaw: jest.fn(),
    clubs: { findUnique: jest.fn() },
    club_sections: { findMany: jest.fn() },
  };
  let service: FinanceAggregationService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new FinanceAggregationService(mockPrisma as any);
  });

  const sqlOf = (call: unknown[]) =>
    Array.from(call[0] as TemplateStringsArray).join(' ');
  const valuesOf = (call: unknown[]) => call.slice(1);

  describe('aggregate', () => {
    it('returns zeros without touching the database when there are no sections', async () => {
      await expect(service.aggregate([])).resolves.toEqual({
        income: 0,
        expenses: 0,
        net: 0,
        movements: 0,
        balance: 0,
      });
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('maps bigint rows to numbers and computes net', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { income: 1500n, expenses: 300n, movements: 3n, balance: 5200n },
      ]);

      await expect(service.aggregate([1, 2])).resolves.toEqual({
        income: 1500,
        expenses: 300,
        net: 1200,
        movements: 3,
        balance: 5200,
      });
    });

    it('treats a null row as all zeros', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { income: null, expenses: null, movements: null, balance: null },
      ]);

      await expect(service.aggregate([1])).resolves.toMatchObject({
        income: 0,
        expenses: 0,
        net: 0,
        balance: 0,
      });
    });

    it('reads live active movements only and never the closing snapshots', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{}]);

      await service.aggregate([1]);

      const sql = sqlOf(mockPrisma.$queryRaw.mock.calls[0]);
      expect(sql).toContain('FROM finances f');
      expect(sql).toContain('f.active = true');
      expect(sql).not.toContain('finance_period_closings');
    });

    it('is all-time with no range: from 0 and no upper bound', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{}]);

      await service.aggregate([1]);

      const values = valuesOf(mockPrisma.$queryRaw.mock.calls[0]);
      expect(values).toContain(0);
      expect(values).toContain(999999);
    });

    it('bounds the period with from/to and the balance with the end of the range', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{}]);

      await service.aggregate([1], {
        from: { year: 2026, month: 1 },
        to: { year: 2026, month: 3 },
      });

      const values = valuesOf(mockPrisma.$queryRaw.mock.calls[0]);
      expect(values).toContain(202601);
      expect(values).toContain(202603);
    });

    it('passes the section ids as a Prisma list (club scope = all sections, section scope = one)', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{}]);

      await service.aggregate([10, 11]);
      await service.aggregate([10]);

      const lists = mockPrisma.$queryRaw.mock.calls.map((call) =>
        valuesOf(call).find(
          (v) => typeof v === 'object' && v !== null && 'values' in v,
        ),
      ) as Prisma.Sql[];
      expect(lists[0].values).toEqual([10, 11]);
      expect(lists[1].values).toEqual([10]);
    });

    it('aggregateMonth is the same range for from and to', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{}]);

      await service.aggregateMonth([1], 2026, 4);

      const values = valuesOf(mockPrisma.$queryRaw.mock.calls[0]);
      expect(values.filter((v) => v === 202604)).toHaveLength(4);
    });
  });

  describe('financePeriodKey', () => {
    it('orders periods as plain integers', () => {
      expect(financePeriodKey({ year: 2025, month: 12 })).toBeLessThan(
        financePeriodKey({ year: 2026, month: 1 }),
      );
    });
  });

  describe('aggregateByCategory', () => {
    it('returns rows mapped to numbers, in the SQL order', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { category_id: 3, name: 'Cuotas', type: 0, total: 900n, count: 2n },
        { category_id: 8, name: 'Material', type: 1, total: 100n, count: 1n },
      ]);

      await expect(
        service.aggregateByCategory([1], {
          from: { year: 2026, month: 1 },
          to: { year: 2026, month: 12 },
        }),
      ).resolves.toEqual([
        { category_id: 3, name: 'Cuotas', type: 0, total: 900, count: 2 },
        { category_id: 8, name: 'Material', type: 1, total: 100, count: 1 },
      ]);
      const sql = sqlOf(mockPrisma.$queryRaw.mock.calls[0]);
      expect(sql).toContain('f.active = true');
      expect(sql).toContain('ORDER BY SUM(f.amount) DESC');
    });

    it('skips the query without sections', async () => {
      await expect(service.aggregateByCategory([])).resolves.toEqual([]);
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('aggregateByClub', () => {
    it('groups by club and keeps the last movement date', async () => {
      const last = new Date('2026-04-20T10:00:00Z');
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          club_id: 5,
          income: 100n,
          expenses: 40n,
          movements: 2n,
          balance: 600n,
          last_movement_at: last,
        },
      ]);

      const result = await service.aggregateByClub([5, 6]);

      expect(result.get(5)).toEqual({
        club_id: 5,
        income: 100,
        expenses: 40,
        net: 60,
        movements: 2,
        balance: 600,
        last_movement_at: last,
      });
      expect(result.has(6)).toBe(false);
    });

    it('skips the query without clubs', async () => {
      expect((await service.aggregateByClub([])).size).toBe(0);
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('resolveClubScope', () => {
    const club = {
      club_id: 1,
      name: 'ACV',
      club_sections: [
        { club_section_id: 10, club_types: { name: 'Aventureros' } },
        { club_section_id: 11, club_types: { name: 'Conquistadores' } },
      ],
    };

    it('club scope: every section of the club', async () => {
      mockPrisma.clubs.findUnique.mockResolvedValue(club);

      const scope = await service.resolveClubScope(1);

      expect(scope.sectionIds).toEqual([10, 11]);
      expect(scope.club).toEqual({ club_id: 1, name: 'ACV' });
    });

    it('section scope: only the requested section', async () => {
      mockPrisma.clubs.findUnique.mockResolvedValue(club);

      const scope = await service.resolveClubScope(1, 11);

      expect(scope.sectionIds).toEqual([11]);
      expect(scope.sections).toEqual([
        { club_section_id: 11, name: 'Conquistadores' },
      ]);
    });

    it('404 when the requested section is not in the club', async () => {
      mockPrisma.clubs.findUnique.mockResolvedValue(club);

      await expect(service.resolveClubScope(1, 99)).rejects.toMatchObject({
        code: ErrorCode.CLUB_SECTION_NOT_FOUND,
      });
    });

    it('404 when the club does not exist', async () => {
      mockPrisma.clubs.findUnique.mockResolvedValue(null);

      await expect(service.resolveClubScope(9)).rejects.toMatchObject({
        code: ErrorCode.FINANCE_CLUB_NOT_FOUND,
      });
    });

    it('a section-scoped member always gets their own section', async () => {
      mockPrisma.clubs.findUnique.mockResolvedValue(club);

      const scope = await service.resolveClubScope(1, null, 10);

      expect(scope.sectionIds).toEqual([10]);
    });

    it('403 when a section-scoped member asks for another section', async () => {
      mockPrisma.clubs.findUnique.mockResolvedValue(club);

      await expect(service.resolveClubScope(1, 11, 10)).rejects.toMatchObject({
        code: ErrorCode.GUARD_PERMISSION_DENIED,
      });
    });
  });
});

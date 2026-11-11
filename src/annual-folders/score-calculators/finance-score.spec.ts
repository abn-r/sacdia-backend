import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceScoreService } from './finance-score';

/**
 * The movement/closing rule lives in SQL, so the row-level cases below are
 * covered in two ways: (1) the rows the DB would return for each scenario are
 * mocked and aggregated, and (2) the SQL text is asserted to contain each
 * predicate that implements the scenario.
 */
describe('FinanceScoreService', () => {
  let svc: FinanceScoreService;
  let prisma: { $queryRaw: jest.Mock };

  const rows = (months: Record<number, boolean>) =>
    Object.entries(months).map(([m, has]) => ({
      month: Number(m),
      has_movement: has,
    }));

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        FinanceScoreService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = moduleRef.get(FinanceScoreService);
  });

  describe('calc', () => {
    it('counts a month closed with an on-time movement', async () => {
      prisma.$queryRaw.mockResolvedValueOnce(rows({ 3: true }));
      expect(await svc.calc(42, 2026)).toBe(8.33);
    });

    it('does not count a closed month with no movements', async () => {
      prisma.$queryRaw.mockResolvedValueOnce(rows({ 3: false, 4: false }));
      expect(await svc.calc(42, 2026)).toBe(0);
    });

    it('does not count an unclosed month (no closing row)', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      expect(await svc.calc(42, 2026)).toBe(0);
    });

    it('returns 100 when all 12 months are closed with movements', async () => {
      const all = Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [i + 1, true]),
      );
      prisma.$queryRaw.mockResolvedValueOnce(rows(all));
      expect(await svc.calc(42, 2026)).toBe(100);
    });

    it('returns 50 when 6 months have movements and 2 do not', async () => {
      prisma.$queryRaw.mockResolvedValueOnce(
        rows({
          1: true,
          2: true,
          3: true,
          4: true,
          5: true,
          6: true,
          7: false,
          8: false,
        }),
      );
      expect(await svc.calc(42, 2026)).toBe(50);
    });

    it('caps at 100 and ignores out-of-range or duplicated months (defensive)', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        ...rows({ 1: true, 2: true, 3: true, 4: true, 5: true, 6: true }),
        ...rows({ 7: true, 8: true, 9: true, 10: true, 11: true, 12: true }),
        { month: 12, has_movement: true },
        { month: 13, has_movement: true },
      ]);
      expect(await svc.calc(42, 2026)).toBe(100);
    });

    it('does not read system_config (deadline day no longer used)', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      await expect(svc.calc(42, 2026)).resolves.toBe(0);
      expect(prisma).not.toHaveProperty('system_config');
    });
  });

  describe('getMonthsStatus', () => {
    it('splits closed months into with-movements and missed', async () => {
      prisma.$queryRaw.mockResolvedValueOnce(
        rows({ 5: false, 1: true, 3: true, 2: false }),
      );
      const result = await svc.getMonthsStatus(42, 2026);
      expect(result).toEqual({
        monthsWithMovements: [1, 3],
        missedMonths: [2, 5],
      });
    });

    it('passes club id and year as bound parameters', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      await svc.getMonthsStatus(42, 2026);
      const [, ...values] = prisma.$queryRaw.mock.calls[0];
      expect(values).toEqual([42, 2026]);
    });

    describe('SQL predicates', () => {
      let sql: string;
      beforeEach(async () => {
        prisma.$queryRaw.mockResolvedValueOnce([]);
        await svc.getMonthsStatus(42, 2026);
        sql = (prisma.$queryRaw.mock.calls[0][0] as string[])
          .join('?')
          .replace(/\s+/g, ' ');
      });

      it('requires the month to be closed (closed_at not null)', () => {
        expect(sql).toContain('c.closed_at IS NOT NULL');
      });

      it('ignores movements created after the closing', () => {
        expect(sql).toContain('f.created_at <= c.closed_at');
      });

      it('ignores inactive movements', () => {
        expect(sql).toContain('f.active = true');
      });

      it('only counts movements from sections of the club', () => {
        expect(sql).toContain('cs.main_club_id = c.club_id');
        expect(sql).toContain('cs.club_section_id = f.club_section_id');
      });

      it('matches the movement year and month to the closing', () => {
        expect(sql).toContain('f.year = c.year');
        expect(sql).toContain('f.month = c.month');
      });
    });
  });
});

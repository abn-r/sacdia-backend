import { AnnualRankingTerritorySummaryService } from './annual-ranking-territory-summary.service';
import { RankingTierCalculatorService } from './services/ranking-tier-calculator.service';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  actorProfile,
  TERRITORIAL_PERMISSIONS,
} from '../../common/testing/actor-scope.fixture';

const YEAR = { year_id: 7 };

const divisionActor = (id = 1) =>
  actorProfile({
    userId: 'd',
    globalRoles: [
      { roleName: 'assistant-dia', permissions: TERRITORIAL_PERMISSIONS },
    ],
    territory: { division: { id } },
  });
const unionActor = (id = 3) =>
  actorProfile({
    userId: 'u',
    globalRoles: [
      { roleName: 'director-union', permissions: TERRITORIAL_PERMISSIONS },
    ],
    territory: { union: { id }, division: { id: 1 } },
  });

const section = (clubId: number, lf: number) => ({
  clubs: { club_id: clubId, local_field_id: lf },
});

const tier = (slug: string, band: number, order: number) => ({
  name: slug,
  slug,
  band_percentage: band,
  sort_order: order,
});
// maxPoints 1000 -> diamante from 950, oro from 850, plata 700, bronce 500.
const TIERS = [
  tier('diamante', 5, 1),
  tier('oro', 10, 2),
  tier('plata', 15, 3),
  tier('bronce', 20, 4),
];

const snapshot = (
  clubId: number,
  lf: number,
  points: number,
  calculatedAt = '2026-11-26T02:00:00.000Z',
  maxPoints = 1000,
) => ({
  club_id: clubId,
  local_field_id: lf,
  current_points: points,
  max_points: maxPoints,
  calculated_at: new Date(calculatedAt),
});

const NO_PROGRESS = {
  gold_or_better_count: null,
  progress_calculated_at: null,
};

describe('AnnualRankingTerritorySummaryService', () => {
  let prisma: any;
  let service: AnnualRankingTerritorySummaryService;

  beforeEach(() => {
    prisma = {
      ecclesiastical_years: {
        findFirst: jest.fn().mockResolvedValue(YEAR),
        findUnique: jest.fn().mockResolvedValue(YEAR),
      },
      unions: {
        findMany: jest.fn().mockResolvedValue([
          { union_id: 3, name: 'Golfo' },
          { union_id: 4, name: 'Norte' },
        ]),
        findUnique: jest.fn().mockResolvedValue({ division_id: 1 }),
      },
      local_fields: {
        findMany: jest.fn().mockResolvedValue([
          { local_field_id: 31, name: 'LF A', union_id: 3 },
          { local_field_id: 32, name: 'LF B', union_id: 3 },
          { local_field_id: 41, name: 'LF C', union_id: 4 },
        ]),
      },
      annual_ranking_configs: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ union_id: null, local_field_id: 31 }]),
      },
      club_sections: {
        findMany: jest.fn().mockResolvedValue([
          // club 1 has two active sections: counted once
          section(1, 31),
          section(1, 31),
          section(2, 32),
          section(3, 41),
        ]),
      },
      annual_ranking_progress_snapshots: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ranking_tiers: {
        findMany: jest.fn().mockResolvedValue(TIERS),
      },
    };
    service = new AnnualRankingTerritorySummaryService(
      prisma,
      new RankingTierCalculatorService(),
    );
  });

  it('division: one row per union, distinct clubs counted once', async () => {
    const rows = await service.getSummary({ divisionId: 1 }, divisionActor());

    expect(rows).toEqual([
      {
        id: 3,
        name: 'Golfo',
        clubs_count: 2,
        configured: true,
        ...NO_PROGRESS,
      },
      {
        id: 4,
        name: 'Norte',
        clubs_count: 1,
        configured: false,
        ...NO_PROGRESS,
      },
    ]);
    expect(prisma.ecclesiastical_years.findFirst).toHaveBeenCalled();
    expect(prisma.club_sections.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.annual_ranking_configs.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.local_fields.findMany).toHaveBeenCalledTimes(1);
  });

  it('union: one row per local field', async () => {
    prisma.local_fields.findMany.mockResolvedValue([
      { local_field_id: 31, name: 'LF A', union_id: 3 },
      { local_field_id: 32, name: 'LF B', union_id: 3 },
    ]);

    const rows = await service.getSummary(
      { unionId: 3, yearId: 7 },
      unionActor(3),
    );

    expect(prisma.ecclesiastical_years.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { year_id: 7 } }),
    );
    expect(rows).toEqual([
      {
        id: 31,
        name: 'LF A',
        clubs_count: 1,
        configured: true,
        ...NO_PROGRESS,
      },
      {
        id: 32,
        name: 'LF B',
        clubs_count: 1,
        configured: false,
        ...NO_PROGRESS,
      },
    ]);
  });

  it('configured is false when no config exists', async () => {
    prisma.annual_ranking_configs.findMany.mockResolvedValue([]);

    const rows = await service.getSummary({ divisionId: 1 }, divisionActor());

    expect(rows.every((r) => !r.configured)).toBe(true);
    expect(rows[0].clubs_count).toBe(2);
  });

  it('a union-level config marks its local fields as configured', async () => {
    prisma.annual_ranking_configs.findMany.mockResolvedValue([
      { union_id: 4, local_field_id: null },
    ]);

    const rows = await service.getSummary({ divisionId: 1 }, divisionActor());

    expect(rows.find((r) => r.id === 4)?.configured).toBe(true);
    expect(rows.find((r) => r.id === 3)?.configured).toBe(false);
  });

  describe('gold_or_better_count', () => {
    beforeEach(() => {
      prisma.annual_ranking_progress_snapshots.findFirst.mockResolvedValue({
        club_enrollment_id: 'any',
      });
      prisma.annual_ranking_progress_snapshots.findMany.mockResolvedValue([
        // club 1: one gold section (900) and one low section -> counted once
        snapshot(1, 31, 900, '2026-11-26T02:10:00.000Z'),
        snapshot(1, 31, 100, '2026-11-26T02:10:00.000Z'),
        snapshot(1, 31, 960, '2026-11-26T02:10:00.000Z'),
        // club 2: exactly on the oro lower bound
        snapshot(2, 32, 850, '2026-11-26T02:00:00.000Z'),
        // club 3: one point under oro
        snapshot(3, 41, 849, '2026-11-26T02:05:00.000Z'),
      ]);
    });

    it('counts distinct clubs with any section at oro or better', async () => {
      const rows = await service.getSummary({ divisionId: 1 }, divisionActor());

      expect(rows).toEqual([
        expect.objectContaining({
          id: 3,
          gold_or_better_count: 2,
          progress_calculated_at: '2026-11-26T02:00:00.000Z',
        }),
        expect.objectContaining({
          id: 4,
          gold_or_better_count: 0,
          progress_calculated_at: '2026-11-26T02:05:00.000Z',
        }),
      ]);
      expect(
        prisma.annual_ranking_progress_snapshots.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            ecclesiastical_year_id: 7,
            local_field_id: { in: [31, 32, 41] },
          },
        }),
      );
    });

    it('is null for every row when the year has no snapshot rows', async () => {
      prisma.annual_ranking_progress_snapshots.findFirst.mockResolvedValue(
        null,
      );
      prisma.annual_ranking_progress_snapshots.findMany.mockResolvedValue([]);

      const rows = await service.getSummary({ divisionId: 1 }, divisionActor());

      expect(rows.map((r) => r.gold_or_better_count)).toEqual([null, null]);
      expect(rows.map((r) => r.progress_calculated_at)).toEqual([null, null]);
      expect(
        prisma.annual_ranking_progress_snapshots.findFirst,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ecclesiastical_year_id: 7 } }),
      );
    });

    it('is 0 (not null) for a child without rows when the year has snapshots', async () => {
      prisma.annual_ranking_progress_snapshots.findMany.mockResolvedValue([
        snapshot(1, 31, 900),
      ]);

      const rows = await service.getSummary({ divisionId: 1 }, divisionActor());

      expect(rows.find((r) => r.id === 4)).toEqual(
        expect.objectContaining({
          gold_or_better_count: 0,
          progress_calculated_at: null,
        }),
      );
    });

    it('uses the live tier bands', async () => {
      // oro band widened to 30%: oro now starts at 650 of 1000.
      prisma.ranking_tiers.findMany.mockResolvedValue([
        tier('diamante', 5, 1),
        tier('oro', 30, 2),
        tier('plata', 15, 3),
      ]);

      const rows = await service.getSummary({ divisionId: 1 }, divisionActor());

      expect(rows.find((r) => r.id === 4)?.gold_or_better_count).toBe(1);
      expect(prisma.ranking_tiers.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { active: true } }),
      );
    });

    it('derives bands per snapshot max_points and ignores max_points <= 0', async () => {
      prisma.annual_ranking_progress_snapshots.findMany.mockResolvedValue([
        // 450 of 500 -> oro from 425: gold
        snapshot(1, 31, 450, '2026-11-26T02:00:00.000Z', 500),
        snapshot(3, 41, 999, '2026-11-26T02:00:00.000Z', 0),
      ]);

      const rows = await service.getSummary({ divisionId: 1 }, divisionActor());

      expect(rows.map((r) => r.gold_or_better_count)).toEqual([1, 0]);
    });

    it('is null when the oro tier is not active', async () => {
      prisma.ranking_tiers.findMany.mockResolvedValue([
        tier('diamante', 5, 1),
        tier('plata', 15, 3),
      ]);

      const rows = await service.getSummary({ divisionId: 1 }, divisionActor());

      expect(rows.map((r) => r.gold_or_better_count)).toEqual([null, null]);
      expect(rows[0].progress_calculated_at).toBe('2026-11-26T02:00:00.000Z');
    });
  });

  it('400 when both division and union are given', async () => {
    await expect(
      service.getSummary({ divisionId: 1, unionId: 3 }, divisionActor()),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ErrorCode.ANNUAL_RANKING_SCOPE_INVALID,
      }),
    });
  });

  it('without union_id a division actor gets its own unions', async () => {
    const rows = await service.getSummary({}, divisionActor());

    expect(rows.map((r) => r.id)).toEqual([3, 4]);
    expect(prisma.unions.findMany).toHaveBeenCalled();
  });

  it('without union_id a union actor gets its own local fields', async () => {
    prisma.local_fields.findMany.mockResolvedValue([
      { local_field_id: 31, name: 'LF A', union_id: 3 },
    ]);

    const rows = await service.getSummary({}, unionActor(3));

    expect(rows.map((r) => r.id)).toEqual([31]);
    expect(prisma.unions.findMany).not.toHaveBeenCalled();
  });

  it('403 for a union actor reading another union or any division', async () => {
    await expect(
      service.getSummary({ unionId: 4 }, unionActor(3)),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.getSummary({ divisionId: 1 }, unionActor(3)),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.club_sections.findMany).not.toHaveBeenCalled();
  });

  it('403 for a division actor reading another division or a union outside it', async () => {
    await expect(
      service.getSummary({ divisionId: 2 }, divisionActor(1)),
    ).rejects.toMatchObject({ status: 403 });

    prisma.unions.findUnique.mockResolvedValue({ division_id: 2 });
    await expect(
      service.getSummary({ unionId: 9 }, divisionActor(1)),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('division actor may read a union inside its division', async () => {
    prisma.local_fields.findMany.mockResolvedValue([]);
    await expect(
      service.getSummary({ unionId: 3 }, divisionActor(1)),
    ).resolves.toEqual([]);
  });
});

import { AnnualRankingTerritorySummaryService } from './annual-ranking-territory-summary.service';
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
    };
    service = new AnnualRankingTerritorySummaryService(prisma);
  });

  it('division: one row per union, distinct clubs counted once', async () => {
    const rows = await service.getSummary({ divisionId: 1 }, divisionActor());

    expect(rows).toEqual([
      { id: 3, name: 'Golfo', clubs_count: 2, configured: true },
      { id: 4, name: 'Norte', clubs_count: 1, configured: false },
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
      { id: 31, name: 'LF A', clubs_count: 1, configured: true },
      { id: 32, name: 'LF B', clubs_count: 1, configured: false },
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

  it('400 when both or neither of division_id / union_id', async () => {
    await expect(
      service.getSummary({ divisionId: 1, unionId: 3 }, divisionActor()),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ErrorCode.ANNUAL_RANKING_SCOPE_INVALID,
      }),
    });
    await expect(service.getSummary({}, divisionActor())).rejects.toMatchObject(
      { status: 400 },
    );
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

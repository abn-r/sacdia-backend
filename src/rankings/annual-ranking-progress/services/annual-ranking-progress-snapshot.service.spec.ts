import { AnnualRankingProgressSnapshotService } from './annual-ranking-progress-snapshot.service';
import { AnnualRankingPointsService } from './annual-ranking-points.service';
import { AppNotFoundException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';

const YEAR = { year_id: 7, start_date: new Date('2026-01-01T00:00:00.000Z') };

const enrollment = (
  id: string,
  sectionId: number,
  clubId: number,
  localFieldId: number,
  clubTypeId = 1,
) => ({
  club_enrollment_id: id,
  club_section: {
    club_section_id: sectionId,
    club_type_id: clubTypeId,
    clubs: {
      club_id: clubId,
      local_field_id: localFieldId,
      local_fields: { union_id: 3 },
    },
  },
});

const config = (id: string, maxPoints = 1000) => ({
  annual_ranking_config_id: id,
  max_points: maxPoints,
  axes: [],
  components: [
    { component_key: 'annual_folder', label: 'Carpeta', max_points: maxPoints },
  ],
});

describe('AnnualRankingProgressSnapshotService', () => {
  let prisma: any;
  let lockService: { tryAcquire: jest.Mock; release: jest.Mock };
  let configService: { getByScope: jest.Mock };
  let scoreRegistry: { scoreComponent: jest.Mock };
  let service: AnnualRankingProgressSnapshotService;

  beforeEach(() => {
    prisma = {
      system_config: { findUnique: jest.fn().mockResolvedValue(null) },
      ecclesiastical_years: {
        findUnique: jest.fn().mockResolvedValue(YEAR),
        findFirst: jest.fn().mockResolvedValue(YEAR),
      },
      club_enrollments: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            enrollment('e-1', 11, 1, 31),
            enrollment('e-2', 12, 2, 31),
            enrollment('e-3', 13, 3, 41),
          ]),
      },
      annual_ranking_progress_snapshots: {
        upsert: jest.fn((args) => ({ op: 'upsert', args })),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      $transaction: jest.fn(async (ops: unknown[]) => ops),
    };
    lockService = {
      tryAcquire: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(undefined),
    };
    configService = {
      getByScope: jest.fn(async ({ localFieldId }) => {
        if (localFieldId === 41) {
          throw new AppNotFoundException(
            ErrorCode.ANNUAL_RANKING_CONFIG_NOT_FOUND,
          );
        }
        return config('cfg-31');
      }),
    };
    scoreRegistry = {
      scoreComponent: jest.fn(async (_component, context) => ({
        score_pct: context.clubEnrollmentId === 'e-1' ? 90 : 40,
        source_status: 'available',
        source: 'annual_folder',
      })),
    };

    service = new AnnualRankingProgressSnapshotService(
      prisma,
      lockService as any,
      configService as any,
      new AnnualRankingPointsService(scoreRegistry as any),
    );
  });

  it('upserts one row per scored enrollment and deletes rows not produced this run', async () => {
    const result = await service.refreshYear(7);

    expect(result).toEqual({ yearId: 7, upserted: 2, deleted: 2, failed: 0 });

    const upserts = prisma.annual_ranking_progress_snapshots.upsert.mock.calls
      .map(([args]: any[]) => args)
      .sort((a: any, b: any) =>
        a.where.club_enrollment_id.localeCompare(b.where.club_enrollment_id),
      );
    expect(upserts).toHaveLength(2);
    expect(upserts[0]).toEqual({
      where: { club_enrollment_id: 'e-1' },
      create: expect.objectContaining({
        club_enrollment_id: 'e-1',
        ecclesiastical_year_id: 7,
        club_section_id: 11,
        club_id: 1,
        club_type_id: 1,
        local_field_id: 31,
        annual_ranking_config_id: 'cfg-31',
        current_points: 900,
        max_points: 1000,
        calculated_at: expect.any(Date),
      }),
      update: expect.objectContaining({ current_points: 900 }),
    });
    expect(upserts[1].create).toEqual(
      expect.objectContaining({
        club_enrollment_id: 'e-2',
        current_points: 400,
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    const deleteWhere =
      prisma.annual_ranking_progress_snapshots.deleteMany.mock.calls[0][0]
        .where;
    expect(deleteWhere.ecclesiastical_year_id).toBe(7);
    expect([...deleteWhere.club_enrollment_id.notIn].sort()).toEqual([
      'e-1',
      'e-2',
    ]);

    expect(prisma.club_enrollments.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ecclesiastical_year_id: 7,
          club_section: { active: true, clubs: { active: true } },
        },
      }),
    );
    expect(lockService.tryAcquire).toHaveBeenCalledWith(
      'rankings:progress-snapshot:7',
      expect.any(Number),
    );
    expect(lockService.release).toHaveBeenCalledWith(
      'rankings:progress-snapshot:7',
    );
  });

  it('skips enrollments without config and looks each scope up once', async () => {
    await service.refreshYear(7);

    // e-1 and e-2 share (31, 1); e-3 is (41, 1) and has no config.
    expect(configService.getByScope).toHaveBeenCalledTimes(2);
    const scored = scoreRegistry.scoreComponent.mock.calls.map(
      ([, context]: any[]) => context.clubEnrollmentId,
    );
    expect(scored).not.toContain('e-3');
  });

  it('deletes every row of the year when nothing was produced', async () => {
    configService.getByScope.mockRejectedValue(
      new AppNotFoundException(ErrorCode.ANNUAL_RANKING_CONFIG_NOT_FOUND),
    );

    const result = await service.refreshYear(7);

    expect(result.upserted).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(
      prisma.annual_ranking_progress_snapshots.deleteMany,
    ).toHaveBeenCalledWith({ where: { ecclesiastical_year_id: 7 } });
  });

  it('keeps the previous row of an enrollment whose scoring fails', async () => {
    scoreRegistry.scoreComponent.mockImplementation(async (_c, context) => {
      if (context.clubEnrollmentId === 'e-2') throw new Error('source down');
      return {
        score_pct: 50,
        source_status: 'available',
        source: 'annual_folder',
      };
    });

    const result = await service.refreshYear(7);

    expect(result).toEqual(expect.objectContaining({ upserted: 1, failed: 1 }));
    const deleteWhere =
      prisma.annual_ranking_progress_snapshots.deleteMany.mock.calls[0][0]
        .where;
    expect([...deleteWhere.club_enrollment_id.notIn].sort()).toEqual([
      'e-1',
      'e-2',
    ]);
  });

  it('resolves the active year when none is given', async () => {
    await service.refreshYear();

    expect(prisma.ecclesiastical_years.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
    expect(prisma.ecclesiastical_years.findUnique).not.toHaveBeenCalled();
  });

  it('honors the rankings kill-switch', async () => {
    prisma.system_config.findUnique.mockResolvedValue({
      config_key: 'ranking.recalculation_enabled',
      config_value: 'false',
    });

    const result = await service.refreshYear(7);

    expect(result).toEqual({
      yearId: 7,
      upserted: 0,
      deleted: 0,
      failed: 0,
      skipped: true,
      reason: 'kill-switch',
    });
    expect(lockService.tryAcquire).not.toHaveBeenCalled();
    expect(prisma.club_enrollments.findMany).not.toHaveBeenCalled();
  });

  it('skips with a warning (no throw) when the lock is held', async () => {
    lockService.tryAcquire.mockResolvedValue(false);

    const result = await service.refreshYear(7);

    expect(result).toEqual(
      expect.objectContaining({
        yearId: 7,
        skipped: true,
        reason: 'lock-not-acquired',
      }),
    );
    expect(prisma.club_enrollments.findMany).not.toHaveBeenCalled();
    expect(lockService.release).not.toHaveBeenCalled();
  });

  it('skips when the year does not exist', async () => {
    prisma.ecclesiastical_years.findUnique.mockResolvedValue(null);

    const result = await service.refreshYear(99);

    expect(result).toEqual(
      expect.objectContaining({ skipped: true, reason: 'year-not-found' }),
    );
    expect(lockService.tryAcquire).not.toHaveBeenCalled();
  });

  it('releases the lock when the run throws', async () => {
    prisma.club_enrollments.findMany.mockRejectedValue(new Error('db down'));

    await expect(service.refreshYear(7)).rejects.toThrow('db down');
    expect(lockService.release).toHaveBeenCalledWith(
      'rankings:progress-snapshot:7',
    );
  });
});

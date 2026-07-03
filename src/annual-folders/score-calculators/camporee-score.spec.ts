import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CamporeeScoreService } from './camporee-score';

describe('CamporeeScoreService.calc', () => {
  let svc: CamporeeScoreService;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CamporeeScoreService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = moduleRef.get(CamporeeScoreService);
  });

  it('scores section results over all scoring events in scope', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      { awarded_points: '170.00', max_points: '300.00' },
    ]);

    const result = await svc.calc(50, 1, 2, 2026);

    expect(result).toBe(56.67);
  });

  it('counts missing event result as zero through denominator', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      { awarded_points: '100.00', max_points: '300.00' },
    ]);

    const result = await svc.calc(50, 1, 2, 2026);

    expect(result).toBe(33.33);
  });

  it('ignores non-scoring events in denominator by filtering scoring_enabled', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      { awarded_points: '100.00', max_points: '100.00' },
    ]);

    const result = await svc.calc(50, 1, 2, 2026);

    expect(result).toBe(100);
    expect(String(prisma.$queryRaw.mock.calls[0][0])).toContain(
      'e.scoring_enabled = true',
    );
  });

  it('returns zero when there are no scoring-enabled camporee events', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      { awarded_points: '0.00', max_points: '0.00' },
    ]);

    const result = await svc.calc(50, 1, 2, 2026);

    expect(result).toBe(0);
  });

  it('does not use camporee attendance rows as awarded points', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      { awarded_points: '0.00', max_points: '100.00' },
    ]);

    const result = await svc.calc(50, 1, 2, 2026);

    expect(result).toBe(0);
    const sql = String(prisma.$queryRaw.mock.calls[0][0]);
    expect(sql).not.toContain('camporee_members');
    expect(sql).not.toContain('camporee_clubs');
  });

  it('handles section without union_id by scoring only local camporees', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      { awarded_points: '80.00', max_points: '100.00' },
    ]);

    const result = await svc.calc(50, 1, null, 2026);

    expect(result).toBe(80);
  });
});

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

  it('returns 100 when club attended all camporees in scope', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ denom: 2n }])
      .mockResolvedValueOnce([{ numer: 2n }]);
    const result = await svc.calc(1, 1, 2, 2026);
    expect(result).toBe(100);
  });

  it('returns 0 when no camporees exist for the year (denom=0)', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ denom: 0n }]);
    const result = await svc.calc(1, 1, 2, 2026);
    expect(result).toBe(0);
  });

  it('returns 50 when 1 of 2 camporees attended', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ denom: 2n }])
      .mockResolvedValueOnce([{ numer: 1n }]);
    const result = await svc.calc(1, 1, 2, 2026);
    expect(result).toBe(50);
  });

  it('handles club without union_id (falls back to local camporees only)', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ denom: 1n }])
      .mockResolvedValueOnce([{ numer: 1n }]);
    const result = await svc.calc(1, 1, null, 2026);
    expect(result).toBe(100);
  });

  it('returns 25 for 1 of 4 attended (rounded to 2 decimals)', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ denom: 4n }])
      .mockResolvedValueOnce([{ numer: 1n }]);
    const result = await svc.calc(1, 1, 2, 2026);
    expect(result).toBe(25);
  });
});

import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { EvidenceScoreService } from './evidence-score';

describe('EvidenceScoreService.calc', () => {
  let svc: EvidenceScoreService;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        EvidenceScoreService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = moduleRef.get(EvidenceScoreService);
  });

  it('returns 0 when no evaluated records (default for 0/0)', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ validated: 0n, rejected: 0n }]);
    const result = await svc.calc(42, 5);
    expect(result).toBe(0);
  });

  it('returns 100 when all validated', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ validated: 22n, rejected: 0n }]);
    const result = await svc.calc(42, 5);
    expect(result).toBe(100);
  });

  it('returns 0 when all rejected', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ validated: 0n, rejected: 5n }]);
    const result = await svc.calc(42, 5);
    expect(result).toBe(0);
  });

  it('returns 88 for 22 validated / 3 rejected', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ validated: 22n, rejected: 3n }]);
    const result = await svc.calc(42, 5);
    expect(result).toBe(88);
  });

  it('rounds to 2 decimals', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ validated: 1n, rejected: 2n }]);
    const result = await svc.calc(42, 5);
    expect(result).toBe(33.33);
  });

  it('handles missing rows array safely (defensive)', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);
    const result = await svc.calc(42, 5);
    expect(result).toBe(0);
  });
});

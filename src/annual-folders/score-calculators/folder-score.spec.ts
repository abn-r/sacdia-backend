import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { FolderScoreService } from './folder-score';

describe('FolderScoreService.calc', () => {
  let svc: FolderScoreService;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };
    const m = await Test.createTestingModule({
      providers: [
        FolderScoreService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = m.get(FolderScoreService);
  });

  it('returns 0 when SUM(max_points) is 0', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ earned: 0n, max: 0n }]);
    const result = await svc.calc('11111111-1111-1111-1111-111111111111', 5);
    expect(result).toBe(0);
  });

  it('returns 78.48 for 1240/1580', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ earned: 1240n, max: 1580n }]);
    const result = await svc.calc('11111111-1111-1111-1111-111111111111', 5);
    expect(result).toBe(78.48);
  });

  it('returns 100 when earned equals max', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ earned: 500n, max: 500n }]);
    const result = await svc.calc('11111111-1111-1111-1111-111111111111', 5);
    expect(result).toBe(100);
  });

  it('handles empty rows array safely', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);
    const result = await svc.calc('11111111-1111-1111-1111-111111111111', 5);
    expect(result).toBe(0);
  });
});

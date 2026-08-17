import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { InstitutionalDataCompletenessScoreService } from './institutional-data-completeness-score';

describe('InstitutionalDataCompletenessScoreService.calc', () => {
  let svc: InstitutionalDataCompletenessScoreService;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        InstitutionalDataCompletenessScoreService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = moduleRef.get(InstitutionalDataCompletenessScoreService);
  });

  it('returns completed institutional fields divided by expected fields', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ completed: 9, total: 9 }]);

    await expect(svc.calc('enrollment-id')).resolves.toBe(100);
  });

  it('returns 0 when enrollment data is missing', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);

    await expect(svc.calc('enrollment-id')).resolves.toBe(0);
  });
});

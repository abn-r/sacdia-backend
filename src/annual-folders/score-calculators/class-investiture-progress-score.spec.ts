import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ClassInvestitureProgressScoreService } from './class-investiture-progress-score';

describe('ClassInvestitureProgressScoreService.calc', () => {
  let svc: ClassInvestitureProgressScoreService;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ClassInvestitureProgressScoreService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = moduleRef.get(ClassInvestitureProgressScoreService);
  });

  it('returns completed investitures divided by active enrollments', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ completed: 4n, total: 10n }]);

    await expect(svc.calc('enrollment-id', 1)).resolves.toBe(40);
  });

  it('returns 0 when there are no active class enrollments', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ completed: 0n, total: 0n }]);

    await expect(svc.calc('enrollment-id', 1)).resolves.toBe(0);
  });
});

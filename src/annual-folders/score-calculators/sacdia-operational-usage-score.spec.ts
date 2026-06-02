import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { SacdiaOperationalUsageScoreService } from './sacdia-operational-usage-score';

describe('SacdiaOperationalUsageScoreService.calc', () => {
  let svc: SacdiaOperationalUsageScoreService;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        SacdiaOperationalUsageScoreService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = moduleRef.get(SacdiaOperationalUsageScoreService);
  });

  it('returns active operational users divided by active section users', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      { active_operational_users: 5n, active_section_users: 9n },
    ]);

    await expect(svc.calc('enrollment-id', 1)).resolves.toBe(55.56);
  });

  it('returns 0 when there are no active section users', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      { active_operational_users: 0n, active_section_users: 0n },
    ]);

    await expect(svc.calc('enrollment-id', 1)).resolves.toBe(0);
  });
});

import { Test } from '@nestjs/testing';
import { InvestitureScoreService } from './investiture-score.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('InvestitureScoreService', () => {
  let service: InvestitureScoreService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        InvestitureScoreService,
        { provide: PrismaService, useValue: { enrollments: { findFirst: jest.fn() } } },
      ],
    }).compile();
    service = module.get(InvestitureScoreService);
    prisma = module.get(PrismaService);
  });

  it('INVESTIDO → 100', async () => {
    (prisma.enrollments.findFirst as jest.Mock).mockResolvedValue({
      enrollment_id: 1, investiture_status: 'INVESTIDO',
    });
    expect(await service.calculate(1, 2)).toBe(100);
  });

  it('IN_PROGRESS → 0', async () => {
    (prisma.enrollments.findFirst as jest.Mock).mockResolvedValue({
      enrollment_id: 1, investiture_status: 'IN_PROGRESS',
    });
    expect(await service.calculate(1, 2)).toBe(0);
  });

  it('no enrollment for year → null', async () => {
    (prisma.enrollments.findFirst as jest.Mock).mockResolvedValue(null);
    expect(await service.calculate(1, 999)).toBeNull();
  });

  it('multiple enrollments same year → uses first (findFirst)', async () => {
    (prisma.enrollments.findFirst as jest.Mock).mockResolvedValue({
      enrollment_id: 1, investiture_status: 'INVESTIDO',
    });
    expect(await service.calculate(1, 2)).toBe(100);
    expect(prisma.enrollments.findFirst).toHaveBeenCalledWith({
      where: { enrollment_id: 1, ecclesiastical_year_id: 2 },
    });
  });
});

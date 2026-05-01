import { Test } from '@nestjs/testing';
import { investiture_status_enum } from '@prisma/client';
import { InvestitureScoreService } from './investiture-score.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('InvestitureScoreService', () => {
  let service: InvestitureScoreService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        InvestitureScoreService,
        {
          provide: PrismaService,
          useValue: { enrollments: { findUnique: jest.fn() } },
        },
      ],
    }).compile();
    service = module.get(InvestitureScoreService);
    prisma = module.get(PrismaService);
  });

  it('INVESTIDO → 100', async () => {
    (prisma.enrollments.findUnique as jest.Mock).mockResolvedValue({
      enrollment_id: 1,
      investiture_status: investiture_status_enum.INVESTIDO,
    });
    expect(await service.calculate(1, 2)).toBe(100);
  });

  it('IN_PROGRESS → 0', async () => {
    (prisma.enrollments.findUnique as jest.Mock).mockResolvedValue({
      enrollment_id: 1,
      investiture_status: investiture_status_enum.IN_PROGRESS,
    });
    expect(await service.calculate(1, 2)).toBe(0);
  });

  it('no enrollment → null', async () => {
    (prisma.enrollments.findUnique as jest.Mock).mockResolvedValue(null);
    expect(await service.calculate(999, 2)).toBeNull();
  });

  it('passes correct where clause to findUnique (PK lookup)', async () => {
    (prisma.enrollments.findUnique as jest.Mock).mockResolvedValue({
      enrollment_id: 1,
      investiture_status: investiture_status_enum.INVESTIDO,
    });
    expect(await service.calculate(1, 2)).toBe(100);
    expect(prisma.enrollments.findUnique).toHaveBeenCalledWith({
      where: { enrollment_id: 1 },
    });
  });
});

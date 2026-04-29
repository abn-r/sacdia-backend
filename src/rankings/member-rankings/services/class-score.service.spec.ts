import { Test } from '@nestjs/testing';
import { ClassScoreService } from './class-score.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('ClassScoreService', () => {
  let service: ClassScoreService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ClassScoreService,
        {
          provide: PrismaService,
          useValue: {
            enrollments: { findUnique: jest.fn() },
            class_module_progress: { count: jest.fn() },
            class_modules: { count: jest.fn() },
          },
        },
      ],
    }).compile();
    service = module.get(ClassScoreService);
    prisma = module.get(PrismaService);
  });

  it('happy path: 3/5 modules completed → 60.00', async () => {
    (prisma.enrollments.findUnique as jest.Mock).mockResolvedValue({
      enrollment_id: 1, class_id: 10, ecclesiastical_year_id: 2,
    });
    (prisma.class_module_progress.count as jest.Mock).mockResolvedValue(3);
    (prisma.class_modules.count as jest.Mock).mockResolvedValue(5);
    expect(await service.calculate(1, 2)).toBe(60);
  });

  it('required_count = 0 → null', async () => {
    (prisma.enrollments.findUnique as jest.Mock).mockResolvedValue({
      enrollment_id: 1, class_id: 10, ecclesiastical_year_id: 2,
    });
    (prisma.class_module_progress.count as jest.Mock).mockResolvedValue(0);
    (prisma.class_modules.count as jest.Mock).mockResolvedValue(0);
    expect(await service.calculate(1, 2)).toBeNull();
  });

  it('completed > required → clamp 100', async () => {
    (prisma.enrollments.findUnique as jest.Mock).mockResolvedValue({
      enrollment_id: 1, class_id: 10, ecclesiastical_year_id: 2,
    });
    (prisma.class_module_progress.count as jest.Mock).mockResolvedValue(7);
    (prisma.class_modules.count as jest.Mock).mockResolvedValue(5);
    expect(await service.calculate(1, 2)).toBe(100);
  });

  it('no enrollment → null', async () => {
    (prisma.enrollments.findUnique as jest.Mock).mockResolvedValue(null);
    expect(await service.calculate(999, 2)).toBeNull();
  });

  it('exact 0 completed of 5 required → 0', async () => {
    (prisma.enrollments.findUnique as jest.Mock).mockResolvedValue({
      enrollment_id: 1, class_id: 10, ecclesiastical_year_id: 2,
    });
    (prisma.class_module_progress.count as jest.Mock).mockResolvedValue(0);
    (prisma.class_modules.count as jest.Mock).mockResolvedValue(5);
    expect(await service.calculate(1, 2)).toBe(0);
  });
});

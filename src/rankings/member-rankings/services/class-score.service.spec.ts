import { Test } from '@nestjs/testing';
import { ClassScoreService } from './class-score.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClassRequirementEligibilityService } from '../../../classes/class-requirement-eligibility.service';

describe('ClassScoreService', () => {
  let service: ClassScoreService;
  let prisma: jest.Mocked<PrismaService>;
  let requirementEligibility: {
    calculateForEnrollment: jest.Mock;
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ClassScoreService,
        {
          provide: PrismaService,
          useValue: {
            enrollments: { findUnique: jest.fn() },
          },
        },
        {
          provide: ClassRequirementEligibilityService,
          useValue: { calculateForEnrollment: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(ClassScoreService);
    prisma = module.get(PrismaService);
    requirementEligibility = module.get(ClassRequirementEligibilityService);
  });

  it('happy path: 3/5 modules completed → 60.00', async () => {
    (prisma.enrollments.findUnique as jest.Mock).mockResolvedValue({
      enrollment_id: 1,
      class_id: 10,
      ecclesiastical_year_id: 2,
    });
    requirementEligibility.calculateForEnrollment.mockResolvedValue({
      investiture_progress: { total: 5, completed: 3, percentage: 60 },
      overall_progress: 60,
    });
    expect(await service.calculate(1, 2)).toBe(60);
  });

  it('required_count = 0 → null', async () => {
    (prisma.enrollments.findUnique as jest.Mock).mockResolvedValue({
      enrollment_id: 1,
      class_id: 10,
      ecclesiastical_year_id: 2,
    });
    requirementEligibility.calculateForEnrollment.mockResolvedValue({
      investiture_progress: { total: 0, completed: 0, percentage: 0 },
      overall_progress: 0,
    });
    expect(await service.calculate(1, 2)).toBeNull();
  });

  it('completed > required → clamp 100', async () => {
    (prisma.enrollments.findUnique as jest.Mock).mockResolvedValue({
      enrollment_id: 1,
      class_id: 10,
      ecclesiastical_year_id: 2,
    });
    requirementEligibility.calculateForEnrollment.mockResolvedValue({
      investiture_progress: { total: 5, completed: 7, percentage: 140 },
      overall_progress: 140,
    });
    expect(await service.calculate(1, 2)).toBe(100);
  });

  it('no enrollment → null (short-circuits, no further DB calls)', async () => {
    (prisma.enrollments.findUnique as jest.Mock).mockResolvedValue(null);
    expect(await service.calculate(999, 2)).toBeNull();
    expect(
      requirementEligibility.calculateForEnrollment,
    ).not.toHaveBeenCalled();
  });

  it('exact 0 completed of 5 required → 0', async () => {
    (prisma.enrollments.findUnique as jest.Mock).mockResolvedValue({
      enrollment_id: 1,
      class_id: 10,
      ecclesiastical_year_id: 2,
    });
    requirementEligibility.calculateForEnrollment.mockResolvedValue({
      investiture_progress: { total: 5, completed: 0, percentage: 0 },
      overall_progress: 0,
    });
    expect(await service.calculate(1, 2)).toBe(0);
  });
});

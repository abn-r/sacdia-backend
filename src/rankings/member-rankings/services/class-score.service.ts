import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClassRequirementEligibilityService } from '../../../classes/class-requirement-eligibility.service';

@Injectable()
export class ClassScoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requirementEligibility: ClassRequirementEligibilityService,
  ) {}

  async calculate(
    enrollmentId: number,
    _ecclesiasticalYearId: number,
  ): Promise<number | null> {
    const enrollment = await this.prisma.enrollments.findUnique({
      where: { enrollment_id: enrollmentId },
    });
    if (!enrollment) return null;

    const eligibility =
      await this.requirementEligibility.calculateForEnrollment(enrollmentId);

    const requiredCount = eligibility?.investiture_progress.total ?? 0;
    if (requiredCount === 0) return null;

    return Math.min(eligibility?.overall_progress ?? 0, 100);
  }
}

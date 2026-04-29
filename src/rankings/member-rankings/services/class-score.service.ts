import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class ClassScoreService {
  constructor(private readonly prisma: PrismaService) {}

  async calculate(
    enrollmentId: number,
    ecclesiasticalYearId: number,
  ): Promise<number | null> {
    const enrollment = await this.prisma.enrollments.findUnique({
      where: { enrollment_id: enrollmentId },
    });
    if (!enrollment) return null;

    const completedCount = await this.prisma.class_module_progress.count({
      where: {
        enrollment_id: enrollmentId,
        active: true,
        score: { not: null },
      },
    });

    const requiredCount = await this.prisma.class_modules.count({
      where: { class_id: enrollment.class_id },
    });

    if (requiredCount === 0) return null;
    return Math.min((completedCount / requiredCount) * 100, 100);
  }
}

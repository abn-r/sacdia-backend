import { Injectable } from '@nestjs/common';
import { investiture_status_enum } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class InvestitureScoreService {
  constructor(private readonly prisma: PrismaService) {}

  async calculate(
    enrollmentId: number,
    _ecclesiasticalYearId: number,
  ): Promise<number | null> {
    const enrollment = await this.prisma.enrollments.findUnique({
      where: { enrollment_id: enrollmentId },
    });
    if (!enrollment) return null;
    return enrollment.investiture_status === investiture_status_enum.INVESTIDO
      ? 100
      : 0;
  }
}

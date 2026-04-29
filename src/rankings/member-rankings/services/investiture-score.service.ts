import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class InvestitureScoreService {
  constructor(private readonly prisma: PrismaService) {}

  async calculate(
    enrollmentId: number,
    ecclesiasticalYearId: number,
  ): Promise<number | null> {
    const enrollment = await this.prisma.enrollments.findFirst({
      where: {
        enrollment_id: enrollmentId,
        ecclesiastical_year_id: ecclesiasticalYearId,
      },
    });
    if (!enrollment) return null;
    return enrollment.investiture_status === 'INVESTIDO' ? 100 : 0;
  }
}

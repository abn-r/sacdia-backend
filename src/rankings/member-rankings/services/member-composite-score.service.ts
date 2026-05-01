import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClassScoreService } from './class-score.service';
import { InvestitureScoreService } from './investiture-score.service';
import { CamporeeScoreService } from './camporee-score.service';
import {
  EnrollmentWeightsResolverService,
  ResolvedWeights,
} from './enrollment-weights-resolver.service';

export interface CompositeResult {
  class_score_pct: number | null;
  investiture_score_pct: number | null;
  camporee_score_pct: number | null;
  composite_score_pct: number | null;
  weights: ResolvedWeights;
}

@Injectable()
export class MemberCompositeScoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classScore: ClassScoreService,
    private readonly investitureScore: InvestitureScoreService,
    private readonly camporeeScore: CamporeeScoreService,
    private readonly weightsResolver: EnrollmentWeightsResolverService,
  ) {}

  async calculate(
    enrollmentId: number,
    ecclesiasticalYearId: number,
  ): Promise<CompositeResult | null> {
    const enrollment = await this.prisma.enrollments.findUnique({
      where: { enrollment_id: enrollmentId },
      include: { classes: { select: { club_type_id: true } } },
    });
    if (!enrollment) return null;

    const weights = await this.weightsResolver.resolve({
      clubTypeId: (enrollment as any).classes?.club_type_id ?? null,
      ecclesiasticalYearId,
    });

    const [classScore, investitureScore, camporeeScore] = await Promise.all([
      this.classScore.calculate(enrollmentId, ecclesiasticalYearId),
      this.investitureScore.calculate(enrollmentId, ecclesiasticalYearId),
      this.camporeeScore.calculate(enrollmentId, ecclesiasticalYearId),
    ]);

    const scores = [classScore, investitureScore, camporeeScore];
    const weightValues = [
      weights.class_pct,
      weights.investiture_pct,
      weights.camporee_pct,
    ];

    let totalWeightUsed = 0;
    let weightedSum = 0;
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] !== null) {
        weightedSum += (scores[i] as number) * weightValues[i];
        totalWeightUsed += weightValues[i];
      }
    }

    if (totalWeightUsed === 0) {
      return {
        class_score_pct: classScore,
        investiture_score_pct: investitureScore,
        camporee_score_pct: camporeeScore,
        composite_score_pct: null,
        weights,
      };
    }

    const composite = weightedSum / totalWeightUsed;
    return {
      class_score_pct: classScore,
      investiture_score_pct: investitureScore,
      camporee_score_pct: camporeeScore,
      composite_score_pct: Math.min(Math.max(composite, 0), 100),
      weights,
    };
  }
}

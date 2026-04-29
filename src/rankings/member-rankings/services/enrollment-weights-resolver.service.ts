import { Injectable } from '@nestjs/common';
import { AppInternalServerErrorException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { PrismaService } from '../../../prisma/prisma.service';

export interface ResolvedWeights {
  class_pct: number;
  investiture_pct: number;
  camporee_pct: number;
  source: 'default' | string;
}

@Injectable()
export class EnrollmentWeightsResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(params: {
    clubTypeId: number | null;
    ecclesiasticalYearId: number | null;
  }): Promise<ResolvedWeights> {
    const { clubTypeId, ecclesiasticalYearId } = params;

    if (clubTypeId !== null && ecclesiasticalYearId !== null) {
      const ovrYear = await this.prisma.enrollmentRankingWeight.findFirst({
        where: {
          club_type_id: clubTypeId,
          ecclesiastical_year_id: ecclesiasticalYearId,
        },
      });
      if (ovrYear) {
        return {
          class_pct: Number(ovrYear.class_pct),
          investiture_pct: Number(ovrYear.investiture_pct),
          camporee_pct: Number(ovrYear.camporee_pct),
          source: `override:club_type_${clubTypeId}+year_${ecclesiasticalYearId}`,
        };
      }
    }

    if (clubTypeId !== null) {
      const ovrType = await this.prisma.enrollmentRankingWeight.findFirst({
        where: { club_type_id: clubTypeId, ecclesiastical_year_id: null },
      });
      if (ovrType) {
        return {
          class_pct: Number(ovrType.class_pct),
          investiture_pct: Number(ovrType.investiture_pct),
          camporee_pct: Number(ovrType.camporee_pct),
          source: `override:club_type_${clubTypeId}`,
        };
      }
    }

    const def = await this.prisma.enrollmentRankingWeight.findFirst({
      where: {
        club_type_id: null,
        ecclesiastical_year_id: null,
        is_default: true,
      },
    });
    if (!def) {
      throw new AppInternalServerErrorException(
        ErrorCode.RANKING_WEIGHTS_DEFAULT_NOT_FOUND,
      );
    }
    return {
      class_pct: Number(def.class_pct),
      investiture_pct: Number(def.investiture_pct),
      camporee_pct: Number(def.camporee_pct),
      source: 'default',
    };
  }
}

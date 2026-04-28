import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ResolvedWeights {
  folder: number;
  finance: number;
  camporee: number;
  evidence: number;
  source: 'default' | 'club_type_override';
}

@Injectable()
export class WeightsResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(clubTypeId: number): Promise<ResolvedWeights> {
    const override = await this.prisma.ranking_weight_configs.findUnique({
      where: { club_type_id: clubTypeId },
    });
    if (override) {
      return {
        folder: override.folder_weight,
        finance: override.finance_weight,
        camporee: override.camporee_weight,
        evidence: override.evidence_weight,
        source: 'club_type_override',
      };
    }
    const def = await this.prisma.ranking_weight_configs.findFirst({
      where: { club_type_id: null },
    });
    if (!def) {
      throw new Error('Default global weights configuration missing');
    }
    return {
      folder: def.folder_weight,
      finance: def.finance_weight,
      camporee: def.camporee_weight,
      evidence: def.evidence_weight,
      source: 'default',
    };
  }
}

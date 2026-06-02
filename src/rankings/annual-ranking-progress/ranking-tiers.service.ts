import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateRankingTierDto } from './dto/update-ranking-tier.dto';

@Injectable()
export class RankingTiersService {
  constructor(private readonly prisma: PrismaService) {}

  listActive() {
    return this.prisma.ranking_tiers.findMany({
      where: { active: true },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });
  }

  update(id: string, dto: UpdateRankingTierDto) {
    return this.prisma.ranking_tiers.update({
      where: { ranking_tier_id: id },
      data: dto,
    });
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRankingWeightsDto } from './dto/create-ranking-weights.dto';
import { UpdateRankingWeightsDto } from './dto/update-ranking-weights.dto';
import { AppBadRequestException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

@Injectable()
export class RankingWeightsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.ranking_weight_configs.findMany({
      orderBy: [{ club_type_id: 'asc' }],
    });
  }

  async getById(id: string) {
    const row = await this.prisma.ranking_weight_configs.findUnique({
      where: { ranking_weight_config_id: id },
    });
    if (!row) throw new NotFoundException(`Ranking weight config not found: ${id}`);
    return row;
  }

  async create(dto: CreateRankingWeightsDto, userId?: string) {
    if (dto.club_type_id == null) {
      throw new BadRequestException(
        'club_type_id is required for overrides; the default global row is seeded and cannot be created via this endpoint',
      );
    }

    const sum =
      dto.folder_weight + dto.finance_weight + dto.camporee_weight + dto.evidence_weight;
    if (sum !== 100) {
      throw new BadRequestException(`Weights must sum to 100; got ${sum}`);
    }

    const existing = await this.prisma.ranking_weight_configs.findUnique({
      where: { club_type_id: dto.club_type_id },
    });
    if (existing) {
      throw new ConflictException(
        `Override already exists for club_type_id ${dto.club_type_id}`,
      );
    }

    return this.prisma.ranking_weight_configs.create({
      data: {
        club_type_id: dto.club_type_id,
        folder_weight: dto.folder_weight,
        finance_weight: dto.finance_weight,
        camporee_weight: dto.camporee_weight,
        evidence_weight: dto.evidence_weight,
        updated_by: userId ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateRankingWeightsDto, userId?: string) {
    const current = await this.getById(id);

    const merged = {
      folder_weight: dto.folder_weight ?? current.folder_weight,
      finance_weight: dto.finance_weight ?? current.finance_weight,
      camporee_weight: dto.camporee_weight ?? current.camporee_weight,
      evidence_weight: dto.evidence_weight ?? current.evidence_weight,
    };

    const sum =
      merged.folder_weight +
      merged.finance_weight +
      merged.camporee_weight +
      merged.evidence_weight;
    if (sum !== 100) {
      throw new BadRequestException(`Weights must sum to 100; got ${sum}`);
    }

    return this.prisma.ranking_weight_configs.update({
      where: { ranking_weight_config_id: id },
      data: {
        ...merged,
        updated_by: userId ?? null,
        updated_at: new Date(),
      },
    });
  }

  async delete(id: string) {
    const row = await this.getById(id);
    if (row.club_type_id == null) {
      throw new AppBadRequestException(ErrorCode.RANKING_WEIGHTS_DEFAULT_NOT_DELETABLE);
    }
    return this.prisma.ranking_weight_configs.delete({
      where: { ranking_weight_config_id: id },
    });
  }
}

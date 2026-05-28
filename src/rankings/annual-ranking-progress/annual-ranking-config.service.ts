import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAnnualRankingConfigDto } from './dto/create-annual-ranking-config.dto';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

export interface AnnualRankingConfigScope {
  localFieldId: number;
  ecclesiasticalYearId: number;
  clubTypeId: number;
}

@Injectable()
export class AnnualRankingConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateAnnualRankingConfigDto, userId?: string) {
    this.validateComponentBudget(dto);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.annual_ranking_configs.findFirst({
        where: {
          local_field_id: dto.local_field_id,
          ecclesiastical_year_id: dto.ecclesiastical_year_id,
          club_type_id: dto.club_type_id,
        },
      });

      if (existing) {
        throw new AppConflictException(
          ErrorCode.ANNUAL_RANKING_CONFIG_CONFLICT,
          {
            localFieldId: String(dto.local_field_id),
            ecclesiasticalYearId: String(dto.ecclesiastical_year_id),
            clubTypeId: String(dto.club_type_id),
          },
        );
      }

      return tx.annual_ranking_configs.create({
        data: {
          local_field_id: dto.local_field_id,
          ecclesiastical_year_id: dto.ecclesiastical_year_id,
          club_type_id: dto.club_type_id,
          max_points: dto.max_points,
          created_by: userId ?? null,
          updated_by: userId ?? null,
          components: {
            create: dto.components.map((component, index) => ({
              component_key: component.component_key,
              label: component.label,
              max_points: component.max_points,
              sort_order: component.sort_order ?? index,
            })),
          },
        },
        include: this.configInclude(),
      });
    });
  }

  async getByScope(scope: AnnualRankingConfigScope) {
    const config = await this.prisma.annual_ranking_configs.findFirst({
      where: {
        local_field_id: scope.localFieldId,
        ecclesiastical_year_id: scope.ecclesiasticalYearId,
        club_type_id: scope.clubTypeId,
        active: true,
      },
      include: {
        components: {
          where: { active: true },
          orderBy: [{ sort_order: 'asc' }, { component_key: 'asc' }],
        },
      },
    });

    if (!config) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_RANKING_CONFIG_NOT_FOUND,
        {
          localFieldId: String(scope.localFieldId),
          ecclesiasticalYearId: String(scope.ecclesiasticalYearId),
          clubTypeId: String(scope.clubTypeId),
        },
      );
    }

    return config;
  }

  private validateComponentBudget(dto: CreateAnnualRankingConfigDto): void {
    const total = dto.components.reduce(
      (sum, component) => sum + component.max_points,
      0,
    );

    if (total !== dto.max_points) {
      throw new AppBadRequestException(
        ErrorCode.ANNUAL_RANKING_COMPONENT_SUM_INVALID,
        {
          maxPoints: String(dto.max_points),
          componentSum: String(total),
        },
      );
    }
  }

  private configInclude() {
    return {
      components: {
        orderBy: [{ sort_order: 'asc' }, { component_key: 'asc' }],
      },
    } as const;
  }
}

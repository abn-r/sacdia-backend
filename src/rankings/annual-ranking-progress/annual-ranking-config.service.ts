import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateAnnualRankingAxisConfigDto,
  CreateAnnualRankingComponentConfigDto,
  CreateAnnualRankingConfigDto,
} from './dto/create-annual-ranking-config.dto';
import { UpdateAnnualRankingConfigDto } from './dto/update-annual-ranking-config.dto';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  RANKING_AXES,
  getRankingComponentAxis,
  normalizeRankingComponentKey,
  type RankingAxisKey,
  type RankingComponentKey,
} from './ranking-component-catalog';

export interface AnnualRankingConfigScope {
  localFieldId: number;
  ecclesiasticalYearId: number;
  clubTypeId: number;
}

export interface AnnualRankingConfigListFilters {
  localFieldId?: number;
  ecclesiasticalYearId?: number;
  clubTypeId?: number;
}

interface NormalizedAnnualRankingComponent {
  component_key: RankingComponentKey;
  label: string;
  max_points: number;
  sort_order: number;
}

interface NormalizedAnnualRankingAxis {
  axis_key: RankingAxisKey;
  label: string;
  max_points: number;
  sort_order: number;
  components: NormalizedAnnualRankingComponent[];
}

interface AnnualRankingConfigWriteDto {
  max_points: number;
  axes?: CreateAnnualRankingAxisConfigDto[];
  components?: CreateAnnualRankingComponentConfigDto[];
}

interface CreatedAxisRow {
  annual_ranking_axis_config_id: string;
  axis_key: string;
}

interface CreatedConfigWithAxes {
  annual_ranking_config_id: string;
  axes?: CreatedAxisRow[];
}

@Injectable()
export class AnnualRankingConfigService {
  constructor(private readonly prisma: PrismaService) {}

  list(filters: AnnualRankingConfigListFilters = {}) {
    return this.prisma.annual_ranking_configs.findMany({
      where: {
        active: true,
        ...(filters.localFieldId !== undefined
          ? { local_field_id: filters.localFieldId }
          : {}),
        ...(filters.ecclesiasticalYearId !== undefined
          ? { ecclesiastical_year_id: filters.ecclesiasticalYearId }
          : {}),
        ...(filters.clubTypeId !== undefined
          ? { club_type_id: filters.clubTypeId }
          : {}),
      },
      include: this.activeConfigInclude(),
      orderBy: [
        { local_field_id: 'asc' },
        { ecclesiastical_year_id: 'desc' },
        { club_type_id: 'asc' },
      ],
    });
  }

  async create(dto: CreateAnnualRankingConfigDto, userId?: string) {
    const normalizedAxes = this.normalizeRankingBudget(dto);

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

      const createdConfig = await tx.annual_ranking_configs.create({
        data: {
          local_field_id: dto.local_field_id,
          ecclesiastical_year_id: dto.ecclesiastical_year_id,
          club_type_id: dto.club_type_id,
          max_points: dto.max_points,
          created_by: userId ?? null,
          updated_by: userId ?? null,
          axes: {
            create: normalizedAxes.map((axis) => ({
              axis_key: axis.axis_key,
              label: axis.label,
              max_points: axis.max_points,
              sort_order: axis.sort_order,
            })),
          },
        },
        include: this.axisOnlyInclude(),
      });

      await this.createComponents(tx, createdConfig, normalizedAxes);

      return (
        (await tx.annual_ranking_configs.findFirst({
          where: {
            annual_ranking_config_id: createdConfig.annual_ranking_config_id,
          },
          include: this.configInclude(),
        })) ?? createdConfig
      );
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
        axes: {
          where: { active: true },
          orderBy: [{ sort_order: 'asc' }, { axis_key: 'asc' }],
          include: {
            components: {
              where: { active: true },
              orderBy: [{ sort_order: 'asc' }, { component_key: 'asc' }],
            },
          },
        },
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

  async update(id: string, dto: UpdateAnnualRankingConfigDto, userId?: string) {
    const normalizedAxes = this.normalizeRankingBudget(dto);

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.annual_ranking_configs.findFirst({
        where: {
          annual_ranking_config_id: id,
          active: true,
        },
      });

      if (!current) {
        throw new AppNotFoundException(
          ErrorCode.ANNUAL_RANKING_CONFIG_NOT_FOUND,
          {
            localFieldId: id,
            ecclesiasticalYearId: id,
            clubTypeId: id,
          },
        );
      }

      await tx.annual_ranking_component_configs.deleteMany({
        where: { annual_ranking_config_id: id },
      });
      await tx.annual_ranking_axis_configs.deleteMany({
        where: { annual_ranking_config_id: id },
      });

      const updatedConfig = await tx.annual_ranking_configs.update({
        where: { annual_ranking_config_id: id },
        data: {
          max_points: dto.max_points,
          updated_by: userId ?? null,
          axes: {
            create: normalizedAxes.map((axis) => ({
              axis_key: axis.axis_key,
              label: axis.label,
              max_points: axis.max_points,
              sort_order: axis.sort_order,
            })),
          },
        },
        include: this.axisOnlyInclude(),
      });

      await this.createComponents(tx, updatedConfig, normalizedAxes);

      return (
        (await tx.annual_ranking_configs.findFirst({
          where: { annual_ranking_config_id: id },
          include: this.configInclude(),
        })) ?? updatedConfig
      );
    });
  }

  private normalizeRankingBudget(
    dto: AnnualRankingConfigWriteDto,
  ): NormalizedAnnualRankingAxis[] {
    const normalizedAxes = dto.axes?.length
      ? this.normalizeAxisBudget(dto.axes)
      : this.normalizeLegacyComponentBudget(dto.components ?? []);

    const axisSum = normalizedAxes.reduce(
      (sum, axis) => sum + axis.max_points,
      0,
    );

    if (axisSum !== dto.max_points) {
      throw new AppBadRequestException(
        ErrorCode.ANNUAL_RANKING_AXIS_SUM_INVALID,
        {
          maxPoints: String(dto.max_points),
          axisSum: String(axisSum),
        },
      );
    }

    for (const axis of normalizedAxes) {
      const componentSum = axis.components.reduce(
        (sum, component) => sum + component.max_points,
        0,
      );

      if (componentSum !== axis.max_points) {
        throw new AppBadRequestException(
          ErrorCode.ANNUAL_RANKING_AXIS_COMPONENT_SUM_INVALID,
          {
            axisKey: axis.axis_key,
            axisMaxPoints: String(axis.max_points),
            componentSum: String(componentSum),
          },
        );
      }
    }

    return normalizedAxes;
  }

  private normalizeAxisBudget(
    axes: CreateAnnualRankingAxisConfigDto[],
  ): NormalizedAnnualRankingAxis[] {
    const seenAxes = new Set<RankingAxisKey>();
    const seenComponents = new Set<RankingComponentKey>();

    return axes.map((axis, axisIndex) => {
      const axisKey = this.normalizeAxisKey(axis.axis_key);

      if (seenAxes.has(axisKey)) {
        throw new AppBadRequestException(
          ErrorCode.ANNUAL_RANKING_AXIS_SUM_INVALID,
          {
            maxPoints: String(0),
            axisSum: String(0),
          },
        );
      }
      seenAxes.add(axisKey);

      return {
        axis_key: axisKey,
        label: axis.label,
        max_points: axis.max_points,
        sort_order: axis.sort_order ?? axisIndex,
        components: axis.components.map((component, componentIndex) =>
          this.normalizeComponentForAxis(
            component,
            axisKey,
            seenComponents,
            componentIndex,
          ),
        ),
      };
    });
  }

  private normalizeLegacyComponentBudget(
    components: CreateAnnualRankingComponentConfigDto[],
  ): NormalizedAnnualRankingAxis[] {
    const seenComponents = new Set<RankingComponentKey>();
    const groupedAxes = new Map<
      RankingAxisKey,
      NormalizedAnnualRankingComponent[]
    >();

    for (const [componentIndex, component] of components.entries()) {
      const componentKey = this.normalizeComponentKey(component.component_key);
      const axisKey = getRankingComponentAxis(componentKey);

      if (seenComponents.has(componentKey)) {
        throw new AppBadRequestException(
          ErrorCode.ANNUAL_RANKING_COMPONENT_DUPLICATE,
          { componentKey },
        );
      }
      seenComponents.add(componentKey);

      const axisComponents = groupedAxes.get(axisKey) ?? [];
      axisComponents.push({
        component_key: componentKey,
        label: component.label,
        max_points: component.max_points,
        sort_order: component.sort_order ?? componentIndex,
      });
      groupedAxes.set(axisKey, axisComponents);
    }

    return Object.values(RANKING_AXES)
      .map((axis) => {
        const axisComponents =
          groupedAxes.get(axis.axis_key as RankingAxisKey) ?? [];

        return {
          axis_key: axis.axis_key as RankingAxisKey,
          label: axis.label,
          max_points: axisComponents.reduce(
            (sum, component) => sum + component.max_points,
            0,
          ),
          sort_order: axis.sort_order,
          components: axisComponents,
        };
      })
      .filter((axis) => axis.components.length > 0);
  }

  private normalizeComponentForAxis(
    component: CreateAnnualRankingComponentConfigDto,
    axisKey: RankingAxisKey,
    seenComponents: Set<RankingComponentKey>,
    componentIndex: number,
  ): NormalizedAnnualRankingComponent {
    const componentKey = this.normalizeComponentKey(component.component_key);

    if (seenComponents.has(componentKey)) {
      throw new AppBadRequestException(
        ErrorCode.ANNUAL_RANKING_COMPONENT_DUPLICATE,
        { componentKey },
      );
    }
    seenComponents.add(componentKey);

    if (getRankingComponentAxis(componentKey) !== axisKey) {
      throw new AppBadRequestException(
        ErrorCode.ANNUAL_RANKING_AXIS_COMPONENT_SUM_INVALID,
        {
          axisKey,
          axisMaxPoints: String(0),
          componentSum: String(0),
        },
      );
    }

    return {
      component_key: componentKey,
      label: component.label,
      max_points: component.max_points,
      sort_order: component.sort_order ?? componentIndex,
    };
  }

  private normalizeComponentKey(componentKey: string): RankingComponentKey {
    try {
      return normalizeRankingComponentKey(componentKey);
    } catch {
      throw new AppBadRequestException(
        ErrorCode.ANNUAL_RANKING_COMPONENT_UNKNOWN,
        { componentKey },
      );
    }
  }

  private normalizeAxisKey(axisKey: string): RankingAxisKey {
    if (this.isRankingAxisKey(axisKey)) {
      return axisKey;
    }

    throw new AppBadRequestException(
      ErrorCode.ANNUAL_RANKING_AXIS_SUM_INVALID,
      {
        maxPoints: String(0),
        axisSum: String(0),
      },
    );
  }

  private isRankingAxisKey(axisKey: string): axisKey is RankingAxisKey {
    return Object.prototype.hasOwnProperty.call(RANKING_AXES, axisKey);
  }

  private async createComponents(
    tx: {
      annual_ranking_component_configs: {
        createMany(args: { data: Array<Record<string, unknown>> }): unknown;
      };
    },
    config: CreatedConfigWithAxes,
    axes: NormalizedAnnualRankingAxis[],
  ) {
    const axisIdsByKey = new Map(
      (config.axes ?? []).map((axis) => [
        axis.axis_key,
        axis.annual_ranking_axis_config_id,
      ]),
    );
    const data = axes.flatMap((axis) => {
      const axisConfigId = axisIdsByKey.get(axis.axis_key);

      if (!axisConfigId) {
        throw new Error(`Missing annual ranking axis ${axis.axis_key}`);
      }

      return axis.components.map((component) => ({
        annual_ranking_config_id: config.annual_ranking_config_id,
        annual_ranking_axis_config_id: axisConfigId,
        component_key: component.component_key,
        label: component.label,
        max_points: component.max_points,
        sort_order: component.sort_order,
      }));
    });

    if (data.length === 0) {
      return;
    }

    await tx.annual_ranking_component_configs.createMany({ data });
  }

  private configInclude() {
    return {
      axes: {
        orderBy: [{ sort_order: 'asc' }, { axis_key: 'asc' }],
        include: {
          components: {
            orderBy: [{ sort_order: 'asc' }, { component_key: 'asc' }],
          },
        },
      },
      components: {
        orderBy: [{ sort_order: 'asc' }, { component_key: 'asc' }],
      },
    } as const;
  }

  private activeConfigInclude() {
    return {
      axes: {
        where: { active: true },
        orderBy: [{ sort_order: 'asc' }, { axis_key: 'asc' }],
        include: {
          components: {
            where: { active: true },
            orderBy: [{ sort_order: 'asc' }, { component_key: 'asc' }],
          },
        },
      },
      components: {
        where: { active: true },
        orderBy: [{ sort_order: 'asc' }, { component_key: 'asc' }],
      },
    } as const;
  }

  private axisOnlyInclude() {
    return {
      axes: {
        orderBy: [{ sort_order: 'asc' }, { axis_key: 'asc' }],
      },
    } as const;
  }
}

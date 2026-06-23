import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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
  unionId?: number;
  localFieldId?: number;
  ecclesiasticalYearId: number;
  clubTypeId: number;
}

export interface AnnualRankingConfigListFilters {
  unionId?: number;
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
  union_id?: number;
  local_field_id?: number;
  max_points: number;
  axes?: CreateAnnualRankingAxisConfigDto[];
  components?: CreateAnnualRankingComponentConfigDto[];
}

interface AnnualRankingConfigWriteScope {
  unionId: number | null;
  localFieldId: number | null;
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
        ...(filters.unionId !== undefined ? { union_id: filters.unionId } : {}),
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
        { union_id: 'asc' },
        { local_field_id: 'asc' },
        { ecclesiastical_year_id: 'desc' },
        { club_type_id: 'asc' },
      ],
    });
  }

  async create(dto: CreateAnnualRankingConfigDto, userId?: string) {
    const normalizedAxes = this.normalizeRankingBudget(dto);
    const scope = this.resolveWriteScope(dto);

    return this.prisma.$transaction(async (tx) => {
      await this.assertScopeExists(tx, scope);
      await this.assertLocalFieldNotOverriddenByUnion(tx, scope, {
        ecclesiasticalYearId: dto.ecclesiastical_year_id,
        clubTypeId: dto.club_type_id,
      });

      const existing = await tx.annual_ranking_configs.findFirst({
        where: {
          union_id: scope.unionId,
          local_field_id: scope.localFieldId,
          ecclesiastical_year_id: dto.ecclesiastical_year_id,
          club_type_id: dto.club_type_id,
        },
      });

      if (existing) {
        throw new AppConflictException(
          ErrorCode.ANNUAL_RANKING_CONFIG_CONFLICT,
          {
            unionId: String(scope.unionId ?? ''),
            localFieldId: String(scope.localFieldId ?? ''),
            ecclesiasticalYearId: String(dto.ecclesiastical_year_id),
            clubTypeId: String(dto.club_type_id),
          },
        );
      }

      const createdConfig = await tx.annual_ranking_configs.create({
        data: {
          union_id: scope.unionId,
          local_field_id: scope.localFieldId,
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

      if (scope.unionId != null) {
        await this.deactivateLocalFieldOverridesUnderUnion(tx, {
          unionId: scope.unionId,
          ecclesiasticalYearId: dto.ecclesiastical_year_id,
          clubTypeId: dto.club_type_id,
          exceptConfigId: createdConfig.annual_ranking_config_id,
        });
      }

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
    const config = await this.resolveEffectiveConfig(scope);

    if (!config) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_RANKING_CONFIG_NOT_FOUND,
        {
          unionId: String(scope.unionId ?? ''),
          localFieldId: String(scope.localFieldId ?? ''),
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

      await this.assertAnnualFolderComponentCanChange(
        tx,
        current,
        normalizedAxes,
      );

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

  async deactivate(id: string, userId?: string) {
    const current = await this.prisma.annual_ranking_configs.findFirst({
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

    return this.prisma.annual_ranking_configs.update({
      where: { annual_ranking_config_id: id },
      data: {
        active: false,
        updated_by: userId ?? null,
      },
    });
  }

  async getAnnualEvidenceFolderMaxPoints(
    scope: AnnualRankingConfigScope,
  ): Promise<number> {
    const config = await this.getByScope(scope);
    const maxPoints = this.extractAnnualFolderComponentMax(
      this.configToNormalizedAxes(config),
    );

    if (maxPoints == null) {
      throw new AppBadRequestException(
        ErrorCode.ANNUAL_RANKING_ANNUAL_FOLDER_COMPONENT_REQUIRED,
      );
    }

    return maxPoints;
  }

  private async resolveEffectiveConfig(scope: AnnualRankingConfigScope) {
    const include = this.activeConfigInclude();
    const commonWhere = {
      ecclesiastical_year_id: scope.ecclesiasticalYearId,
      club_type_id: scope.clubTypeId,
      active: true,
    };

    if (scope.unionId != null) {
      return this.prisma.annual_ranking_configs.findFirst({
        where: {
          ...commonWhere,
          union_id: scope.unionId,
          local_field_id: null,
        },
        include,
      });
    }

    if (scope.localFieldId == null) {
      throw new AppBadRequestException(ErrorCode.ANNUAL_RANKING_SCOPE_INVALID);
    }

    const localField = await this.prisma.local_fields.findUnique({
      where: { local_field_id: scope.localFieldId },
      select: { union_id: true },
    });

    if (!localField) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_RANKING_CONFIG_NOT_FOUND,
        {
          localFieldId: String(scope.localFieldId),
          ecclesiasticalYearId: String(scope.ecclesiasticalYearId),
          clubTypeId: String(scope.clubTypeId),
        },
      );
    }

    const unionConfig = await this.prisma.annual_ranking_configs.findFirst({
      where: {
        ...commonWhere,
        union_id: localField.union_id,
        local_field_id: null,
      },
      include,
    });

    if (unionConfig) return unionConfig;

    return this.prisma.annual_ranking_configs.findFirst({
      where: {
        ...commonWhere,
        union_id: null,
        local_field_id: scope.localFieldId,
      },
      include,
    });
  }

  private resolveWriteScope(
    dto: Pick<CreateAnnualRankingConfigDto, 'union_id' | 'local_field_id'>,
  ): AnnualRankingConfigWriteScope {
    const unionId = dto.union_id ?? null;
    const localFieldId = dto.local_field_id ?? null;

    if ((unionId != null) === (localFieldId != null)) {
      throw new AppBadRequestException(ErrorCode.ANNUAL_RANKING_SCOPE_INVALID);
    }

    return { unionId, localFieldId };
  }

  private async assertScopeExists(
    tx: Prisma.TransactionClient,
    scope: AnnualRankingConfigWriteScope,
  ): Promise<void> {
    if (scope.unionId != null) {
      const union = await tx.unions.findUnique({
        where: { union_id: scope.unionId },
        select: { union_id: true },
      });
      if (!union) {
        throw new AppNotFoundException(
          ErrorCode.ANNUAL_RANKING_CONFIG_NOT_FOUND,
          { unionId: String(scope.unionId) },
        );
      }
      return;
    }

    if (scope.localFieldId != null) {
      const localField = await tx.local_fields.findUnique({
        where: { local_field_id: scope.localFieldId },
        select: { local_field_id: true },
      });
      if (!localField) {
        throw new AppNotFoundException(
          ErrorCode.ANNUAL_RANKING_CONFIG_NOT_FOUND,
          { localFieldId: String(scope.localFieldId) },
        );
      }
    }
  }

  private async assertLocalFieldNotOverriddenByUnion(
    tx: Prisma.TransactionClient,
    scope: AnnualRankingConfigWriteScope,
    rankingScope: { ecclesiasticalYearId: number; clubTypeId: number },
  ): Promise<void> {
    if (scope.localFieldId == null) return;

    const localField = await tx.local_fields.findUnique({
      where: { local_field_id: scope.localFieldId },
      select: { union_id: true },
    });
    if (!localField) return;

    const unionConfig = await tx.annual_ranking_configs.findFirst({
      where: {
        union_id: localField.union_id,
        local_field_id: null,
        ecclesiastical_year_id: rankingScope.ecclesiasticalYearId,
        club_type_id: rankingScope.clubTypeId,
        active: true,
      },
      select: { annual_ranking_config_id: true },
    });

    if (unionConfig) {
      throw new AppConflictException(
        ErrorCode.ANNUAL_RANKING_UNION_SCOPE_CONFLICT,
      );
    }
  }

  private async deactivateLocalFieldOverridesUnderUnion(
    tx: Prisma.TransactionClient,
    input: {
      unionId: number;
      ecclesiasticalYearId: number;
      clubTypeId: number;
      exceptConfigId: string;
    },
  ): Promise<void> {
    await tx.annual_ranking_configs.updateMany({
      where: {
        annual_ranking_config_id: { not: input.exceptConfigId },
        union_id: null,
        local_field_id: { not: null },
        local_field: { union_id: input.unionId },
        ecclesiastical_year_id: input.ecclesiasticalYearId,
        club_type_id: input.clubTypeId,
        active: true,
      },
      data: { active: false },
    });
  }

  private async assertAnnualFolderComponentCanChange(
    tx: Prisma.TransactionClient,
    current: {
      union_id: number | null;
      local_field_id: number | null;
      ecclesiastical_year_id: number;
      club_type_id: number;
    },
    nextAxes: NormalizedAnnualRankingAxis[],
  ): Promise<void> {
    const currentConfig = await tx.annual_ranking_configs.findFirst({
      where: {
        union_id: current.union_id,
        local_field_id: current.local_field_id,
        ecclesiastical_year_id: current.ecclesiastical_year_id,
        club_type_id: current.club_type_id,
      },
      include: this.activeConfigInclude(),
    });

    const currentFolderMax = currentConfig
      ? this.extractAnnualFolderComponentMax(
          this.configToNormalizedAxes(currentConfig),
        )
      : null;
    const nextFolderMax = this.extractAnnualFolderComponentMax(nextAxes);

    if (nextFolderMax == null) {
      throw new AppBadRequestException(
        ErrorCode.ANNUAL_RANKING_ANNUAL_FOLDER_COMPONENT_REQUIRED,
      );
    }

    if (currentFolderMax === nextFolderMax) return;

    const folderCount = await tx.annual_folders.count({
      where: {
        folder_template: {
          ecclesiastical_year_id: current.ecclesiastical_year_id,
          club_type_id: current.club_type_id,
          ...(current.union_id != null
            ? {
                OR: [
                  { owner_union_id: current.union_id },
                  { owner_local_field: { union_id: current.union_id } },
                ],
              }
            : { owner_local_field_id: current.local_field_id ?? -1 }),
        },
      },
    });

    if (folderCount > 0) {
      throw new AppConflictException(
        ErrorCode.ANNUAL_RANKING_CONFIG_HAS_FOLDERS,
      );
    }
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

    if (this.extractAnnualFolderComponentMax(normalizedAxes) == null) {
      throw new AppBadRequestException(
        ErrorCode.ANNUAL_RANKING_ANNUAL_FOLDER_COMPONENT_REQUIRED,
      );
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
        const axisComponents = groupedAxes.get(axis.axis_key) ?? [];

        return {
          axis_key: axis.axis_key,
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

  private extractAnnualFolderComponentMax(
    axes: NormalizedAnnualRankingAxis[],
  ): number | null {
    for (const axis of axes) {
      const component = axis.components.find(
        (item) => item.component_key === 'annual_evidence_folder',
      );
      if (component) return component.max_points;
    }

    return null;
  }

  private configToNormalizedAxes(config: {
    axes?: Array<{
      axis_key: string;
      label: string;
      max_points: number;
      sort_order: number;
      components: Array<{
        component_key: string;
        label: string;
        max_points: number;
        sort_order: number;
      }>;
    }> | null;
    components?: Array<{
      component_key: string;
      label: string;
      max_points: number;
      sort_order: number;
    }> | null;
  }): NormalizedAnnualRankingAxis[] {
    const axes = config.axes ?? [];
    if (axes.length > 0) {
      return axes.map((axis) => ({
        axis_key: this.normalizeAxisKey(axis.axis_key),
        label: axis.label,
        max_points: axis.max_points,
        sort_order: axis.sort_order,
        components: axis.components.map((component) => ({
          component_key: this.normalizeComponentKey(component.component_key),
          label: component.label,
          max_points: component.max_points,
          sort_order: component.sort_order,
        })),
      }));
    }

    return this.normalizeLegacyComponentBudget(config.components ?? []);
  }

  private async createComponents(
    tx: Pick<Prisma.TransactionClient, 'annual_ranking_component_configs'>,
    config: CreatedConfigWithAxes,
    axes: NormalizedAnnualRankingAxis[],
  ) {
    const axisIdsByKey = new Map(
      (config.axes ?? []).map((axis) => [
        axis.axis_key,
        axis.annual_ranking_axis_config_id,
      ]),
    );
    const data: Prisma.annual_ranking_component_configsCreateManyInput[] =
      axes.flatMap((axis) => {
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
      union: {
        select: { union_id: true, name: true },
      },
      local_field: {
        select: { local_field_id: true, name: true, union_id: true },
      },
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
    } satisfies Prisma.annual_ranking_configsInclude;
  }

  private activeConfigInclude() {
    return {
      union: {
        select: { union_id: true, name: true },
      },
      local_field: {
        select: { local_field_id: true, name: true, union_id: true },
      },
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
    } satisfies Prisma.annual_ranking_configsInclude;
  }

  private axisOnlyInclude() {
    return {
      axes: {
        orderBy: [{ sort_order: 'asc' }, { axis_key: 'asc' }],
      },
    } satisfies Prisma.annual_ranking_configsInclude;
  }
}

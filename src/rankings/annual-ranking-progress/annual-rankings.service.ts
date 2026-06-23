import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppForbiddenException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { ResolvedAuthorizationProfile } from '../../common/services/authorization-context.service';
import { AnnualRankingConfigService } from './annual-ranking-config.service';
import {
  RankingTierCalculatorService,
  type DerivedRankingTier,
  type RankingTierInput,
} from './services/ranking-tier-calculator.service';
import {
  AnnualRankingScoreRegistryService,
  type AnnualRankingScoreContext,
  type AnnualRankingScoreResult,
} from './services/annual-ranking-score-registry.service';
import { normalizeRankingComponentKey } from './ranking-component-catalog';
import type {
  AnnualRankingProgressAxisDto,
  AnnualRankingProgressComponentDto,
  AnnualRankingProgressTierDto,
} from './dto/annual-ranking-progress-response.dto';
import type {
  AnnualRankingLeaderboardResponseDto,
  AnnualRankingLeaderboardRowDto,
} from './dto/annual-ranking-leaderboard-response.dto';

const GENERAL_RANKING_CATEGORY_ID = '00000000-0000-0000-0000-000000000000';

interface LeaderboardQuery {
  localFieldId: number;
  yearId: number;
  clubTypeId: number;
}

interface ConfiguredRankingComponent {
  component_key: string;
  label: string;
  max_points: number;
}

interface ConfiguredRankingAxis {
  axis_key: string;
  label: string;
  max_points: number;
  components: ConfiguredRankingComponent[];
}

type ComponentScoreMap = Record<string, AnnualRankingScoreResult>;

@Injectable()
export class AnnualRankingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: AnnualRankingConfigService,
    private readonly tierCalculator: RankingTierCalculatorService,
    private readonly scoreRegistry: AnnualRankingScoreRegistryService,
  ) {}

  async getLeaderboard(
    query: LeaderboardQuery,
    profile?: ResolvedAuthorizationProfile,
  ): Promise<AnnualRankingLeaderboardResponseDto> {
    this.assertCanReadLocalField(profile, query.localFieldId);

    const [config, tiers, rows, year] = await Promise.all([
      this.configService.getByScope({
        localFieldId: query.localFieldId,
        ecclesiasticalYearId: query.yearId,
        clubTypeId: query.clubTypeId,
      }),
      this.getActiveTiers(),
      this.prisma.club_annual_rankings.findMany({
        where: {
          club_type_id: query.clubTypeId,
          ecclesiastical_year_id: query.yearId,
          award_category_id: GENERAL_RANKING_CATEGORY_ID,
          OR: [
            { hierarchy_context: { local_field_id: query.localFieldId } },
            {
              hierarchy_context_id: null,
              club_enrollment: {
                club_section: {
                  clubs: { local_field_id: query.localFieldId },
                },
              },
            },
          ],
        },
        include: {
          hierarchy_context: {
            select: { local_field_id: true, union_id: true },
          },
          club_enrollment: {
            include: {
              club_section: {
                include: {
                  clubs: {
                    select: {
                      club_id: true,
                      name: true,
                      local_field_id: true,
                      local_fields: { select: { union_id: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.ecclesiastical_years.findUnique({
        where: { year_id: query.yearId },
        select: { start_date: true },
      }),
    ]);

    const componentsToScore = this.getConfiguredComponents(config);
    const mapped = await Promise.all(
      rows.map(async (row) => {
        const club = row.club_enrollment.club_section.clubs;
        const scoreMap = await this.scoreConfiguredComponents(
          componentsToScore,
          {
            clubEnrollmentId: row.club_enrollment_id,
            clubId: club?.club_id ?? 0,
            localFieldId:
              row.hierarchy_context?.local_field_id ??
              club?.local_field_id ??
              query.localFieldId,
            unionId:
              row.hierarchy_context?.union_id ??
              club?.local_fields?.union_id ??
              null,
            ecclesiasticalYearId: query.yearId,
            calendarYear: this.calendarYearFromStartDate(year?.start_date),
          },
        );
        const axes = this.buildAxisProgress(config.axes ?? [], scoreMap);
        const components =
          axes.length > 0
            ? axes.flatMap((axis) => axis.components)
            : this.buildComponentProgress(config.components ?? [], scoreMap);
        const currentPoints =
          axes.length > 0
            ? axes.reduce((sum, axis) => sum + axis.earned_points, 0)
            : components.reduce(
                (sum, component) => sum + component.earned_points,
                0,
              );
        const resolvedTier = this.tierCalculator.resolveTier({
          currentPoints,
          maxPoints: config.max_points,
          tiers,
        });

        return {
          rank_position: 0,
          club_enrollment_id: row.club_enrollment_id,
          club_id: club?.club_id ?? 0,
          club_name: club?.name ?? 'Club',
          club_type_id: row.club_type_id,
          ecclesiastical_year_id: row.ecclesiastical_year_id,
          local_field_id:
            row.hierarchy_context?.local_field_id ??
            club?.local_field_id ??
            null,
          current_points: currentPoints,
          max_points: config.max_points,
          progress_percentage: this.percentage(
            currentPoints,
            config.max_points,
          ),
          current_tier: this.toTierDto(resolvedTier.currentTier),
          next_tier: this.toTierDto(
            resolvedTier.nextTier,
            resolvedTier.pointsToNextTier,
          ),
          axes,
          components,
        };
      }),
    );

    const ranked = this.assignDenseRanks(mapped);

    return {
      data: ranked,
      total: ranked.length,
    };
  }

  private async getActiveTiers(): Promise<RankingTierInput[]> {
    const rows = await this.prisma.ranking_tiers.findMany({
      where: { active: true },
      orderBy: [{ sort_order: 'asc' }],
    });

    return rows.map((row) => ({
      name: row.name,
      slug: row.slug,
      bandPercentage: Number(row.band_percentage),
      order: row.sort_order,
    }));
  }

  private buildAxisProgress(
    axes: ConfiguredRankingAxis[],
    scoreMap: ComponentScoreMap,
  ): AnnualRankingProgressAxisDto[] {
    return axes.map((axis) => {
      const components = this.buildComponentProgress(axis.components, scoreMap);
      const earnedPoints = components.reduce(
        (sum, component) => sum + component.earned_points,
        0,
      );

      return {
        key: axis.axis_key,
        label: axis.label,
        earned_points: earnedPoints,
        max_points: axis.max_points,
        progress_percentage: this.percentage(earnedPoints, axis.max_points),
        components,
      };
    });
  }

  private buildComponentProgress(
    components: ConfiguredRankingComponent[],
    scoreMap: ComponentScoreMap,
  ): AnnualRankingProgressComponentDto[] {
    return components.map((component) => {
      const componentKey = this.canonicalComponentKey(component.component_key);
      const score = this.scoreFor(componentKey, scoreMap);
      const scorePct = this.scorePctFor(score);
      const maxPoints =
        score.max_points && score.max_points > 0
          ? score.max_points
          : component.max_points;
      const earnedPoints =
        score.earned_points ?? Math.round((scorePct / 100) * maxPoints);

      return {
        key: componentKey,
        label: component.label,
        earned_points: earnedPoints,
        max_points: maxPoints,
        progress_percentage: this.percentage(earnedPoints, maxPoints),
      };
    });
  }

  private scoreFor(
    key: string,
    scoreMap: ComponentScoreMap,
  ): AnnualRankingScoreResult {
    return (
      scoreMap[key] ?? {
        score_pct: 0,
        source_status: 'not_available',
        source: 'unsupported',
      }
    );
  }

  private scorePctFor(score: AnnualRankingScoreResult): number {
    return Math.max(0, Math.min(100, Number(score.score_pct ?? 0)));
  }

  private getConfiguredComponents(config: {
    axes?: ConfiguredRankingAxis[] | null;
    components?: ConfiguredRankingComponent[] | null;
  }): ConfiguredRankingComponent[] {
    const axes = config.axes ?? [];
    if (axes.length > 0) {
      return axes.flatMap((axis) => axis.components);
    }

    return config.components ?? [];
  }

  private async scoreConfiguredComponents(
    components: ConfiguredRankingComponent[],
    context: AnnualRankingScoreContext,
  ): Promise<ComponentScoreMap> {
    const entries = await Promise.all(
      components.map(async (component) => {
        const componentKey = this.canonicalComponentKey(
          component.component_key,
        );
        const result = await this.scoreRegistry.scoreComponent(
          { component_key: component.component_key, active: true },
          context,
        );

        return [componentKey, result] as const;
      }),
    );

    return Object.fromEntries(entries);
  }

  private canonicalComponentKey(componentKey: string): string {
    try {
      return normalizeRankingComponentKey(componentKey);
    } catch {
      return componentKey;
    }
  }

  private calendarYearFromStartDate(
    startDate: Date | string | null | undefined,
  ): number {
    if (startDate == null) return new Date().getUTCFullYear();
    return new Date(startDate).getUTCFullYear();
  }

  private assignDenseRanks(
    rows: Array<
      Omit<AnnualRankingLeaderboardRowDto, 'rank_position'> & {
        rank_position: number;
      }
    >,
  ): AnnualRankingLeaderboardRowDto[] {
    let currentRank = 0;
    let previousPoints: number | null = null;

    return [...rows]
      .sort((a, b) => b.current_points - a.current_points)
      .map((row) => {
        if (previousPoints === null || row.current_points !== previousPoints) {
          currentRank += 1;
          previousPoints = row.current_points;
        }

        return { ...row, rank_position: currentRank };
      });
  }

  private toTierDto(
    tier: DerivedRankingTier | null,
    pointsToReach?: number | null,
  ): AnnualRankingProgressTierDto | null {
    if (!tier) return null;

    return {
      name: tier.name,
      slug: tier.slug,
      from_points: tier.fromPoints,
      to_points: tier.toPoints,
      points_to_reach: pointsToReach ?? null,
    };
  }

  private percentage(value: number, max: number): number {
    if (max <= 0) return 0;
    return Math.round((value / max) * 10000) / 100;
  }

  private assertCanReadLocalField(
    profile: ResolvedAuthorizationProfile | undefined,
    localFieldId: number,
  ): void {
    if (!profile) return;

    const permissions = profile.authorization.effective.permissions;
    const hasGlobalAccess = profile.authorization.grants.global_roles.some(
      (grant) =>
        ['super-admin', 'admin'].includes(grant.role_name) ||
        grant.permissions.includes('rankings:read_global'),
    );

    if (hasGlobalAccess || permissions.includes('rankings:read_global')) return;

    const activeAssignmentId =
      profile.authorization.active_assignment.assignment_id;
    const activeAssignment =
      profile.authorization.grants.club_assignments.find(
        (grant) => grant.assignment_id === activeAssignmentId,
      ) ?? null;

    const readableLocalFieldIds = [
      this.toNumericScopeId(
        profile.authorization.effective.scope.global.local_field?.id,
      ),
      this.toNumericScopeId(profile.profile.local_field_id),
      this.toNumericScopeId(activeAssignment?.scope.local_field?.id),
    ].filter((id): id is number => id !== null);

    if (readableLocalFieldIds.includes(localFieldId)) return;

    throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
  }

  private toNumericScopeId(
    value: number | string | null | undefined,
  ): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
}

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
import type {
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

interface RankingScoreSource {
  folder_score_pct: unknown;
  finance_score_pct: unknown;
  camporee_score_pct: unknown;
  evidence_score_pct: unknown;
}

@Injectable()
export class AnnualRankingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: AnnualRankingConfigService,
    private readonly tierCalculator: RankingTierCalculatorService,
  ) {}

  async getLeaderboard(
    query: LeaderboardQuery,
    profile?: ResolvedAuthorizationProfile,
  ): Promise<AnnualRankingLeaderboardResponseDto> {
    this.assertCanReadLocalField(profile, query.localFieldId);

    const [config, tiers, rows] = await Promise.all([
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
          hierarchy_context: { select: { local_field_id: true } },
          club_enrollment: {
            include: {
              club_section: {
                include: {
                  clubs: {
                    select: {
                      club_id: true,
                      name: true,
                      local_field_id: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const mapped = rows.map((row) => {
      const components = this.buildComponentProgress(config.components, row);
      const currentPoints = components.reduce(
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
        club_id: row.club_enrollment.club_section.clubs?.club_id ?? 0,
        club_name: row.club_enrollment.club_section.clubs?.name ?? 'Club',
        club_type_id: row.club_type_id,
        ecclesiastical_year_id: row.ecclesiastical_year_id,
        local_field_id:
          row.hierarchy_context?.local_field_id ??
          row.club_enrollment.club_section.clubs?.local_field_id ??
          null,
        current_points: currentPoints,
        max_points: config.max_points,
        progress_percentage: this.percentage(currentPoints, config.max_points),
        current_tier: this.toTierDto(resolvedTier.currentTier),
        next_tier: this.toTierDto(
          resolvedTier.nextTier,
          resolvedTier.pointsToNextTier,
        ),
        components,
      };
    });

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

  private buildComponentProgress(
    components: Array<{
      component_key: string;
      label: string;
      max_points: number;
    }>,
    ranking: RankingScoreSource,
  ): AnnualRankingProgressComponentDto[] {
    return components.map((component) => {
      const scorePct = this.scorePctFor(component.component_key, ranking);
      const earnedPoints = Math.round((scorePct / 100) * component.max_points);

      return {
        key: component.component_key,
        label: component.label,
        earned_points: earnedPoints,
        max_points: component.max_points,
        progress_percentage: this.percentage(earnedPoints, component.max_points),
      };
    });
  }

  private scorePctFor(key: string, ranking: RankingScoreSource): number {
    const scoreMap: Record<string, unknown> = {
      annual_folder: ranking.folder_score_pct,
      folder: ranking.folder_score_pct,
      finance: ranking.finance_score_pct,
      camporee: ranking.camporee_score_pct,
      evidence: ranking.evidence_score_pct,
    };

    return Math.max(0, Math.min(100, Number(scoreMap[key] ?? 0)));
  }

  private assignDenseRanks(
    rows: Omit<AnnualRankingLeaderboardRowDto, 'rank_position'> &
      { rank_position: number }[],
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

  private toNumericScopeId(value: number | string | null | undefined): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
}

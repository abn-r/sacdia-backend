import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppForbiddenException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { ResolvedAuthorizationProfile } from '../../common/services/authorization-context.service';
import {
  assertLocalFieldInActorScope,
  resolveActorTerritoryScope,
} from '../../common/authorization/actor-territory-scope';
import { AnnualRankingConfigService } from './annual-ranking-config.service';
import {
  RankingTierCalculatorService,
  type DerivedRankingTier,
  type RankingTierInput,
} from './services/ranking-tier-calculator.service';
import { AnnualRankingPointsService } from './services/annual-ranking-points.service';
import type { AnnualRankingProgressTierDto } from './dto/annual-ranking-progress-response.dto';
import type {
  AnnualRankingLeaderboardResponseDto,
  AnnualRankingLeaderboardRowDto,
} from './dto/annual-ranking-leaderboard-response.dto';
import { GlobalRole } from '../../common/authorization/roles';

const GENERAL_RANKING_CATEGORY_ID = '00000000-0000-0000-0000-000000000000';

interface LeaderboardQuery {
  localFieldId: number;
  yearId: number;
  clubTypeId: number;
}

@Injectable()
export class AnnualRankingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: AnnualRankingConfigService,
    private readonly tierCalculator: RankingTierCalculatorService,
    private readonly points: AnnualRankingPointsService,
  ) {}

  async getLeaderboard(
    query: LeaderboardQuery,
    profile?: ResolvedAuthorizationProfile,
  ): Promise<AnnualRankingLeaderboardResponseDto> {
    await this.assertCanReadLocalField(profile, query.localFieldId);

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

    const mapped = await Promise.all(
      rows.map(async (row) => {
        const club = row.club_enrollment.club_section.clubs;
        const { axes, components, currentPoints } =
          await this.points.computePoints(config, {
            clubEnrollmentId: row.club_enrollment_id,
            clubId: club?.club_id ?? 0,
            clubSectionId:
              row.club_enrollment.club_section.club_section_id ?? 0,
            localFieldId:
              row.hierarchy_context?.local_field_id ??
              club?.local_field_id ??
              query.localFieldId,
            unionId:
              row.hierarchy_context?.union_id ??
              club?.local_fields?.union_id ??
              null,
            ecclesiasticalYearId: query.yearId,
            calendarYear: this.points.calendarYearFromStartDate(
              year?.start_date,
            ),
          });
        const resolvedTier = this.tierCalculator.resolveTier({
          currentPoints,
          maxPoints: config.max_points,
          tiers,
        });

        return {
          rank_position: 0,
          club_enrollment_id: row.club_enrollment_id,
          club_section_id: row.club_enrollment.club_section.club_section_id,
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
          progress_percentage: this.points.percentage(
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

  private async assertCanReadLocalField(
    profile: ResolvedAuthorizationProfile | undefined,
    localFieldId: number,
  ): Promise<void> {
    if (!profile) return;

    const permissions = profile.authorization.effective.permissions;
    const hasGlobalAccess = profile.authorization.grants.global_roles.some(
      (grant) =>
        ([GlobalRole.SUPER_ADMIN, GlobalRole.ADMIN] as string[]).includes(
          grant.role_name,
        ) || grant.permissions.includes('section_rankings:read_global'),
    );

    if (hasGlobalAccess || permissions.includes('section_rankings:read_global'))
      return;

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

    // Union and division leadership read every local field of their territory.
    const territory = resolveActorTerritoryScope(profile);
    if (territory.level === 'union' || territory.level === 'division') {
      await assertLocalFieldInActorScope(this.prisma, localFieldId, territory);
      return;
    }

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

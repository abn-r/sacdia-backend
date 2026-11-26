import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AppForbiddenException,
  AppNotFoundException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { ResolvedAuthorizationProfile } from '../../common/services/authorization-context.service';
import { AnnualRankingConfigService } from './annual-ranking-config.service';
import {
  RankingTierCalculatorService,
  type DerivedRankingTier,
  type RankingTierInput,
} from './services/ranking-tier-calculator.service';
import { AnnualRankingPointsService } from './services/annual-ranking-points.service';
import type {
  AnnualRankingProgressPendingItemDto,
  AnnualRankingProgressResponseDto,
  AnnualRankingProgressTierDto,
} from './dto/annual-ranking-progress-response.dto';
import { GlobalRole } from '../../common/authorization/roles';

@Injectable()
export class AnnualRankingProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: AnnualRankingConfigService,
    private readonly tierCalculator: RankingTierCalculatorService,
    private readonly points: AnnualRankingPointsService,
  ) {}

  async getSectionProgress(
    sectionId: number,
    yearId: number,
    profile?: ResolvedAuthorizationProfile,
  ): Promise<AnnualRankingProgressResponseDto> {
    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: {
        club_section_id: true,
        club_type_id: true,
        club_types: {
          select: {
            club_type_id: true,
            name: true,
          },
        },
        clubs: {
          select: {
            club_id: true,
            name: true,
            local_field_id: true,
            local_fields: { select: { union_id: true } },
          },
        },
      },
    });

    if (!section) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_RANKING_SECTION_NOT_FOUND,
        {
          sectionId: String(sectionId),
        },
      );
    }

    if (!section.clubs) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_RANKING_SECTION_NO_CLUB, {
        sectionId: String(sectionId),
      });
    }

    this.assertCanReadSection(profile, {
      sectionId,
      clubId: section.clubs.club_id,
      localFieldId: section.clubs.local_field_id,
    });

    const [config, tiers, enrollment, year] = await Promise.all([
      this.configService.getByScope({
        localFieldId: section.clubs.local_field_id,
        ecclesiasticalYearId: yearId,
        clubTypeId: section.club_type_id,
      }),
      this.getActiveTiers(),
      this.prisma.club_enrollments.findFirst({
        where: {
          club_section_id: sectionId,
          ecclesiastical_year_id: yearId,
        },
        select: { club_enrollment_id: true },
      }),
      this.prisma.ecclesiastical_years.findUnique({
        where: { year_id: yearId },
        select: { start_date: true },
      }),
    ]);

    const { axes, components, currentPoints } = await this.points.computePoints(
      config,
      enrollment
        ? {
            clubEnrollmentId: enrollment.club_enrollment_id,
            clubId: section.clubs.club_id,
            clubSectionId: section.club_section_id,
            localFieldId: section.clubs.local_field_id,
            unionId: section.clubs.local_fields?.union_id ?? null,
            ecclesiasticalYearId: yearId,
            calendarYear: this.points.calendarYearFromStartDate(
              year?.start_date,
            ),
          }
        : null,
    );
    const progressPercentage = this.points.percentage(
      currentPoints,
      config.max_points,
    );
    const resolvedTier = this.tierCalculator.resolveTier({
      currentPoints,
      maxPoints: config.max_points,
      tiers,
    });

    const pendingItems = enrollment
      ? await this.getPendingItems(enrollment.club_enrollment_id)
      : [];

    return {
      section_id: section.club_section_id,
      club_id: section.clubs.club_id,
      club_name: section.clubs.name ?? 'Club',
      club_type: {
        club_type_id: section.club_types.club_type_id,
        name: section.club_types.name,
      },
      year: {
        ecclesiastical_year_id: yearId,
      },
      current_points: currentPoints,
      max_points: config.max_points,
      progress_percentage: progressPercentage,
      current_tier: this.toTierDto(resolvedTier.currentTier),
      next_tier: this.toTierDto(
        resolvedTier.nextTier,
        resolvedTier.pointsToNextTier,
      ),
      axes,
      components,
      pending_items: pendingItems,
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

  private async getPendingItems(
    clubEnrollmentId: string,
  ): Promise<AnnualRankingProgressPendingItemDto[]> {
    const folder = await this.prisma.annual_folders.findUnique({
      where: { club_enrollment_id: clubEnrollmentId },
      select: {
        evaluations: {
          where: {
            status: {
              in: ['PENDING', 'SUBMITTED', 'PREAPPROVED_LF'],
            },
          },
          select: {
            status: true,
            section: {
              select: {
                name: true,
              },
            },
          },
          orderBy: [{ modified_at: 'desc' }],
          take: 10,
        },
      },
    });

    return (folder?.evaluations ?? []).map((evaluation) => ({
      type: 'annual_folder_section',
      title: evaluation.section.name,
      status: this.toPendingStatusKey(String(evaluation.status)),
      due_date: null,
      action_label: 'Ver evidencia',
    }));
  }

  private toPendingStatusKey(status: string): string {
    const statusMap: Record<string, string> = {
      PENDING: 'pending_delivery',
      SUBMITTED: 'pending_validation',
      PREAPPROVED_LF: 'pending_union_validation',
    };

    return statusMap[status] ?? 'pending_review';
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

  private assertCanReadSection(
    profile: ResolvedAuthorizationProfile | undefined,
    scope: { sectionId: number; clubId: number; localFieldId: number },
  ): void {
    if (!profile) return;

    const permissions = profile.authorization.effective.permissions;
    const hasGlobalAccess = profile.authorization.grants.global_roles.some(
      (grant) =>
        ([GlobalRole.SUPER_ADMIN, GlobalRole.ADMIN] as string[]).includes(
          grant.role_name,
        ) || grant.permissions.includes('section_rankings:read_global'),
    );
    if (
      hasGlobalAccess ||
      permissions.includes('section_rankings:read_global')
    ) {
      return;
    }

    const globalLocalFieldId = this.toNumericScopeId(
      profile.authorization.effective.scope.global.local_field?.id,
    );
    if (
      globalLocalFieldId === scope.localFieldId &&
      permissions.includes('section_rankings:read_lf')
    ) {
      return;
    }

    const hasClubAccess = profile.authorization.grants.club_assignments.some(
      (grant) => {
        const canReadRanking =
          grant.permissions.includes('rankings:read') ||
          grant.permissions.includes('section_rankings:read_club');

        if (!canReadRanking) return false;

        return (
          grant.club.club_id === scope.clubId ||
          grant.section.club_section_id === scope.sectionId
        );
      },
    );
    if (hasClubAccess) return;

    throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
  }

  private toNumericScopeId(value: number | string | undefined): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AppForbiddenException,
  AppNotFoundException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { ResolvedAuthorizationProfile } from '../../common/services/authorization-context.service';
import { SectionRankingResponseDto } from './dto/section-ranking-response.dto';
import { PaginatedResponse } from '../member-rankings/member-rankings.service';
import { MemberRankingResponseDto } from '../member-rankings/dto/member-ranking-response.dto';

interface ListParams {
  profile: ResolvedAuthorizationProfile;
  clubId?: number;
  yearId: number;
  page: number;
  limit: number;
}

@Injectable()
export class SectionRankingsService {
  private readonly logger = new Logger(SectionRankingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ========================================
  // LIST — paginated, RBAC scope-filtered
  // ========================================

  async list(
    params: ListParams,
  ): Promise<PaginatedResponse<SectionRankingResponseDto>> {
    const safeLimit = Math.min(Math.max(params.limit, 1), 100); // clamp [1, 100]
    const safePage = Math.max(params.page, 1); // clamp >= 1
    const skip = (safePage - 1) * safeLimit;

    const where = this.buildScopeWhere(params.profile, {
      yearId: params.yearId,
      clubId: params.clubId,
    });
    this.logger.log(
      `list: year=${params.yearId} page=${safePage} limit=${safeLimit}`,
    );

    const [rows, total] = await Promise.all([
      this.prisma.sectionRanking.findMany({
        where,
        skip,
        take: safeLimit,
        orderBy: [{ rank_position: { sort: 'asc', nulls: 'last' } }],
        include: {
          club_section: { select: { name: true } },
        },
      }),
      this.prisma.sectionRanking.count({ where }),
    ]);

    return {
      data: rows.map((r) => SectionRankingResponseDto.fromSectionRanking(r)),
      total,
      page: safePage,
      limit: safeLimit,
    };
  }

  // ========================================
  // GET MEMBERS — drill-down into a section
  // ========================================

  async getMembers(
    sectionId: number,
    yearId: number,
    profile: ResolvedAuthorizationProfile,
  ): Promise<MemberRankingResponseDto[]> {
    // 1. Load the section to validate scope
    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      include: {
        clubs: { select: { club_id: true, local_field_id: true } },
      },
    });

    if (!section) {
      throw new AppNotFoundException(ErrorCode.MEMBER_RANKING_NOT_FOUND);
    }

    if (!section.clubs) {
      this.logger.warn({
        msg: '[section-rankings] orphan section',
        sectionId,
        ecclesiastical_year_id: yearId,
      });
      throw new AppNotFoundException(ErrorCode.MEMBER_RANKING_NOT_FOUND);
    }

    // 2. Validate caller can see this section's club
    this.validateSectionScope(profile, {
      club_section_id: sectionId,
      club_id: section.clubs.club_id,
      club: {
        club_id: section.clubs.club_id,
        local_field_id: section.clubs.local_field_id,
      },
    });

    // 3. Fetch enrollment rankings for this section, ordered by rank_position ASC NULLS LAST
    const rows = await this.prisma.enrollmentRanking.findMany({
      where: {
        club_section_id: sectionId,
        ecclesiastical_year_id: yearId,
      },
      orderBy: [{ rank_position: { sort: 'asc', nulls: 'last' } }],
      include: {
        user: { select: { name: true } },
        club_section: { select: { name: true } },
        awarded_category: true,
      },
    });

    return rows.map((r) => MemberRankingResponseDto.fromEnrollmentRanking(r));
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  /**
   * Maps caller RBAC permissions (from ResolvedAuthorizationProfile) to a
   * Prisma WHERE clause for the section_rankings table.
   *
   * Permission tiers (highest wins — no read_self for sections):
   *   section_rankings:read_global  → no restriction
   *   section_rankings:read_lf      → clubs in caller's local field(s)
   *   section_rankings:read_club    → caller's club(s) only
   *   Else                          → throw MEMBER_RANKING_SCOPE_DENIED
   */
  private buildScopeWhere(
    profile: ResolvedAuthorizationProfile,
    filters: { yearId: number; clubId?: number },
  ): Prisma.SectionRankingWhereInput {
    const { yearId, clubId } = filters;
    const perms = profile.authorization.effective.permissions;

    const yearFilter: Prisma.SectionRankingWhereInput = {
      ecclesiastical_year_id: yearId,
    };

    // Global access — no restriction
    if (perms.includes('section_rankings:read_global')) {
      return {
        ...yearFilter,
        ...(clubId !== undefined ? { club_id: clubId } : {}),
      };
    }

    // Local-field access — restrict to clubs in caller's local fields
    if (perms.includes('section_rankings:read_lf')) {
      const globalLfId =
        profile.authorization.effective.scope.global.local_field?.id;
      const assignmentLfIds = profile.authorization.grants.club_assignments
        .map((g) => g.scope.local_field?.id)
        .filter((id): id is number => typeof id === 'number');

      const lfIds = Array.from(
        new Set([
          ...(typeof globalLfId === 'number' ? [globalLfId] : []),
          ...assignmentLfIds,
        ]),
      );

      if (lfIds.length === 0) {
        // Explicit deny: caller has read_lf perm but no LF assigned
        return { ecclesiastical_year_id: -1 };
      }

      return {
        ...yearFilter,
        club: { local_field_id: { in: lfIds } },
        ...(clubId !== undefined ? { club_id: clubId } : {}),
      };
    }

    // Club access — restrict to caller's clubs
    if (perms.includes('section_rankings:read_club')) {
      const clubIds = profile.authorization.grants.club_assignments.map(
        (g) => g.club.club_id,
      );

      const effectiveClubIds =
        clubId !== undefined
          ? [clubId].filter((id) => clubIds.includes(id))
          : clubIds;

      if (effectiveClubIds.length === 0) {
        // Requested club not in caller's scope — guarantee zero matches.
        return { ecclesiastical_year_id: -1 };
      }

      return {
        ...yearFilter,
        club_id: { in: effectiveClubIds },
      };
    }

    // No valid section_rankings permission — deny
    throw new AppForbiddenException(ErrorCode.MEMBER_RANKING_SCOPE_DENIED);
  }

  /**
   * Validates that the caller has scope access to see the given section
   * (for the getMembers drill-down endpoint).
   * Throws AppForbiddenException(MEMBER_RANKING_SCOPE_DENIED) on deny.
   */
  private validateSectionScope(
    profile: ResolvedAuthorizationProfile,
    section: {
      club_section_id: number;
      club_id: number;
      club: { club_id: number; local_field_id: number | null } | null;
    },
  ): void {
    const perms = profile.authorization.effective.permissions;

    if (perms.includes('section_rankings:read_global')) return;

    if (perms.includes('section_rankings:read_lf')) {
      const rowLfId = section.club?.local_field_id ?? null;

      const globalLfId =
        profile.authorization.effective.scope.global.local_field?.id;
      const assignmentLfIds = profile.authorization.grants.club_assignments
        .map((g) => g.scope.local_field?.id)
        .filter((id): id is number => typeof id === 'number');

      const callerLfIds = new Set([
        ...(typeof globalLfId === 'number' ? [globalLfId] : []),
        ...assignmentLfIds,
      ]);

      if (rowLfId !== null && callerLfIds.has(rowLfId)) return;
      throw new AppForbiddenException(ErrorCode.MEMBER_RANKING_SCOPE_DENIED);
    }

    if (perms.includes('section_rankings:read_club')) {
      const clubIds = profile.authorization.grants.club_assignments.map(
        (g) => g.club.club_id,
      );
      if (clubIds.includes(section.club_id)) return;
      throw new AppForbiddenException(ErrorCode.MEMBER_RANKING_SCOPE_DENIED);
    }

    // No valid section_rankings permission — deny
    throw new AppForbiddenException(ErrorCode.MEMBER_RANKING_SCOPE_DENIED);
  }
}

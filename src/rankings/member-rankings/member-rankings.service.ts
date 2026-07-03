import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import {
  AppBadRequestException,
  AppForbiddenException,
  AppNotFoundException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { MemberRankingResponseDto } from './dto/member-ranking-response.dto';
import {
  MemberBreakdownDto,
  ClassBreakdownDto,
  InvestitureBreakdownDto,
  CamporeeBreakdownDto,
} from './dto/member-breakdown.dto';
import {
  MemberMyRankingDto,
  AnonymizedTopNEntryDto,
  VisibilityMode,
} from './dto/member-my-ranking.dto';
import { EnrollmentWeightsResolverService } from './services/enrollment-weights-resolver.service';
import { EnrollmentClubResolverService } from './services/enrollment-club-resolver.service';
import { RankingsService } from '../../annual-folders/rankings.service';
import { ResolvedAuthorizationProfile } from '../../common/services/authorization-context.service';
import { InstitutionalHierarchyService } from '../../common/services/institutional-hierarchy.service';
import { ClassRequirementEligibilityService } from '../../classes/class-requirement-eligibility.service';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

interface ListParams {
  profile: ResolvedAuthorizationProfile;
  clubId?: number;
  sectionId?: number;
  yearId: number;
  page: number;
  limit: number;
}

@Injectable()
export class MemberRankingsService {
  private readonly logger = new Logger(MemberRankingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemConfig: SystemConfigService,
    private readonly rankingsService: RankingsService,
    private readonly weightsResolver: EnrollmentWeightsResolverService,
    private readonly clubResolver: EnrollmentClubResolverService,
    private readonly hierarchy: InstitutionalHierarchyService,
    private readonly requirementEligibility: ClassRequirementEligibilityService,
  ) {}

  // ========================================
  // LIST — paginated, RBAC scope-filtered
  // ========================================

  async list(
    params: ListParams,
  ): Promise<PaginatedResponse<MemberRankingResponseDto>> {
    const safeLimit = Math.min(Math.max(params.limit, 1), 100); // clamp [1, 100]
    const safePage = Math.max(params.page, 1); // clamp >= 1
    const skip = (safePage - 1) * safeLimit;

    const where = this.buildScopeWhere(params.profile, {
      yearId: params.yearId,
      clubId: params.clubId,
      sectionId: params.sectionId,
    });
    this.logger.log(
      `list: year=${params.yearId} page=${safePage} limit=${safeLimit}`,
    );

    const [rows, total] = await Promise.all([
      this.prisma.enrollmentRanking.findMany({
        where,
        skip,
        take: safeLimit,
        orderBy: { rank_position: 'asc' },
        include: {
          user: { select: { name: true } },
          club_section: { select: { name: true } },
          awarded_category: true,
        },
      }),
      this.prisma.enrollmentRanking.count({ where }),
    ]);

    return {
      data: rows.map((r) => MemberRankingResponseDto.fromEnrollmentRanking(r)),
      total,
      page: safePage,
      limit: safeLimit,
    };
  }

  // ========================================
  // GET MY RANKING — visibility-gated
  // ========================================

  async getMyRanking(
    userId: string,
    yearId: number,
  ): Promise<MemberMyRankingDto> {
    const visibility =
      ((await this.systemConfig.get(
        'member_ranking.member_visibility',
      )) as VisibilityMode | null) ?? 'self_only';

    if (visibility === 'hidden') {
      this.logger.warn(`getMyRanking: visibility=hidden for user=${userId}`);
      throw new AppForbiddenException(ErrorCode.MEMBER_RANKING_HIDDEN);
    }

    const own = await this.prisma.enrollmentRanking.findFirst({
      where: { user_id: userId, ecclesiastical_year_id: yearId },
      orderBy: { rank_position: 'asc' },
      include: {
        user: { select: { name: true } },
        club_section: { select: { name: true } },
        awarded_category: true,
      },
    });

    const memberDto = own
      ? MemberRankingResponseDto.fromEnrollmentRanking(own)
      : null;

    // COUNT of members in the same section + year (meta info, not anonymity-protected)
    const totalInSection =
      own?.club_section_id != null
        ? await this.prisma.enrollmentRanking.count({
            where: {
              club_section_id: own.club_section_id,
              ecclesiastical_year_id: yearId,
            },
          })
        : 0;

    let topN: AnonymizedTopNEntryDto[] | undefined;

    if (visibility === 'self_and_top_n' && own) {
      const nRaw = await this.systemConfig.get('member_ranking.top_n');
      const n = nRaw ? Number(nRaw) : 5;

      const topRows = await this.prisma.enrollmentRanking.findMany({
        where: {
          club_id: own.club_id,
          ecclesiastical_year_id: yearId,
          composite_score_pct: { not: null },
        },
        orderBy: { rank_position: 'asc' },
        take: n,
      });

      // Q1.a: anonymized — never expose real names
      topN = topRows.map((r, idx) => ({
        member_name: `Miembro #${idx + 1}`,
        composite_score_pct:
          r.composite_score_pct !== null ? Number(r.composite_score_pct) : null,
        rank_position: r.rank_position,
      }));
    }

    return {
      member: memberDto,
      visibility_mode: visibility,
      total_in_section: totalInSection,
      top_n: topN,
    };
  }

  // ========================================
  // GET BREAKDOWN
  // ========================================

  async getBreakdown(
    enrollmentId: number,
    yearId: number,
    profile: ResolvedAuthorizationProfile,
  ): Promise<MemberBreakdownDto> {
    // 1. Load the ranking row — include club.local_field_id for read_lf scope check
    const row = await this.prisma.enrollmentRanking.findFirst({
      where: {
        enrollment_id: enrollmentId,
        ecclesiastical_year_id: yearId,
      },
      include: {
        user: { select: { name: true } },
        club_section: { select: { club_section_id: true, name: true } },
        club: { select: { club_id: true, local_field_id: true } },
        awarded_category: true,
      },
    });

    if (!row) {
      this.logger.warn(
        `getBreakdown: no ranking row for enrollmentId=${enrollmentId} year=${yearId}`,
      );
      throw new AppNotFoundException(ErrorCode.MEMBER_RANKING_NOT_FOUND);
    }

    // 2. Validate scope — caller must be able to see this enrollment
    this.validateBreakdownScope(profile, row);

    // 3. Load weights applied
    const enrollment = await this.prisma.enrollments.findUnique({
      where: { enrollment_id: enrollmentId },
      include: {
        classes: { select: { club_type_id: true } },
      },
    });

    const weights = enrollment
      ? await this.weightsResolver.resolve({
          clubTypeId: (enrollment as any).classes?.club_type_id ?? null,
          ecclesiasticalYearId: yearId,
        })
      : {
          class_pct: 0,
          investiture_pct: 0,
          camporee_pct: 0,
          source: 'unknown',
        };

    // 4. Build sub-breakdowns from raw DB data
    const classBreakdown = await this.buildClassBreakdown(
      enrollmentId,
      row.club_id,
      yearId,
    );
    const investitureBreakdown =
      await this.buildInvestitureBreakdown(enrollmentId);
    const camporeeBreakdown = await this.buildCamporeeBreakdown(
      enrollmentId,
      row.user_id,
      row.club_id,
      yearId,
      row.hierarchy_context_id ?? null,
    );

    const base = MemberRankingResponseDto.fromEnrollmentRanking(row);

    return {
      ...base,
      class_breakdown: classBreakdown,
      investiture_breakdown: investitureBreakdown,
      camporee_breakdown: camporeeBreakdown,
      weights: {
        class_pct: weights.class_pct,
        investiture_pct: weights.investiture_pct,
        camporee_pct: weights.camporee_pct,
        source: weights.source,
      },
    };
  }

  // ========================================
  // TRIGGER RECALCULATE
  // ========================================

  async triggerRecalculate(
    yearId: number,
    triggeredBy: string,
    clubId?: number,
    mode: 'full' | 'delta' = 'full',
  ): Promise<{
    triggered: boolean;
    ecclesiastical_year_id: number;
    club_id?: number;
    mode: string;
  }> {
    const enabled = await this.systemConfig.get(
      'member_ranking.recalculation_enabled',
    );

    if (enabled === 'false') {
      this.logger.warn(
        `triggerRecalculate: kill-switch active — recalculation disabled for year=${yearId}`,
      );
      throw new AppBadRequestException(ErrorCode.RECALCULATION_DISABLED);
    }

    this.logger.log({
      msg: '[member-rankings] recalculate triggered',
      user_id: triggeredBy,
      year_id: yearId,
      club_id: clubId ?? null,
      mode,
    });

    // Delegate to RankingsService.recalculateAll which covers both
    // enrollment rankings and section aggregates in the correct order.
    // mode is threaded through to recalculateEnrollmentRankings only —
    // club rankings (step 1) and section aggregates (step 3) always run full.
    await this.rankingsService.recalculateAll(yearId, mode);

    return {
      triggered: true,
      ecclesiastical_year_id: yearId,
      mode,
      ...(clubId !== undefined ? { club_id: clubId } : {}),
    };
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  /**
   * Maps caller RBAC permissions (from ResolvedAuthorizationProfile) to a
   * Prisma WHERE clause.
   *
   * Permission tiers (highest wins):
   *   member_rankings:read_global  → no restriction (all clubs)
   *   member_rankings:read_lf      → clubs in caller's local field(s)
   *   member_rankings:read_club    → caller's club(s) only
   *   member_rankings:read_section → caller's section(s) only
   *   member_rankings:read_self    → caller's own user_id only
   *
   * Permission list is taken from profile.authorization.effective.permissions
   * (the flat union of global + active-club-assignment permissions set by
   * AuthorizationContextService). Club/section/local-field IDs are extracted
   * from profile.authorization.grants.club_assignments and
   * profile.authorization.effective.scope.global.
   */
  private buildScopeWhere(
    profile: ResolvedAuthorizationProfile,
    filters: { yearId: number; clubId?: number; sectionId?: number },
  ): Prisma.EnrollmentRankingWhereInput {
    const { yearId, clubId, sectionId } = filters;
    const perms = profile.authorization.effective.permissions;

    const yearFilter: Prisma.EnrollmentRankingWhereInput = {
      ecclesiastical_year_id: yearId,
    };

    // Global access — no restriction on who/where
    if (perms.includes('member_rankings:read_global')) {
      return {
        ...yearFilter,
        ...(clubId !== undefined ? { club_id: clubId } : {}),
        ...(sectionId !== undefined ? { club_section_id: sectionId } : {}),
      };
    }

    // Local-field access — restrict to clubs belonging to caller's local fields.
    // Collect local field IDs from:
    //   1. Global scope (for LF-level global roles)
    //   2. Each club assignment's territorial scope
    if (perms.includes('member_rankings:read_lf')) {
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
        ...(sectionId !== undefined ? { club_section_id: sectionId } : {}),
      };
    }

    // Club access — restrict to caller's clubs (all active club assignments)
    if (perms.includes('member_rankings:read_club')) {
      const clubIds = profile.authorization.grants.club_assignments.map(
        (g) => g.club.club_id,
      );

      const effectiveClubIds =
        clubId !== undefined
          ? [clubId].filter((id) => clubIds.includes(id))
          : clubIds;

      if (effectiveClubIds.length === 0) {
        // Requested club not in caller's scope — guarantee zero matches.
        // ecclesiastical_year_id is always a positive integer; -1 is impossible.
        return { ecclesiastical_year_id: -1 };
      }

      return {
        ...yearFilter,
        club_id: { in: effectiveClubIds },
        ...(sectionId !== undefined ? { club_section_id: sectionId } : {}),
      };
    }

    // Section access — restrict to caller's sections
    if (perms.includes('member_rankings:read_section')) {
      const sectionIds = profile.authorization.grants.club_assignments.map(
        (g) => g.section.club_section_id,
      );

      const effectiveSectionIds =
        sectionId !== undefined
          ? [sectionId].filter((id) => sectionIds.includes(id))
          : sectionIds;

      return {
        ...yearFilter,
        club_section_id: { in: effectiveSectionIds },
      };
    }

    // Self — restrict to own user only
    return {
      ...yearFilter,
      user_id: profile.profile.user_id,
    };
  }

  /**
   * Validates that the caller has permission to read the specific
   * enrollment ranking row for getBreakdown.
   * Throws AppForbiddenException(MEMBER_RANKING_SCOPE_DENIED) on deny.
   *
   * The row MUST be loaded with club: { select: { club_id, local_field_id } }
   * so the read_lf branch can perform an actual membership check.
   */
  private validateBreakdownScope(
    profile: ResolvedAuthorizationProfile,
    row: {
      user_id: string;
      club_id: number;
      club_section_id: number | null;
      club: { club_id: number; local_field_id: number | null } | null;
    },
  ): void {
    const perms = profile.authorization.effective.permissions;

    if (perms.includes('member_rankings:read_global')) return;

    if (perms.includes('member_rankings:read_lf')) {
      // Verify the row's club local_field_id is in the caller's local field set.
      const rowLfId = row.club?.local_field_id ?? null;

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

    if (perms.includes('member_rankings:read_club')) {
      const clubIds = profile.authorization.grants.club_assignments.map(
        (g) => g.club.club_id,
      );
      if (clubIds.includes(row.club_id)) return;
      throw new AppForbiddenException(ErrorCode.MEMBER_RANKING_SCOPE_DENIED);
    }

    if (perms.includes('member_rankings:read_section')) {
      const sectionIds = profile.authorization.grants.club_assignments.map(
        (g) => g.section.club_section_id,
      );
      if (
        row.club_section_id !== null &&
        sectionIds.includes(row.club_section_id)
      ) {
        return;
      }
      throw new AppForbiddenException(ErrorCode.MEMBER_RANKING_SCOPE_DENIED);
    }

    // Self — must match own user
    if (row.user_id === profile.profile.user_id) return;
    throw new AppForbiddenException(ErrorCode.MEMBER_RANKING_SCOPE_DENIED);
  }

  private async buildClassBreakdown(
    enrollmentId: number,
    _clubId: number,
    _yearId: number,
  ): Promise<ClassBreakdownDto> {
    const enrollment = await this.prisma.enrollments.findUnique({
      where: { enrollment_id: enrollmentId },
      select: { class_id: true },
    });

    if (!enrollment) {
      return {
        completed_sections: 0,
        required_sections: 0,
        folder_status: null,
      };
    }

    const eligibility =
      await this.requirementEligibility.calculateForEnrollment(enrollmentId);

    return {
      completed_sections: eligibility?.investiture_progress.completed ?? 0,
      required_sections: eligibility?.investiture_progress.total ?? 0,
      folder_status: null, // annual_folders links via club_enrollment, not per-member enrollment
    };
  }

  private async buildInvestitureBreakdown(
    enrollmentId: number,
  ): Promise<InvestitureBreakdownDto> {
    const enrollment = await this.prisma.enrollments.findUnique({
      where: { enrollment_id: enrollmentId },
      select: { investiture_status: true },
    });

    return {
      status: enrollment?.investiture_status ?? null,
    };
  }

  private async buildCamporeeBreakdown(
    _enrollmentId: number,
    userId: string,
    clubId: number,
    yearId: number,
    hierarchyContextId: string | null,
  ): Promise<CamporeeBreakdownDto> {
    const snapshotContext = hierarchyContextId
      ? await this.prisma.hierarchy_contexts.findUnique({
          where: { hierarchy_context_id: hierarchyContextId },
          select: { local_field_id: true, union_id: true },
        })
      : null;
    const ecclesiasticalYear =
      await this.prisma.ecclesiastical_years.findUnique({
        where: { year_id: yearId },
        select: { start_date: true, end_date: true },
      });
    const asOf =
      ecclesiasticalYear?.end_date ??
      ecclesiasticalYear?.start_date ??
      new Date(`${yearId}-12-31T23:59:59.999Z`);
    const hierarchyAsOf = snapshotContext
      ? null
      : await this.hierarchy
          .resolveAsOf({ type: 'club', id: clubId }, asOf)
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `buildCamporeeBreakdown: unable to resolve historical hierarchy for club=${clubId} year=${yearId}: ${message}`,
            );
            return null;
          });
    if (!hierarchyAsOf && !snapshotContext) {
      return { participated: false, total_camporees: null };
    }

    const localFieldId =
      snapshotContext?.local_field_id ?? hierarchyAsOf?.local_field_id ?? null;
    const unionId =
      snapshotContext?.union_id ?? hierarchyAsOf?.union_id ?? null;

    if (localFieldId == null) {
      return { participated: false, total_camporees: null };
    }

    const [localCamporees, unionCamporees] = await Promise.all([
      this.prisma.local_camporees.findMany({
        where: {
          ecclesiastical_year: yearId,
          active: true,
          local_field_id: localFieldId,
        },
        select: { local_camporee_id: true },
      }),
      unionId === null
        ? Promise.resolve([])
        : this.prisma.union_camporees.findMany({
            where: {
              ecclesiastical_year: yearId,
              active: true,
              union_id: unionId,
              union_camporee_local_fields: {
                some: { local_field_id: localFieldId },
              },
            },
            select: { union_camporee_id: true },
          }),
    ]);

    const localIds = localCamporees.map((c) => c.local_camporee_id);
    const unionIds = unionCamporees.map((c) => c.union_camporee_id);
    const totalCamporees = localIds.length + unionIds.length;

    if (totalCamporees === 0) {
      return { participated: false, total_camporees: 0 };
    }

    const orClauses: Array<Record<string, unknown>> = [];
    if (localIds.length > 0) orClauses.push({ camporee_id: { in: localIds } });
    if (unionIds.length > 0)
      orClauses.push({ union_camporee_id: { in: unionIds } });

    const participatedCount = await this.prisma.camporee_members.count({
      where: {
        user_id: userId,
        status: { in: ['registered', 'approved'] },
        OR: orClauses,
      },
    });

    return {
      participated: participatedCount > 0,
      total_camporees: totalCamporees,
    };
  }
}

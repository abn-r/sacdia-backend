import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RankingsService } from './rankings.service';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import {
  AuthorizationContextService,
  type ResolvedAuthorizationProfile,
} from '../common/services/authorization-context.service';
import { InstitutionalHierarchyService } from '../common/services/institutional-hierarchy.service';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { RankingBreakdownDto } from './dto/ranking-breakdown.dto';
import { namedThrottle } from '../config/throttler.helpers';

@ApiTags('Annual Evidence Folders - Rankings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'global' })
@Controller('annual-folders/rankings')
export class RankingsController {
  constructor(
    private readonly rankingsService: RankingsService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly hierarchy: InstitutionalHierarchyService,
  ) {}

  // ========================================
  // GET RANKINGS FOR A YEAR / CLUB TYPE
  // ========================================

  @Get()
  @AuthorizationResource({ type: 'active_assignment' })
  @RequirePermissions('rankings:read')
  @ApiOperation({
    summary: 'Get club rankings for a given year and club type',
    description:
      'Returns clubs ordered by rank_position ASC. ' +
      'Omit category_id to get general rankings (no category filter). ' +
      'Provide category_id to filter by a specific award category.',
  })
  @ApiQuery({
    name: 'club_type_id',
    required: true,
    description: 'Club type ID to filter rankings',
    example: 1,
  })
  @ApiQuery({
    name: 'year_id',
    required: true,
    description: 'Ecclesiastical year ID',
    example: 5,
  })
  @ApiQuery({
    name: 'category_id',
    required: false,
    description:
      'Award category UUID. Omit for general (uncategorised) rankings.',
    example: 'b1c2d3e4-...',
  })
  @ApiQuery({
    name: 'local_field_id',
    required: false,
    description:
      'Optional local field ID to scope club rankings to one association/field.',
    example: 4,
  })
  @ApiResponse({
    status: 200,
    description: 'Ranked list of clubs',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions (rankings:read required)',
  })
  async getRankings(
    @Query('club_type_id') clubTypeIdRaw: string,
    @Query('year_id') yearIdRaw: string,
    @Query('category_id') categoryId?: string,
    @Query('local_field_id') localFieldIdRaw?: string,
    @Req()
    request?: { authorizationProfile?: ResolvedAuthorizationProfile },
  ) {
    const clubTypeId = parseInt(clubTypeIdRaw, 10);
    const yearId = parseInt(yearIdRaw, 10);
    const localFieldId =
      localFieldIdRaw !== undefined ? parseInt(localFieldIdRaw, 10) : undefined;
    const scopedLocalFieldId = await this.resolveReadableLocalFieldScope(
      localFieldId,
      request?.authorizationProfile,
    );

    const data = await this.rankingsService.getRankings(
      clubTypeId,
      yearId,
      categoryId,
      scopedLocalFieldId,
    );

    return { status: 'success', data };
  }

  private async resolveReadableLocalFieldScope(
    requestedLocalFieldId: number | undefined,
    authorizationProfile?: ResolvedAuthorizationProfile,
  ): Promise<number | undefined> {
    if (!authorizationProfile) {
      return requestedLocalFieldId;
    }

    const activeAssignmentLocalFieldId =
      this.getActiveAssignmentLocalFieldId(authorizationProfile);

    if (requestedLocalFieldId !== undefined) {
      if (requestedLocalFieldId === activeAssignmentLocalFieldId) {
        return requestedLocalFieldId;
      }

      try {
        const requestedScope = await this.hierarchy.resolveCurrent({
          localFieldId: requestedLocalFieldId,
        });

        if (
          this.authorizationContext.canAccessHierarchyScope(
            authorizationProfile,
            requestedScope,
            'historical-read',
          )
        ) {
          return requestedLocalFieldId;
        }
      } catch {
        // Fall through to a generic 403 so callers cannot probe hierarchy IDs.
      }

      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }

    const defaultLocalFieldId =
      activeAssignmentLocalFieldId ??
      this.toNumericScopeId(
        authorizationProfile.authorization.effective.scope.global.local_field
          ?.id,
      ) ??
      authorizationProfile.profile.local_field_id;

    if (typeof defaultLocalFieldId === 'number') {
      return defaultLocalFieldId;
    }

    if (this.hasGlobalRole(authorizationProfile, 'super-admin')) {
      return undefined;
    }

    throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
  }

  private toNumericScopeId(value: number | string | undefined): number | null {
    if (typeof value === 'number') {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = parseInt(value, 10);
      return Number.isNaN(parsed) ? null : parsed;
    }

    return null;
  }

  private getActiveAssignmentLocalFieldId(
    authorizationProfile: ResolvedAuthorizationProfile,
  ): number | null {
    const activeAssignmentId =
      authorizationProfile.authorization.active_assignment.assignment_id;

    if (!activeAssignmentId) {
      return null;
    }

    const activeAssignment =
      authorizationProfile.authorization.grants.club_assignments.find(
        (assignment) => assignment.assignment_id === activeAssignmentId,
      );

    return this.toNumericScopeId(activeAssignment?.scope.local_field?.id);
  }

  private hasGlobalRole(
    authorizationProfile: ResolvedAuthorizationProfile,
    roleName: string,
  ): boolean {
    const normalizedRole = roleName.toLowerCase();
    return authorizationProfile.authorization.grants.global_roles.some(
      (grant) => grant.role_name.toLowerCase() === normalizedRole,
    );
  }

  // ========================================
  // GET RANKINGS FOR A SPECIFIC CLUB ENROLLMENT
  // ========================================

  @Get('club/:enrollmentId')
  @RequirePermissions('rankings:read')
  @ApiOperation({
    summary: 'Get all rankings for a specific club enrollment',
    description:
      'Returns the general rank plus all category-specific ranks for the given enrollment and year.',
  })
  @ApiParam({ name: 'enrollmentId', description: 'Club enrollment UUID' })
  @ApiQuery({
    name: 'year_id',
    required: true,
    description: 'Ecclesiastical year ID',
    example: 5,
  })
  @ApiResponse({
    status: 200,
    description: 'General and category-specific rankings for the club',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions (rankings:read required)',
  })
  @ApiResponse({ status: 404, description: 'Club enrollment not found' })
  async getRankingForClub(
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Query('year_id') yearIdRaw: string,
  ) {
    const yearId = parseInt(yearIdRaw, 10);

    const data = await this.rankingsService.getRankingForClub(
      enrollmentId,
      yearId,
    );

    return { status: 'success', data };
  }

  // ========================================
  // BREAKDOWN — per-component drill-down
  // ========================================

  @Get(':enrollmentId/breakdown')
  @RequirePermissions('rankings:read')
  @ApiOperation({
    summary: 'Per-component score breakdown for a club enrollment',
    description:
      'Returns the composite score, the four component scores (folder, finance, camporee, evidence), ' +
      'the weights applied (with source), and auxiliary detail per component: ' +
      'folder section evaluations summary, finance months closed/missed list + deadline day, ' +
      'camporee events list with per-event attended status, evidence validated/rejected/pending counts.',
  })
  @ApiParam({ name: 'enrollmentId', description: 'Club enrollment UUID' })
  @ApiQuery({
    name: 'year_id',
    required: true,
    description: 'Ecclesiastical year ID',
    example: 5,
  })
  @ApiResponse({
    status: 200,
    description: 'Breakdown of composite score into components',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions (rankings:read required)',
  })
  @ApiResponse({ status: 404, description: 'Club enrollment not found' })
  async getBreakdown(
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Query('year_id', ParseIntPipe) yearId: number,
  ): Promise<RankingBreakdownDto> {
    return this.rankingsService.getBreakdown(enrollmentId, yearId);
  }

  // ========================================
  // MANUAL RECALCULATION TRIGGER
  // ========================================

  @Post('recalculate')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('rankings:recalculate')
  // Rate limit: 1 call per 5 minutes — this endpoint enqueues a full system-wide
  // DB transaction; even a single extra concurrent run can DoS the DB.
  @Throttle(namedThrottle({ ttl: 300_000, limit: 1 }))
  @ApiOperation({
    summary: 'Manually trigger a rankings recalculation',
    description:
      'Enqueues club rankings recalculation for the specified year (or the current active year if omitted). ' +
      'This is the same logic that runs automatically at 2:00 AM each night. ' +
      'The HTTP response returns as soon as the job is queued. Poll GET rankings for results. ' +
      'The operation is idempotent.',
  })
  @ApiQuery({
    name: 'year_id',
    required: false,
    description:
      'Ecclesiastical year ID to recalculate. Defaults to the current active year.',
    example: 5,
  })
  @ApiResponse({
    status: 202,
    description:
      'Rankings recalculation queued (or ran inline if Redis is down)',
    schema: {
      example: {
        status: 'accepted',
        data: {
          message: 'Rankings recalculation queued',
          queued: true,
          ecclesiastical_year_id: 5,
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions (rankings:recalculate required)',
  })
  @ApiResponse({ status: 404, description: 'Year not found or no active year' })
  @ApiResponse({
    status: 409,
    description:
      'Recalculation already in progress for this year (lock held; only on inline fallback)',
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded — 1 call per 5 minutes per user',
  })
  async recalculate(@Query('year_id') yearIdRaw?: string) {
    const yearId =
      yearIdRaw !== undefined ? parseInt(yearIdRaw, 10) : undefined;

    const result = await this.rankingsService.enqueueRecalculation({ yearId });

    if (result.queued) {
      return {
        status: 'accepted',
        data: {
          message: 'Rankings recalculation queued',
          queued: true,
          ecclesiastical_year_id: result.ecclesiastical_year_id,
        },
      };
    }

    return {
      status: 'accepted',
      data: {
        message: result.skipped
          ? 'Rankings recalculation skipped'
          : 'Rankings recalculated',
        queued: false,
        rankings_updated: result.rankings_updated ?? 0,
        ecclesiastical_year_id: result.ecclesiastical_year_id,
        ...(result.skipped ? { skipped: true, reason: result.reason } : {}),
      },
    };
  }
}

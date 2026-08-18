import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  Req,
  Logger,
} from '@nestjs/common';
import { AppBadRequestException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { MemberRankingsService } from './member-rankings.service';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import { MemberRankingResponseDto } from './dto/member-ranking-response.dto';
import { MemberBreakdownDto } from './dto/member-breakdown.dto';
import { MemberMyRankingDto } from './dto/member-my-ranking.dto';
import { namedThrottle } from '../../config/throttler.helpers';

@ApiTags('Member Rankings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'active_assignment' })
@Controller('member-rankings')
export class MemberRankingsController {
  private readonly logger = new Logger(MemberRankingsController.name);

  constructor(private readonly service: MemberRankingsService) {}

  // ========================================
  // STATIC ROUTES FIRST — avoid ParseIntPipe collision with dynamic :enrollmentId
  // (engram #1883 / #1888)
  // ========================================

  @Get('me')
  @RequirePermissions('member_rankings:read_self')
  @ApiOperation({
    summary: 'Get the calling member own ranking',
    description:
      'Returns the authenticated member own ranking row for the given year. ' +
      'Visibility is controlled by the system config key ' +
      '`member_ranking.member_visibility` (hidden | self_only | self_and_top_n). ' +
      'When hidden, responds with 403 MEMBER_RANKING_HIDDEN. ' +
      'When self_and_top_n, response includes top-N anonymized peer entries.',
  })
  @ApiQuery({ name: 'year_id', required: true, type: Number })
  @ApiResponse({ status: 200, type: MemberMyRankingDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'MEMBER_RANKING_HIDDEN — visibility mode is hidden',
  })
  async getMyRanking(
    @Req() req: any,
    @Query('year_id', ParseIntPipe) yearId: number,
  ): Promise<MemberMyRankingDto> {
    this.logger.log(
      `getMyRanking: userId=${req.user?.user_id} yearId=${yearId}`,
    );
    return this.service.getMyRanking(req.user.user_id, yearId);
  }

  @Post('recalculate')
  @RequirePermissions('member_ranking_weights:write')
  // Rate limit: 1 call per 5 minutes — recalculation is a full-table DB operation.
  @Throttle(namedThrottle({ ttl: 300_000, limit: 1 }))
  @ApiOperation({
    summary: 'Manually trigger member + section ranking recalculation',
    description:
      'Requires the system config key `member_ranking.recalculation_enabled` to be truthy. ' +
      'When the kill-switch is set to "false", responds with 400 RECALCULATION_DISABLED. ' +
      'Enqueues RankingsService.recalculateAll (club + enrollment + section) and returns ' +
      'immediately. Poll GET member-rankings for results.',
  })
  @ApiQuery({ name: 'year_id', required: true, type: Number })
  @ApiQuery({
    name: 'club_id',
    required: false,
    type: Number,
    description: 'Optional club filter (informational only — full recalc runs)',
  })
  @ApiQuery({
    name: 'mode',
    required: false,
    enum: ['full', 'delta'],
    description:
      'Recalculation mode. ' +
      '"full" (default) processes all active enrollments. ' +
      '"delta" processes only enrollments whose last_progress_change is after the previous recalc timestamp. ' +
      'Falls back to full if no prior recalc exists for the year. ' +
      'Club rankings (step 1) and section aggregates (step 3) always run full regardless of mode.',
  })
  @ApiResponse({
    status: 201,
    description: 'Recalculation queued (or ran inline if Redis is down)',
    schema: {
      example: {
        triggered: true,
        ecclesiastical_year_id: 5,
        club_id: 12,
        mode: 'full',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description:
      'Insufficient permissions (member_ranking_weights:write required)',
  })
  @ApiResponse({
    status: 400,
    description: 'RECALCULATION_DISABLED — kill-switch is active',
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded — 1 call per 5 minutes',
  })
  async recalculate(
    @Req() req: any,
    @Query('year_id', ParseIntPipe) yearId: number,
    @Query('club_id') clubIdRaw?: string,
    @Query('mode') modeRaw?: string,
  ) {
    let clubId: number | undefined;
    if (clubIdRaw !== undefined) {
      const parsed = Number(clubIdRaw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new AppBadRequestException(
          ErrorCode.MEMBER_RANKINGS_CLUB_ID_INVALID,
        );
      }
      clubId = parsed;
    }
    const mode: 'full' | 'delta' = modeRaw === 'delta' ? 'delta' : 'full';
    return this.service.triggerRecalculate(
      yearId,
      req.user.user_id,
      clubId,
      mode,
    );
  }

  // ========================================
  // DYNAMIC ROUTES AFTER static ones
  // ========================================

  @Get(':enrollmentId/breakdown')
  @RequirePermissions({
    permissions: [
      'member_rankings:read_self',
      'member_rankings:read_section',
      'member_rankings:read_club',
      'member_rankings:read_lf',
      'member_rankings:read_global',
    ],
    mode: 'any',
  })
  @ApiOperation({
    summary: 'Get score breakdown for a specific enrollment',
    description:
      'Returns the full score breakdown (class, investiture, camporee) for the given enrollment. ' +
      'Access is validated against the caller RBAC scope. ' +
      'enrollmentId is an INTEGER (not UUID).',
  })
  @ApiParam({
    name: 'enrollmentId',
    type: Number,
    description: 'Enrollment ID (integer)',
  })
  @ApiQuery({ name: 'year_id', required: true, type: Number })
  @ApiResponse({ status: 200, type: MemberBreakdownDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description:
      'MEMBER_RANKING_SCOPE_DENIED — caller does not have access to this enrollment',
  })
  @ApiResponse({ status: 404, description: 'MEMBER_RANKING_NOT_FOUND' })
  async getBreakdown(
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
    @Query('year_id', ParseIntPipe) yearId: number,
    @Req() req: any,
  ): Promise<MemberBreakdownDto> {
    this.logger.log(
      `getBreakdown: enrollmentId=${enrollmentId} yearId=${yearId}`,
    );
    return this.service.getBreakdown(
      enrollmentId,
      yearId,
      req.authorizationProfile ?? req.authorization,
    );
  }

  @Get()
  @RequirePermissions({
    permissions: [
      'member_rankings:read_self',
      'member_rankings:read_section',
      'member_rankings:read_club',
      'member_rankings:read_lf',
      'member_rankings:read_global',
    ],
    mode: 'any',
  })
  @ApiOperation({
    summary: 'List member rankings (paginated, RBAC scope-filtered)',
    description:
      'Returns a paginated list of enrollment rankings filtered by the caller RBAC scope. ' +
      'Director-club callers see only their own club members. ' +
      'Global admins see all members.',
  })
  @ApiQuery({ name: 'year_id', required: true, type: Number })
  @ApiQuery({ name: 'club_id', required: false, type: Number })
  @ApiQuery({ name: 'section_id', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of member rankings',
    schema: {
      example: {
        data: [],
        total: 0,
        page: 1,
        limit: 20,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description:
      'Insufficient permissions — none of the required member_rankings:read_* permissions granted',
  })
  async list(
    @Req() req: any,
    @Query('year_id', ParseIntPipe) yearId: number,
    @Query('club_id') clubIdRaw?: string,
    @Query('section_id') sectionIdRaw?: string,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    this.logger.log(
      `list: yearId=${yearId} clubId=${clubIdRaw} sectionId=${sectionIdRaw}`,
    );
    return this.service.list({
      profile: req.authorizationProfile ?? req.authorization,
      clubId: clubIdRaw !== undefined ? Number(clubIdRaw) : undefined,
      sectionId: sectionIdRaw !== undefined ? Number(sectionIdRaw) : undefined,
      yearId,
      page: pageRaw !== undefined ? Number(pageRaw) : 1,
      limit: limitRaw !== undefined ? Number(limitRaw) : 20,
    });
  }
}

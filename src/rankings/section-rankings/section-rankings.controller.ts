import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  Req,
  Logger,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SectionRankingsService } from './section-rankings.service';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import { SectionRankingResponseDto } from './dto/section-ranking-response.dto';
import { MemberRankingResponseDto } from '../member-rankings/dto/member-ranking-response.dto';

@ApiTags('Section Rankings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'global' })
@Controller('section-rankings')
export class SectionRankingsController {
  private readonly logger = new Logger(SectionRankingsController.name);

  constructor(private readonly service: SectionRankingsService) {}

  // ========================================
  // STATIC ROUTES FIRST
  // (no static routes in Task 13 — placeholder comment mirrors Task 12 pattern)
  // ========================================

  // ========================================
  // DYNAMIC ROUTES AFTER static ones
  // (:sectionId/members before root GET to preserve ordering convention)
  // ========================================

  @Get(':sectionId/members')
  @RequirePermissions({
    permissions: [
      'section_rankings:read_club',
      'section_rankings:read_lf',
      'section_rankings:read_global',
    ],
    mode: 'any',
  })
  @ApiOperation({
    summary:
      'Get members for a specific section ordered by rank_position ASC NULLS LAST',
    description:
      'Returns enrollment rankings for the given section, ordered by rank_position ascending with nulls last. ' +
      'Access is validated against the caller RBAC scope (same 3-tier waterfall as GET /). ' +
      'sectionId is an INTEGER (not UUID).',
  })
  @ApiParam({
    name: 'sectionId',
    type: Number,
    description: 'Club section ID (integer)',
  })
  @ApiQuery({ name: 'year_id', required: true, type: Number })
  @ApiResponse({ status: 200, type: [MemberRankingResponseDto] })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description:
      'MEMBER_RANKING_SCOPE_DENIED — caller does not have access to this section',
  })
  @ApiResponse({
    status: 404,
    description: 'MEMBER_RANKING_NOT_FOUND — section does not exist',
  })
  async getMembers(
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Query('year_id', ParseIntPipe) yearId: number,
    @Req() req: any,
  ): Promise<MemberRankingResponseDto[]> {
    this.logger.log(`getMembers: sectionId=${sectionId} yearId=${yearId}`);
    return this.service.getMembers(sectionId, yearId, req.authorization);
  }

  @Get()
  @RequirePermissions({
    permissions: [
      'section_rankings:read_club',
      'section_rankings:read_lf',
      'section_rankings:read_global',
    ],
    mode: 'any',
  })
  @ApiOperation({
    summary: 'List section rankings (paginated, RBAC scope-filtered)',
    description:
      'Returns a paginated list of section rankings filtered by the caller RBAC scope. ' +
      'Director-club callers see only sections in their own club. ' +
      'Global admins see all sections. ' +
      'Ordered by rank_position ASC NULLS LAST.',
  })
  @ApiQuery({ name: 'year_id', required: true, type: Number })
  @ApiQuery({ name: 'club_id', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of section rankings',
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
      'MEMBER_RANKING_SCOPE_DENIED — caller has no section_rankings permission',
  })
  async list(
    @Req() req: any,
    @Query('year_id', ParseIntPipe) yearId: number,
    @Query('club_id') clubIdRaw?: string,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
  ): Promise<{
    data: SectionRankingResponseDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    this.logger.log(`list: yearId=${yearId} clubId=${clubIdRaw}`);
    return this.service.list({
      profile: req.authorization,
      clubId: clubIdRaw !== undefined ? Number(clubIdRaw) : undefined,
      yearId,
      page: pageRaw !== undefined ? Number(pageRaw) : 1,
      limit: limitRaw !== undefined ? Number(limitRaw) : 20,
    });
  }
}

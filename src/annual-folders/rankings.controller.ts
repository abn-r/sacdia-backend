import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
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
import { RankingBreakdownDto } from './dto/ranking-breakdown.dto';

@ApiTags('Annual Folders - Rankings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'global' })
@Controller('annual-folders/rankings')
export class RankingsController {
  constructor(private readonly rankingsService: RankingsService) {}

  // ========================================
  // GET RANKINGS FOR A YEAR / CLUB TYPE
  // ========================================

  @Get()
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
  ) {
    const clubTypeId = parseInt(clubTypeIdRaw, 10);
    const yearId = parseInt(yearIdRaw, 10);

    const data = await this.rankingsService.getRankings(
      clubTypeId,
      yearId,
      categoryId,
    );

    return { status: 'success', data };
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
  @RequirePermissions('rankings:recalculate')
  // Rate limit: 1 call per 5 minutes — this endpoint runs a full system-wide
  // DB transaction; even a single extra concurrent run can DoS the DB.
  @Throttle({ default: { ttl: 300_000, limit: 1 } })
  @ApiOperation({
    summary: 'Manually trigger a rankings recalculation',
    description:
      'Recalculates rankings for the specified year (or the current active year if omitted). ' +
      'This is the same logic that runs automatically at 2:00 AM each night. ' +
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
    status: 201,
    description: 'Rankings recalculated successfully',
    schema: {
      example: {
        status: 'success',
        data: { message: 'Rankings recalculated', rankings_updated: 42 },
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
    description: 'Recalculation already in progress for this year (lock held)',
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded — 1 call per 5 minutes per user',
  })
  async recalculate(@Query('year_id') yearIdRaw?: string) {
    const yearId =
      yearIdRaw !== undefined ? parseInt(yearIdRaw, 10) : undefined;

    const result = await this.rankingsService.recalculateRankings(yearId);

    return {
      status: 'success',
      data: {
        message: 'Rankings recalculated',
        rankings_updated: result.updated,
      },
    };
  }
}

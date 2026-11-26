import {
  Controller,
  Get,
  ParseIntPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import { AnnualRankingsService } from './annual-rankings.service';
import { AnnualRankingTerritorySummaryService } from './annual-ranking-territory-summary.service';
import { AnnualRankingTerritorySummaryRowDto } from './dto/annual-ranking-territory-summary-response.dto';
import type { AnnualRankingLeaderboardRowDto } from './dto/annual-ranking-leaderboard-response.dto';

@ApiTags('Annual Rankings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'active_assignment' })
@Controller('annual-rankings')
export class AnnualRankingsController {
  constructor(
    private readonly service: AnnualRankingsService,
    private readonly territorySummary: AnnualRankingTerritorySummaryService,
  ) {}

  @Get()
  @RequirePermissions('rankings:read')
  @ApiOperation({
    summary: 'List annual club rankings for administration',
    description:
      'Returns a local-field leaderboard by club type and year. ' +
      'This endpoint is for admin/management views; mobile uses the section scorecard endpoint.',
  })
  @ApiQuery({ name: 'local_field_id', required: true, type: Number })
  @ApiQuery({ name: 'club_type_id', required: true, type: Number })
  @ApiQuery({ name: 'year_id', required: true, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Annual ranking leaderboard envelope',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Caller cannot read the requested local field leaderboard',
  })
  async list(
    @Query('local_field_id', ParseIntPipe) localFieldId: number,
    @Query('club_type_id', ParseIntPipe) clubTypeId: number,
    @Query('year_id', ParseIntPipe) yearId: number,
    @Req() req: any,
  ): Promise<{
    status: 'success';
    data: AnnualRankingLeaderboardRowDto[];
    total: number;
  }> {
    const result = await this.service.getLeaderboard(
      { localFieldId, yearId, clubTypeId },
      req.authorizationProfile ?? req.authorization,
    );

    return {
      status: 'success',
      data: result.data,
      total: result.total,
    };
  }

  @Get('territory-summary')
  @RequirePermissions('rankings:read')
  @ApiOperation({
    summary: 'Annual progress summary per child territory',
    description:
      'Pass exactly one of division_id (returns its unions) or union_id (returns its local fields). ' +
      'Each row carries the active club count and whether an annual ranking config exists. ' +
      'Division actors may query their own division (or a union in it); Union actors only their own union.',
  })
  @ApiQuery({ name: 'division_id', required: false, type: Number })
  @ApiQuery({ name: 'union_id', required: false, type: Number })
  @ApiQuery({
    name: 'year_id',
    required: false,
    type: Number,
    description: 'Defaults to the current ecclesiastical year',
  })
  @ApiResponse({
    status: 200,
    description: 'Summary rows envelope',
    type: AnnualRankingTerritorySummaryRowDto,
    isArray: true,
  })
  @ApiResponse({
    status: 400,
    description: 'Both or neither of division_id / union_id',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Requested territory is outside the caller scope',
  })
  async territorySummaryList(
    @Query('division_id', new ParseIntPipe({ optional: true }))
    divisionId: number | undefined,
    @Query('union_id', new ParseIntPipe({ optional: true }))
    unionId: number | undefined,
    @Query('year_id', new ParseIntPipe({ optional: true }))
    yearId: number | undefined,
    @Req() req: any,
  ): Promise<{
    status: 'success';
    data: AnnualRankingTerritorySummaryRowDto[];
  }> {
    const data = await this.territorySummary.getSummary(
      { divisionId, unionId, yearId },
      req.authorizationProfile ?? req.authorization,
    );
    return { status: 'success', data };
  }
}

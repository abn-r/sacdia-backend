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
import type {
  AnnualRankingLeaderboardRowDto,
} from './dto/annual-ranking-leaderboard-response.dto';

@ApiTags('Annual Rankings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'active_assignment' })
@Controller('annual-rankings')
export class AnnualRankingsController {
  constructor(private readonly service: AnnualRankingsService) {}

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
}

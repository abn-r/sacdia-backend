import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import { AnnualRankingProgressService } from './annual-ranking-progress.service';
import type { AnnualRankingProgressResponseDto } from './dto/annual-ranking-progress-response.dto';

@ApiTags('Annual Ranking Progress')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'active_assignment' })
@Controller('club-sections/:sectionId/annual-ranking-progress')
export class AnnualRankingProgressController {
  constructor(private readonly service: AnnualRankingProgressService) {}

  @Get()
  @RequirePermissions({
    permissions: [
      'rankings:read',
      'rankings:read_lf',
      'rankings:read_global',
      'section_rankings:read_club',
      'section_rankings:read_lf',
      'section_rankings:read_global',
    ],
    mode: 'any',
  })
  @ApiOperation({
    summary: 'Get annual ranking progress for one club section',
    description:
      'Returns the section-scoped annual scorecard used by the mobile app. ' +
      'It intentionally does not return the competitive list of other clubs.',
  })
  @ApiParam({
    name: 'sectionId',
    type: Number,
    description: 'Club section ID (integer)',
  })
  @ApiQuery({
    name: 'year_id',
    required: true,
    type: Number,
    description: 'Ecclesiastical year ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Annual progress scorecard envelope',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Caller cannot read this section progress',
  })
  @ApiResponse({
    status: 404,
    description: 'Section or annual ranking configuration was not found',
  })
  async getProgress(
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Query('year_id', ParseIntPipe) yearId: number,
    @Req() req: any,
  ): Promise<{ status: 'success'; data: AnnualRankingProgressResponseDto }> {
    const data = await this.service.getSectionProgress(
      sectionId,
      yearId,
      req.authorizationProfile ?? req.authorization,
    );

    return { status: 'success', data };
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { AnnualRankingConfigService } from './annual-ranking-config.service';
import { CreateAnnualRankingConfigDto } from './dto/create-annual-ranking-config.dto';
import { UpdateAnnualRankingConfigDto } from './dto/update-annual-ranking-config.dto';

function optionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

@ApiTags('Annual Ranking Configs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'global' })
@Controller('annual-ranking-configs')
export class AnnualRankingConfigController {
  constructor(private readonly service: AnnualRankingConfigService) {}

  @Get()
  @RequirePermissions('ranking_weights:read')
  @ApiOperation({
    summary: 'List annual ranking point budgets',
    description:
      'Returns union or local-field annual ranking configurations and component point budgets, optionally filtered by scope.',
  })
  @ApiQuery({ name: 'union_id', required: false, type: Number })
  @ApiQuery({ name: 'local_field_id', required: false, type: Number })
  @ApiQuery({ name: 'year_id', required: false, type: Number })
  @ApiQuery({ name: 'club_type_id', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Annual ranking configs' })
  async list(
    @Query('union_id') unionId?: number | string,
    @Query('local_field_id') localFieldId?: number | string,
    @Query('year_id') yearId?: number | string,
    @Query('club_type_id') clubTypeId?: number | string,
  ) {
    const data = await this.service.list({
      unionId: optionalInt(unionId),
      localFieldId: optionalInt(localFieldId),
      ecclesiasticalYearId: optionalInt(yearId),
      clubTypeId: optionalInt(clubTypeId),
    });

    return { status: 'success' as const, data, total: data.length };
  }

  @Post()
  @RequirePermissions('ranking_weights:write')
  @ApiOperation({ summary: 'Create an annual ranking point budget' })
  @ApiResponse({ status: 201, description: 'Annual ranking config created' })
  @ApiResponse({
    status: 400,
    description: 'Component points do not sum total',
  })
  @ApiResponse({ status: 409, description: 'Config already exists for scope' })
  async create(@Body() dto: CreateAnnualRankingConfigDto, @Req() req: any) {
    const data = await this.service.create(dto, req?.user?.userId);
    return { status: 'success' as const, data };
  }

  @Patch(':id')
  @RequirePermissions('ranking_weights:write')
  @ApiOperation({ summary: 'Update an annual ranking point budget' })
  @ApiResponse({ status: 200, description: 'Annual ranking config updated' })
  @ApiResponse({
    status: 400,
    description: 'Component points do not sum total',
  })
  @ApiResponse({ status: 404, description: 'Config not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAnnualRankingConfigDto,
    @Req() req: any,
  ) {
    const data = await this.service.update(id, dto, req?.user?.userId);
    return { status: 'success' as const, data };
  }

  @Delete(':id')
  @RequirePermissions('ranking_weights:write')
  @ApiOperation({ summary: 'Deactivate an annual ranking point budget' })
  @ApiResponse({ status: 200, description: 'Annual ranking config deactivated' })
  @ApiResponse({ status: 404, description: 'Config not found' })
  async deactivate(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const data = await this.service.deactivate(id, req?.user?.userId);
    return { status: 'success' as const, data };
  }
}

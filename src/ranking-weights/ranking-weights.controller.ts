import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { RankingWeightsService } from './ranking-weights.service';
import { CreateRankingWeightsDto } from './dto/create-ranking-weights.dto';
import { UpdateRankingWeightsDto } from './dto/update-ranking-weights.dto';

@ApiTags('Ranking Weights')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'global' })
@Controller('ranking-weights')
export class RankingWeightsController {
  constructor(private readonly svc: RankingWeightsService) {}

  // ==========================================
  // LIST — default + all overrides
  // ==========================================

  @Get()
  @RequirePermissions('ranking_weights:read')
  @ApiOperation({
    summary: 'List all ranking weight configs',
    description:
      'Returns the default global config (club_type_id = null) and all club-type overrides, ordered by club_type_id ASC (nulls first).',
  })
  @ApiResponse({ status: 200, description: 'List of ranking weight configs' })
  list() {
    return this.svc.list();
  }

  // ==========================================
  // GET SINGLE
  // ==========================================

  @Get(':id')
  @RequirePermissions('ranking_weights:read')
  @ApiOperation({ summary: 'Get a single ranking weight config by UUID' })
  @ApiParam({ name: 'id', description: 'ranking_weight_config_id UUID' })
  @ApiResponse({ status: 200, description: 'Ranking weight config' })
  @ApiResponse({ status: 404, description: 'Not found' })
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getById(id);
  }

  // ==========================================
  // CREATE OVERRIDE
  // ==========================================

  @Post()
  @RequirePermissions('ranking_weights:write')
  @ApiOperation({
    summary: 'Create a club-type ranking weight override',
    description:
      'club_type_id is required. The default global row is seeded and cannot be created here. ' +
      'All four weights must be provided and sum to 100.',
  })
  @ApiResponse({ status: 201, description: 'Override created' })
  @ApiResponse({ status: 400, description: 'Validation error (missing club_type_id or sum ≠ 100)' })
  @ApiResponse({ status: 409, description: 'Override already exists for this club_type_id' })
  create(@Body() dto: CreateRankingWeightsDto, @Req() req: any) {
    return this.svc.create(dto, req?.user?.userId);
  }

  // ==========================================
  // UPDATE (PATCH)
  // ==========================================

  @Patch(':id')
  @RequirePermissions('ranking_weights:write')
  @ApiOperation({
    summary: 'Partially update a ranking weight config',
    description:
      'Merges the patch with the current row. The merged result must still sum to 100.',
  })
  @ApiParam({ name: 'id', description: 'ranking_weight_config_id UUID' })
  @ApiResponse({ status: 200, description: 'Updated config' })
  @ApiResponse({ status: 400, description: 'Merged weights do not sum to 100' })
  @ApiResponse({ status: 404, description: 'Not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRankingWeightsDto,
    @Req() req: any,
  ) {
    return this.svc.update(id, dto, req?.user?.userId);
  }

  // ==========================================
  // DELETE
  // ==========================================

  @Delete(':id')
  @RequirePermissions('ranking_weights:write')
  @ApiOperation({
    summary: 'Delete a ranking weight override',
    description: 'The default global config (club_type_id = null) cannot be deleted.',
  })
  @ApiParam({ name: 'id', description: 'ranking_weight_config_id UUID' })
  @ApiResponse({ status: 200, description: 'Deleted' })
  @ApiResponse({ status: 400, description: 'Cannot delete default global' })
  @ApiResponse({ status: 404, description: 'Not found' })
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.delete(id);
  }
}

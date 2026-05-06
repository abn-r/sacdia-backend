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
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
  GlobalRoles,
} from '../../common/decorators';
import {
  JwtAuthGuard,
  GlobalRolesGuard,
  PermissionsGuard,
} from '../../common/guards';
import { MemberRankingWeightsService } from './member-ranking-weights.service';
import { CreateMemberRankingWeightsDto } from './dto/create-member-ranking-weights.dto';
import { UpdateMemberRankingWeightsDto } from './dto/update-member-ranking-weights.dto';
import { MemberRankingWeightsResponseDto } from './dto/member-ranking-weights-response.dto';

/**
 * Admin CRUD endpoints for `enrollment_ranking_weights`.
 *
 * All routes require the caller to be `admin` or `super-admin` (GlobalRolesGuard)
 * AND hold the corresponding permission (PermissionsGuard) — defence-in-depth
 * following the admin-honors.controller pattern.
 *
 * Route prefix: /api/v1/member-ranking-weights
 */
@ApiTags('Member Ranking Weights')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GlobalRolesGuard, PermissionsGuard)
@GlobalRoles('admin', 'super-admin')
@AuthorizationResource({ type: 'global' })
@Controller('member-ranking-weights')
export class MemberRankingWeightsController {
  constructor(private readonly service: MemberRankingWeightsService) {}

  // =========================================================================
  // Static / collection routes — declared before :id to avoid ambiguity
  // =========================================================================

  /**
   * GET /api/v1/member-ranking-weights
   * Returns all weight configurations ordered by is_default DESC.
   */
  @Get()
  @RequirePermissions('member_ranking_weights:read')
  @ApiOperation({
    summary: 'List all ranking weight configurations (admin)',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  @ApiResponse({
    status: 200,
    type: MemberRankingWeightsResponseDto,
    isArray: true,
  })
  async list(
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    return this.service.list({
      page: pageRaw !== undefined ? Number(pageRaw) : 1,
      limit: limitRaw !== undefined ? Number(limitRaw) : 50,
    });
  }

  /**
   * POST /api/v1/member-ranking-weights
   * Creates a new weight configuration row.
   */
  @Post()
  @RequirePermissions('member_ranking_weights:write')
  @ApiOperation({
    summary: 'Create a ranking weight configuration (admin)',
    description:
      'class_pct + investiture_pct + camporee_pct must equal 100. ' +
      'The (club_type_id, ecclesiastical_year_id) pair must be unique.',
  })
  @ApiResponse({
    status: 201,
    description: 'Weight configuration created.',
    type: MemberRankingWeightsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'WEIGHTS_SUM_INVALID — pcts do not sum to 100.',
  })
  @ApiResponse({
    status: 409,
    description:
      'WEIGHTS_CONFLICT — duplicate (club_type_id, ecclesiastical_year_id).',
  })
  async create(@Req() req: any, @Body() dto: CreateMemberRankingWeightsDto) {
    return this.service.create(dto, req.user.user_id);
  }

  // =========================================================================
  // Parameterised routes — :id (UUID)
  // =========================================================================

  /**
   * GET /api/v1/member-ranking-weights/:id
   * Returns a single weight configuration.
   */
  @Get(':id')
  @RequirePermissions('member_ranking_weights:read')
  @ApiOperation({
    summary: 'Get a ranking weight configuration by ID (admin)',
  })
  @ApiParam({ name: 'id', description: 'UUID of the weight row' })
  @ApiResponse({ status: 200, type: MemberRankingWeightsResponseDto })
  @ApiResponse({ status: 404, description: 'WEIGHTS_NOT_FOUND.' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  /**
   * PATCH /api/v1/member-ranking-weights/:id
   * Partially updates a weight configuration.
   * Merged pct values must still sum to 100.
   */
  @Patch(':id')
  @RequirePermissions('member_ranking_weights:write')
  @ApiOperation({
    summary: 'Update a ranking weight configuration (admin)',
    description:
      'Merges provided fields with existing values. ' +
      'Combined class_pct + investiture_pct + camporee_pct must equal 100.',
  })
  @ApiParam({ name: 'id', description: 'UUID of the weight row' })
  @ApiResponse({ status: 200, type: MemberRankingWeightsResponseDto })
  @ApiResponse({ status: 400, description: 'WEIGHTS_SUM_INVALID.' })
  @ApiResponse({ status: 404, description: 'WEIGHTS_NOT_FOUND.' })
  @ApiResponse({ status: 409, description: 'WEIGHTS_CONFLICT.' })
  async update(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemberRankingWeightsDto,
  ) {
    return this.service.update(id, dto, req.user.user_id);
  }

  /**
   * DELETE /api/v1/member-ranking-weights/:id
   * Deletes a weight configuration.
   * The global default row (is_default=true) cannot be deleted.
   */
  @Delete(':id')
  @RequirePermissions('member_ranking_weights:write')
  @ApiOperation({
    summary: 'Delete a ranking weight configuration (admin)',
    description: 'The global default row (is_default=true) cannot be deleted.',
  })
  @ApiParam({ name: 'id', description: 'UUID of the weight row' })
  @ApiResponse({ status: 200, description: '{ status: "deleted" }' })
  @ApiResponse({ status: 400, description: 'DEFAULT_WEIGHTS_NOT_DELETABLE.' })
  @ApiResponse({ status: 404, description: 'WEIGHTS_NOT_FOUND.' })
  async remove(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id, req.user.user_id);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthorizationResource, RequirePermissions, GlobalRoles } from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard, GlobalRolesGuard } from '../common/guards';
import { AdminHonorsService } from './admin-honors.service';
import {
  BatchReviewDto,
  CreateRequirementDto,
  ReorderRequirementsDto,
  UpdateRequirementDto,
} from '../honors/dto/honor-requirements.dto';

@ApiTags('Admin - Honors Requirements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GlobalRolesGuard, PermissionsGuard)
@GlobalRoles('admin', 'super_admin')
@AuthorizationResource({ type: 'global' })
@Controller('admin/honors')
export class AdminHonorsController {
  constructor(private readonly adminHonorsService: AdminHonorsService) {}

  // =========================================================================
  // STATIC ROUTES — must be declared before parameterized routes
  // so NestJS does not try to parse literal strings as :requirementId.
  // =========================================================================

  /**
   * GET /api/v1/admin/honors/requirements/pending-review
   * Returns a paginated list of requirements flagged for review.
   */
  @Get('requirements/pending-review')
  @RequirePermissions('honors:read')
  @ApiOperation({ summary: 'List requirements pending admin review (paginated)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getPendingReview(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const data = await this.adminHonorsService.getPendingReview(
      Number(page),
      Number(limit),
    );
    return { status: 'success', data };
  }

  /**
   * PATCH /api/v1/admin/honors/requirements/batch-review
   * Marks a batch of requirements as reviewed (approved or rejected).
   */
  @Patch('requirements/batch-review')
  @RequirePermissions('honors:update')
  @ApiOperation({ summary: 'Batch-review flagged requirements' })
  async batchReview(@Body() dto: BatchReviewDto) {
    const data = await this.adminHonorsService.batchReview(dto);
    return { status: 'success', data };
  }

  // =========================================================================
  // PARAMETERIZED ROUTES — :requirementId
  // =========================================================================

  /**
   * PATCH /api/v1/admin/honors/requirements/:requirementId
   * Partially updates a single requirement.
   */
  @Patch('requirements/:requirementId')
  @RequirePermissions('honors:update')
  @ApiOperation({ summary: 'Update a requirement' })
  async updateRequirement(
    @Param('requirementId', ParseIntPipe) requirementId: number,
    @Body() dto: UpdateRequirementDto,
  ) {
    const data = await this.adminHonorsService.updateRequirement(
      requirementId,
      dto,
    );
    return { status: 'success', data };
  }

  /**
   * DELETE /api/v1/admin/honors/requirements/:requirementId
   * Soft-deletes a requirement and its children.
   */
  @Delete('requirements/:requirementId')
  @RequirePermissions('honors:delete')
  @ApiOperation({ summary: 'Soft-delete a requirement (and its children)' })
  async deleteRequirement(
    @Param('requirementId', ParseIntPipe) requirementId: number,
  ) {
    const data = await this.adminHonorsService.deleteRequirement(requirementId);
    return { status: 'success', data };
  }

  // =========================================================================
  // HONOR-SCOPED ROUTES — :honorId
  // =========================================================================

  /**
   * GET /api/v1/admin/honors/:honorId/requirements
   * Returns the full hierarchical requirements tree for the given honor.
   */
  @Get(':honorId/requirements')
  @RequirePermissions('honors:read')
  @ApiOperation({ summary: 'List requirements tree for an honor (admin view)' })
  async getRequirements(@Param('honorId', ParseIntPipe) honorId: number) {
    const data = await this.adminHonorsService.getRequirements(honorId);
    return { status: 'success', data };
  }

  /**
   * POST /api/v1/admin/honors/:honorId/requirements
   * Creates a new requirement under the given honor.
   */
  @Post(':honorId/requirements')
  @RequirePermissions('honors:create')
  @ApiOperation({ summary: 'Create a requirement for an honor' })
  async createRequirement(
    @Param('honorId', ParseIntPipe) honorId: number,
    @Body() dto: CreateRequirementDto,
  ) {
    // Ensure the honorId from the route takes precedence over any body value.
    const data = await this.adminHonorsService.createRequirement({
      ...dto,
      honorId,
    });
    return { status: 'success', data };
  }

  /**
   * PATCH /api/v1/admin/honors/:honorId/requirements/reorder
   * Batch-updates requirement_number for all requirements of an honor.
   *
   * NOTE: This route (:honorId/requirements/reorder) must come AFTER the
   * static /requirements/* routes above because NestJS resolves routes by
   * declaration order within a controller, and the static paths are fully
   * qualified (no parameters in the first segment after "requirements/").
   * Since this route's first segment is a parameter (:honorId) and the
   * second is "requirements", there is no ambiguity with the static routes
   * declared before it.
   */
  @Patch(':honorId/requirements/reorder')
  @RequirePermissions('honors:update')
  @ApiOperation({ summary: 'Reorder requirements for an honor' })
  async reorderRequirements(
    @Param('honorId', ParseIntPipe) honorId: number,
    @Body() dto: ReorderRequirementsDto,
  ) {
    const data = await this.adminHonorsService.reorderRequirements(honorId, dto);
    return { status: 'success', data };
  }
}

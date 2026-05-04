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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Multer } from 'multer';
import { AppBadRequestException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { achievement_type } from '@prisma/client';
import {
  AuthorizationResource,
  RequirePermissions,
  GlobalRoles,
} from '../../common/decorators';
import {
  JwtAuthGuard,
  PermissionsGuard,
  GlobalRolesGuard,
} from '../../common/guards';
import {
  CreateAchievementDto,
  UpdateAchievementDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from '../dto';
import { AdminAchievementsService } from './admin-achievements.service';

@ApiTags('Admin - Achievements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GlobalRolesGuard, PermissionsGuard)
@GlobalRoles('admin', 'super_admin')
@AuthorizationResource({ type: 'global' })
@Controller('admin/achievements')
export class AdminAchievementsController {
  constructor(
    private readonly adminAchievementsService: AdminAchievementsService,
  ) {}

  // ===========================================================================
  // STATIC ROUTES — declare before parameterized routes to avoid NestJS conflicts
  // ===========================================================================

  /**
   * GET /api/v1/admin/achievements/stats
   * Dashboard stats: total achievements, completion rates, most/least unlocked.
   */
  @Get('stats')
  @RequirePermissions('achievements:manage')
  @ApiOperation({ summary: 'Get achievement dashboard stats' })
  @ApiResponse({ status: 200, description: 'Achievement statistics' })
  async getStats() {
    const data = await this.adminAchievementsService.getStats();
    return { status: 'success', data };
  }

  // ===========================================================================
  // CATEGORY ROUTES — /categories and /categories/:id
  // ===========================================================================

  /**
   * GET /api/v1/admin/achievements/categories
   */
  @Get('categories')
  @RequirePermissions('achievements:manage')
  @ApiOperation({ summary: 'List all achievement categories (admin view)' })
  @ApiResponse({ status: 200, description: 'List of achievement categories' })
  async getCategories() {
    const data = await this.adminAchievementsService.getCategories();
    return { status: 'success', data };
  }

  /**
   * POST /api/v1/admin/achievements/categories
   */
  @Post('categories')
  @RequirePermissions('achievements:manage')
  @ApiOperation({ summary: 'Create a new achievement category' })
  @ApiResponse({ status: 201, description: 'Category created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async createCategory(@Body() dto: CreateCategoryDto) {
    const data = await this.adminAchievementsService.createCategory(dto);
    return { status: 'success', data };
  }

  /**
   * PATCH /api/v1/admin/achievements/categories/:categoryId
   */
  @Patch('categories/:categoryId')
  @RequirePermissions('achievements:manage')
  @ApiOperation({ summary: 'Update an achievement category' })
  @ApiParam({ name: 'categoryId', type: Number })
  @ApiResponse({ status: 200, description: 'Category updated' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async updateCategory(
    @Param('categoryId', ParseIntPipe) categoryId: number,
    @Body() dto: UpdateCategoryDto,
  ) {
    const data = await this.adminAchievementsService.updateCategory(
      categoryId,
      dto,
    );
    return { status: 'success', data };
  }

  /**
   * DELETE /api/v1/admin/achievements/categories/:categoryId
   * Soft-deletes the category. Returns 409 if it has active achievements.
   */
  @Delete('categories/:categoryId')
  @RequirePermissions('achievements:manage')
  @ApiOperation({
    summary: 'Soft-delete a category',
    description:
      'Returns 409 Conflict if the category still has active achievements.',
  })
  @ApiParam({ name: 'categoryId', type: Number })
  @ApiResponse({ status: 200, description: 'Category deactivated' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({
    status: 409,
    description: 'Category has active achievements',
  })
  async deleteCategory(@Param('categoryId', ParseIntPipe) categoryId: number) {
    const data = await this.adminAchievementsService.deleteCategory(categoryId);
    return { status: 'success', data };
  }

  // ===========================================================================
  // ACHIEVEMENT ROUTES — /  /:id  /:id/image  /retroactive/:id
  // ===========================================================================

  /**
   * GET /api/v1/admin/achievements
   */
  @Get()
  @RequirePermissions('achievements:manage')
  @ApiOperation({ summary: 'List all achievements (admin view, paginated)' })
  @ApiQuery({ name: 'type', required: false, enum: achievement_type })
  @ApiQuery({ name: 'categoryId', required: false, type: Number })
  @ApiQuery({
    name: 'active',
    required: false,
    type: Boolean,
    description: 'Filter by active status. Omit to return all.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated list of achievements' })
  async getAchievements(
    @Query('type') type?: achievement_type,
    @Query('categoryId', new ParseIntPipe({ optional: true }))
    categoryId?: number,
    @Query('active') active?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const activeBool =
      active === 'true' ? true : active === 'false' ? false : undefined;
    const data = await this.adminAchievementsService.getAchievements({
      type,
      categoryId,
      active: activeBool,
      page,
      limit,
    });
    return { status: 'success', data };
  }

  /**
   * POST /api/v1/admin/achievements
   */
  @Post()
  @RequirePermissions('achievements:manage')
  @ApiOperation({
    summary: 'Create a new achievement',
    description:
      'Validates criteria via the appropriate handler before persisting.',
  })
  @ApiResponse({ status: 201, description: 'Achievement created' })
  @ApiResponse({
    status: 400,
    description: 'Validation error or invalid criteria',
  })
  @ApiResponse({
    status: 404,
    description: 'Category or prerequisite not found',
  })
  async createAchievement(@Body() dto: CreateAchievementDto) {
    const data = await this.adminAchievementsService.createAchievement(dto);
    return { status: 'success', data };
  }

  /**
   * GET /api/v1/admin/achievements/:achievementId
   */
  @Get(':achievementId')
  @RequirePermissions('achievements:manage')
  @ApiOperation({ summary: 'Get a single achievement by ID (admin view)' })
  @ApiParam({ name: 'achievementId', type: Number })
  @ApiResponse({ status: 200, description: 'Achievement found' })
  @ApiResponse({ status: 404, description: 'Achievement not found' })
  async getAchievementById(
    @Param('achievementId', ParseIntPipe) achievementId: number,
  ) {
    const data =
      await this.adminAchievementsService.getAchievementById(achievementId);
    return { status: 'success', data };
  }

  /**
   * PATCH /api/v1/admin/achievements/:achievementId
   */
  @Patch(':achievementId')
  @RequirePermissions('achievements:manage')
  @ApiOperation({ summary: 'Update an achievement' })
  @ApiParam({ name: 'achievementId', type: Number })
  @ApiResponse({ status: 200, description: 'Achievement updated' })
  @ApiResponse({
    status: 400,
    description: 'Invalid criteria or circular prerequisite',
  })
  @ApiResponse({ status: 404, description: 'Achievement not found' })
  async updateAchievement(
    @Param('achievementId', ParseIntPipe) achievementId: number,
    @Body() dto: UpdateAchievementDto,
  ) {
    const data = await this.adminAchievementsService.updateAchievement(
      achievementId,
      dto,
    );
    return { status: 'success', data };
  }

  /**
   * DELETE /api/v1/admin/achievements/:achievementId
   * Soft-deletes the achievement (sets active = false).
   */
  @Delete(':achievementId')
  @RequirePermissions('achievements:manage')
  @ApiOperation({ summary: 'Soft-delete an achievement' })
  @ApiParam({ name: 'achievementId', type: Number })
  @ApiResponse({ status: 200, description: 'Achievement deactivated' })
  @ApiResponse({ status: 404, description: 'Achievement not found' })
  async deleteAchievement(
    @Param('achievementId', ParseIntPipe) achievementId: number,
  ) {
    const data =
      await this.adminAchievementsService.deleteAchievement(achievementId);
    return { status: 'success', data };
  }

  /**
   * POST /api/v1/admin/achievements/:achievementId/image
   * Upload badge image (PNG, SVG, or WebP, max 2 MB) to R2.
   */
  @Post(':achievementId/image')
  @RequirePermissions('achievements:manage')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload badge image for an achievement',
    description:
      'Accepts PNG, SVG, or WebP. Max size: 2 MB. Stores the file in R2 and updates badge_image_key.',
  })
  @ApiParam({ name: 'achievementId', type: Number })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Badge image (PNG, SVG, or WebP — max 2 MB)',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Badge image uploaded successfully',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'success' },
        data: {
          type: 'object',
          properties: {
            badge_image_key: { type: 'string' },
            badge_image_url: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid file type or size exceeded',
  })
  @ApiResponse({ status: 404, description: 'Achievement not found' })
  async uploadBadgeImage(
    @Param('achievementId', ParseIntPipe) achievementId: number,
    @UploadedFile() file: Multer.File,
  ) {
    if (!file) {
      throw new AppBadRequestException(
        ErrorCode.ACHIEVEMENT_BADGE_UPLOAD_MISSING,
      );
    }
    const data = await this.adminAchievementsService.uploadBadgeImage(
      achievementId,
      file,
    );
    return { status: 'success', data };
  }

  /**
   * POST /api/v1/admin/achievements/retroactive/:achievementId
   * Trigger retroactive evaluation for all eligible users.
   *
   * NOTE: This route uses a different prefix segment ("retroactive") before
   * the parameter, so it won't collide with /:achievementId routes.
   */
  @Post('retroactive/:achievementId')
  @RequirePermissions('achievements:manage')
  @ApiOperation({
    summary: 'Trigger retroactive achievement evaluation',
    description:
      'Enqueues evaluation jobs for all users who have not yet completed this achievement.',
  })
  @ApiParam({ name: 'achievementId', type: Number })
  @ApiResponse({
    status: 201,
    description: 'Retroactive evaluation enqueued',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'success' },
        data: {
          type: 'object',
          properties: {
            users_queued: { type: 'number' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Achievement is inactive' })
  @ApiResponse({ status: 404, description: 'Achievement not found' })
  async triggerRetroactive(
    @Param('achievementId', ParseIntPipe) achievementId: number,
  ) {
    const data =
      await this.adminAchievementsService.triggerRetroactiveEvaluation(
        achievementId,
      );
    return { status: 'success', data };
  }
}

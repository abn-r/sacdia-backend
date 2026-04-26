import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AppNotFoundException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards';
import { AchievementsService } from './achievements.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Masks a secret achievement so the user cannot discover name/description
 * before unlocking it.
 */
function maskSecretAchievement<
  T extends {
    secret?: boolean;
    name?: string;
    description?: string;
    badge_image_key?: string | null;
  },
>(achievement: T, isCompleted: boolean): T {
  if (!achievement.secret || isCompleted) return achievement;
  return {
    ...achievement,
    name: '???',
    description: '???',
    badge_image_key: null,
  } as T;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@ApiTags('Achievements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('achievements')
export class AchievementsController {
  constructor(private readonly achievementsService: AchievementsService) {}

  // ===========================================================================
  // STATIC ROUTES — declare before /:id to avoid route shadowing
  // ===========================================================================

  /**
   * GET /api/v1/achievements/me
   * Returns the authenticated user's achievements grouped by category,
   * including a progress summary.
   */
  @Get('me')
  @ApiOperation({
    summary: "Get current user's achievements with progress",
    description:
      'Returns a summary (total completed, total points, completion %) and achievements grouped by category.',
  })
  @ApiResponse({
    status: 200,
    description: 'User achievement summary grouped by category',
  })
  async getMyAchievements(@Request() req: { user: { userId: string } }) {
    return this.achievementsService.getUserAchievements(req.user.userId);
  }

  /**
   * GET /api/v1/achievements/categories
   * Returns all active achievement categories.
   */
  @Get('categories')
  @ApiOperation({ summary: 'List active achievement categories' })
  @ApiResponse({ status: 200, description: 'List of active categories' })
  async getCategories() {
    return this.achievementsService.findActiveCategories();
  }

  // ===========================================================================
  // CATALOG — grouped by category, secret achievements masked
  // ===========================================================================

  /**
   * GET /api/v1/achievements
   * Returns all active achievements grouped by category.
   * Secret achievements not yet completed by the user are masked (name = "???").
   */
  @Get()
  @ApiOperation({
    summary: 'List all active achievements grouped by category',
    description:
      'Secret achievements not yet unlocked by the requesting user are masked with "???" for name and description.',
  })
  @ApiQuery({ name: 'categoryId', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Paginated achievements grouped by category',
  })
  async listAchievements(
    @Request() req: { user: { userId: string } },
    @Query('categoryId', new ParseIntPipe({ optional: true }))
    categoryId?: number,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const userId = req.user.userId;

    const catalogResult = await this.achievementsService.findAllAchievements({
      active: true,
      categoryId,
      page,
      limit,
    });

    // Fetch user's completed achievement IDs for masking
    const completedIds =
      await this.achievementsService.getCompletedAchievementIds(userId);

    // Apply secret masking and group by category
    const categoryMap = new Map<
      number,
      {
        category_id: number;
        category_name: string;
        icon: string | null;
        display_order: number;
        achievements: unknown[];
      }
    >();

    for (const achievement of catalogResult.data) {
      const isCompleted = completedIds.has(achievement.achievement_id);
      const masked = maskSecretAchievement(achievement, isCompleted);

      const cat = achievement.category;
      if (!categoryMap.has(cat.achievement_category_id)) {
        categoryMap.set(cat.achievement_category_id, {
          category_id: cat.achievement_category_id,
          category_name: cat.name,
          icon: cat.icon,
          display_order: cat.display_order ?? 0,
          achievements: [],
        });
      }
      categoryMap.get(cat.achievement_category_id)!.achievements.push(masked);
    }

    const categories = Array.from(categoryMap.values()).sort(
      (a, b) => a.display_order - b.display_order || a.category_id - b.category_id,
    );

    return {
      categories,
      meta: {
        total: catalogResult.total,
        page: catalogResult.page,
        limit: catalogResult.limit,
        totalPages: catalogResult.totalPages,
      },
    };
  }

  // ===========================================================================
  // DETAIL — single achievement with user's progress
  // ===========================================================================

  /**
   * GET /api/v1/achievements/:achievementId
   * Returns achievement detail + user's progress.
   * Secret achievements not yet completed are masked.
   */
  @Get(':achievementId')
  @ApiOperation({
    summary: 'Get achievement detail with user progress',
    description:
      'If the achievement is secret and the user has not completed it, name/description are masked.',
  })
  @ApiParam({ name: 'achievementId', type: Number })
  @ApiResponse({ status: 200, description: 'Achievement detail with progress' })
  @ApiResponse({ status: 404, description: 'Achievement not found or inactive' })
  async getAchievementDetail(
    @Request() req: { user: { userId: string } },
    @Param('achievementId', ParseIntPipe) achievementId: number,
  ) {
    const userId = req.user.userId;

    const result = await this.achievementsService.getAchievementDetail(
      achievementId,
      userId,
    );

    if (!result || !result.achievement.active) {
      throw new AppNotFoundException(ErrorCode.ACHIEVEMENT_NOT_FOUND);
    }

    const isCompleted = result.userProgress?.completed === true;
    const maskedAchievement = maskSecretAchievement(
      result.achievement,
      isCompleted,
    );

    return {
      achievement: maskedAchievement,
      userProgress: result.userProgress,
    };
  }
}

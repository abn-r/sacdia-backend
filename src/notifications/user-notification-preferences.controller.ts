import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { NotificationPreferencesService } from './notification-preferences.service';
import { FcmTokensService } from './fcm-tokens.service';
import {
  NotificationPreferencesResponseDto,
  PatchNotificationPreferencesDto,
  RegisterFcmTokenRequestDto,
} from './dto/notification-preferences.dto';
import { MOBILE_NOTIFICATION_CATEGORIES } from './notification-categories.constants';
import type { MobileNotificationCategory } from './notification-categories.constants';

/**
 * User-scoped notification preferences and FCM token management.
 *
 * These endpoints are consumed by the mobile app Settings screen.
 * They are intentionally separate from the admin-facing /notifications
 * controller to keep concerns clean.
 *
 * Base path: /api/v1/users/me/...
 */
@ApiTags('User Notification Preferences')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users/me')
export class UserNotificationPreferencesController {
  constructor(
    private readonly preferencesService: NotificationPreferencesService,
    private readonly fcmTokensService: FcmTokensService,
  ) {}

  // ---------------------------------------------------------------------------
  // Notification preferences
  // ---------------------------------------------------------------------------

  /**
   * GET /users/me/notification-preferences
   *
   * Returns the 5 mobile-facing preference toggles plus a synthetic
   * "master" flag (true when all 5 are enabled).
   *
   * Missing rows in DB default to enabled=true (opt-out model).
   */
  @Get('notification-preferences')
  @ApiOperation({
    summary: 'Get notification preferences for the authenticated user',
    description:
      'Returns the 5 user-facing category toggles plus a master flag. ' +
      'Categories without a DB row default to enabled=true (opt-out model).',
  })
  @ApiResponse({
    status: 200,
    description: 'Notification preferences',
    type: NotificationPreferencesResponseDto,
    schema: {
      example: {
        master: true,
        activities: true,
        achievements: true,
        approvals: true,
        invitations: true,
        reminders: true,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  async getPreferences(
    @Request() req,
  ): Promise<NotificationPreferencesResponseDto> {
    const userId: string = req.user.sub;
    return this.resolvePreferences(userId);
  }

  /**
   * PATCH /users/me/notification-preferences
   *
   * Partial update. All fields are optional.
   *
   * master=false → sets all 5 categories to false
   * master=true  → sets all 5 categories to true
   * Individual category toggle → upserts only that category
   *
   * If master and individual categories are both provided, master is applied
   * first, then individual overrides are applied on top.
   */
  @Patch('notification-preferences')
  @ApiOperation({
    summary: 'Update notification preferences',
    description:
      'Partial update. master=false disables all categories. ' +
      'Individual categories can be toggled independently. ' +
      'Returns the updated full preferences object.',
  })
  @ApiResponse({
    status: 200,
    description: 'Updated notification preferences',
    type: NotificationPreferencesResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  async patchPreferences(
    @Body() dto: PatchNotificationPreferencesDto,
    @Request() req,
  ): Promise<NotificationPreferencesResponseDto> {
    const userId: string = req.user.sub;

    // If master toggle provided, apply to all 5 categories first
    if (dto.master !== undefined) {
      await Promise.all(
        MOBILE_NOTIFICATION_CATEGORIES.map((cat) =>
          this.preferencesService.setPreference(userId, cat, dto.master!),
        ),
      );
    }

    // Apply individual overrides on top of master (if any)
    const individualUpdates: Array<[MobileNotificationCategory, boolean]> = [];

    if (dto.activities !== undefined)
      individualUpdates.push(['activities', dto.activities]);
    if (dto.achievements !== undefined)
      individualUpdates.push(['achievements', dto.achievements]);
    if (dto.approvals !== undefined)
      individualUpdates.push(['approvals', dto.approvals]);
    if (dto.invitations !== undefined)
      individualUpdates.push(['invitations', dto.invitations]);
    if (dto.reminders !== undefined)
      individualUpdates.push(['reminders', dto.reminders]);

    if (individualUpdates.length > 0) {
      await Promise.all(
        individualUpdates.map(([cat, enabled]) =>
          this.preferencesService.setPreference(userId, cat, enabled),
        ),
      );
    }

    return this.resolvePreferences(userId);
  }

  // ---------------------------------------------------------------------------
  // FCM token management
  // ---------------------------------------------------------------------------

  /**
   * POST /users/me/fcm-tokens
   *
   * Register a device FCM token for the authenticated user.
   * If the token already exists (from another user or inactive), it is
   * re-associated with the current user and re-activated.
   */
  @Post('fcm-tokens')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register an FCM token for the authenticated user',
    description:
      'Upserts the FCM token. If it already exists it is re-activated and ' +
      'reassociated to the calling user. Returns the token record (token value excluded).',
  })
  @ApiResponse({
    status: 201,
    description: 'FCM token registered',
    schema: {
      example: {
        fcm_token_id: 'uuid',
        user_id: 'uuid',
        device_type: 'ios',
        device_name: "Juan's iPhone",
        active: true,
        last_used: '2026-04-17T00:00:00.000Z',
        created_at: '2026-04-17T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  async registerFcmToken(
    @Body() dto: RegisterFcmTokenRequestDto,
    @Request() req,
  ) {
    return this.fcmTokensService.registerToken(req.user.sub, dto);
  }

  /**
   * DELETE /users/me/fcm-tokens/:tokenId
   *
   * Unregister a device token by its DB record ID (UUID).
   * The raw FCM token value is never exposed in the URL for security.
   */
  @Delete('fcm-tokens/:tokenId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Unregister an FCM token by record ID',
    description:
      'Deactivates the FCM token identified by its DB UUID. ' +
      'The caller must own the token — returns 403 otherwise.',
  })
  @ApiParam({
    name: 'tokenId',
    description: 'UUID of the user_fcm_tokens row',
  })
  @ApiResponse({ status: 204, description: 'FCM token unregistered' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Token belongs to a different user',
  })
  @ApiResponse({ status: 404, description: 'Token not found' })
  async unregisterFcmToken(
    @Param('tokenId', ParseUUIDPipe) tokenId: string,
    @Request() req,
  ): Promise<void> {
    await this.fcmTokensService.unregisterTokenById(tokenId, req.user.sub);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async resolvePreferences(
    userId: string,
  ): Promise<NotificationPreferencesResponseDto> {
    const allPrefs = await this.preferencesService.getUserPreferences(userId);

    const prefMap = new Map(allPrefs.map((p) => [p.category, p.enabled]));

    const getEnabled = (cat: string): boolean => prefMap.get(cat) ?? true;

    const activities = getEnabled('activities');
    const achievements = getEnabled('achievements');
    const approvals = getEnabled('approvals');
    const invitations = getEnabled('invitations');
    const reminders = getEnabled('reminders');

    const master =
      activities && achievements && approvals && invitations && reminders;

    return {
      master,
      activities,
      achievements,
      approvals,
      invitations,
      reminders,
    };
  }
}

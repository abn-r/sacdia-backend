import {
  Controller,
  Post,
  Body,
  Param,
  Delete,
  Get,
  Patch,
  Put,
  Request,
  UseGuards,
  ParseUUIDPipe,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  ParseEnumPipe,
} from '@nestjs/common';
import { AppBadRequestException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { FcmTokensService } from './fcm-tokens.service';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsBoolean,
} from 'class-validator';
import { AuthorizationResource, RequirePermissions } from '../common/decorators';
import {
  JwtAuthGuard,
  OwnerOrAdminGuard,
  PermissionsGuard,
} from '../common/guards';
import { NOTIFICATION_CATEGORIES } from './notification-categories.constants';

enum ClubInstanceType {
  adventurers = 'adventurers',
  pathfinders = 'pathfinders',
  master_guilds = 'master_guilds',
}

// DTOs
class UpdatePreferenceDto {
  @IsBoolean()
  enabled: boolean;
}

class SendNotificationDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  body: string;

  @IsObject()
  @IsOptional()
  data?: Record<string, string>;
}

class BroadcastNotificationDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  body: string;

  @IsObject()
  @IsOptional()
  data?: Record<string, string>;
}

class RegisterFcmTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @IsOptional()
  device_type?: string;

  @IsString()
  @IsOptional()
  device_name?: string;
}

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private notificationsService: NotificationsService,
    private fcmTokensService: FcmTokensService,
    private preferencesService: NotificationPreferencesService,
  ) {}

  @Post('send')
  @RequirePermissions('notifications:send')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'Send notification to specific user' })
  async sendToUser(@Body() dto: SendNotificationDto, @Request() req) {
    return this.notificationsService.sendToUser(
      dto,
      req.user.sub,
      'admin:manual_send',
    );
  }

  @Post('broadcast')
  @RequirePermissions('notifications:broadcast')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'Send notification to all users' })
  async broadcast(@Body() dto: BroadcastNotificationDto, @Request() req) {
    return this.notificationsService.broadcast(
      dto,
      req.user.sub,
      'admin:broadcast',
    );
  }

  @Post('club/:instanceType/:instanceId')
  @RequirePermissions('notifications:club')
  @AuthorizationResource({ type: 'active_assignment' }) // TODO(rbac): verify notifications:club is club-scoped in seed
  @ApiOperation({ summary: 'Send notification to club members' })
  async sendToClub(
    @Param('instanceType', new ParseEnumPipe(ClubInstanceType))
    instanceType: ClubInstanceType,
    @Param('instanceId', ParseIntPipe) instanceId: number,
    @Body() dto: BroadcastNotificationDto,
    @Request() req,
  ) {
    return this.notificationsService.sendToClubMembers(
      instanceId,
      dto,
      req.user.sub,
      'admin:club_send',
    );
  }

  @RequirePermissions('notifications:send')
  @Get('history')
  @ApiOperation({
    summary: 'Get paginated notification history',
    description:
      'Admins see notification audit logs scoped to their territory/scope; super_admin receives the unfiltered audit trail. Regular users see only their own notifications (target_type=user).',
  })
  async getHistory(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Request() req,
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    return this.notificationsService.getNotificationHistory(
      req.user.sub,
      page,
      safeLimit,
    );
  }

  // ---------------------------------------------------------------------------
  // Inbox helpers (unread count, mark read, mark all read)
  // ---------------------------------------------------------------------------

  @Get('unread-count')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get unread notification count for the current user',
    description:
      'Returns the number of notification_deliveries where read_at is null for the calling user.',
  })
  @ApiResponse({ status: 200, description: 'Unread count', schema: { example: { count: 3 } } })
  async getUnreadCount(@Request() req) {
    return this.notificationsService.getUnreadCount(req.user.sub);
  }

  @Patch('read-all')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Mark all unread notifications as read',
    description:
      'Bulk sets read_at = NOW() for all unread deliveries of the calling user.',
  })
  @ApiResponse({ status: 200, description: 'Count of updated rows', schema: { example: { updated: 5 } } })
  async markAllRead(@Request() req) {
    return this.notificationsService.markAllDeliveriesRead(req.user.sub);
  }

  @Patch(':deliveryId/read')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Mark a single notification delivery as read',
    description:
      'Sets read_at = NOW() for the given delivery. Returns 404 if not found or not owned by the caller.',
  })
  @ApiParam({ name: 'deliveryId', description: 'UUID of the notification_deliveries row' })
  @ApiResponse({ status: 200, description: 'Updated delivery row' })
  @ApiResponse({ status: 404, description: 'Delivery not found or not owned by caller' })
  async markRead(
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
    @Request() req,
  ) {
    return this.notificationsService.markDeliveryRead(deliveryId, req.user.sub);
  }

  // ---------------------------------------------------------------------------
  // Notification preferences (opt-out per category)
  // ---------------------------------------------------------------------------

  @Get('preferences')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get current user notification preferences',
    description:
      'Returns all known categories with their enabled status. Missing rows default to enabled=true (opt-out model).',
  })
  async getPreferences(@Request() req) {
    const preferences = await this.preferencesService.getUserPreferences(
      req.user.sub,
    );
    return { preferences };
  }

  @Put('preferences/:category')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Update notification preference for a category',
    description:
      'Upserts the enabled status for the given category. admin:* notifications cannot be opted out.',
  })
  async setPreference(
    @Param('category') category: string,
    @Body() dto: UpdatePreferenceDto,
    @Request() req,
  ) {
    const validCategory = NOTIFICATION_CATEGORIES.find((c) => c === category);
    if (!validCategory) {
      throw new AppBadRequestException(ErrorCode.NOTIF_INVALID_CATEGORY);
    }
    const preferences = await this.preferencesService.setPreference(
      req.user.sub,
      validCategory,
      dto.enabled,
    );
    return { preferences };
  }
}

@ApiTags('FCM Tokens')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fcm-tokens')
export class FcmTokensController {
  constructor(private fcmTokensService: FcmTokensService) {}

  @Post()
  @ApiOperation({ summary: 'Register FCM token' })
  async registerToken(@Body() dto: RegisterFcmTokenDto, @Request() req) {
    return this.fcmTokensService.registerToken(req.user.sub, dto);
  }

  @Delete('by-token')
  @ApiOperation({ summary: 'Unregister FCM token by token string' })
  async unregisterByToken(@Body('token') token: string, @Request() req) {
    return this.fcmTokensService.unregisterToken(token, req.user.sub);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Unregister FCM token by record ID' })
  async unregisterToken(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req,
  ) {
    return this.fcmTokensService.unregisterTokenById(id, req.user.sub);
  }

  @Get()
  @ApiOperation({ summary: 'Get current user FCM tokens' })
  async getMyTokens(@Request() req) {
    return this.fcmTokensService.getUserTokens(req.user.sub);
  }

  // Backwards compatible endpoint for admin/owner access
  @Get('user/:userId')
  @UseGuards(OwnerOrAdminGuard)
  @ApiOperation({ summary: 'Get FCM tokens by user ID (owner/admin only)' })
  async getUserTokens(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.fcmTokensService.getUserTokens(userId);
  }
}

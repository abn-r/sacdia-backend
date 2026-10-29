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
import {
  AuthorizationResource,
  RequirePermissions,
  SkipPermissions,
} from '../common/decorators';
import {
  JwtAuthGuard,
  OwnerOrAdminGuard,
  PermissionsGuard,
} from '../common/guards';
import { NOTIFICATION_CATEGORIES } from './notification-categories.constants';
import { ActingScope } from '../auth/acting-for/acting-scope.decorator';

enum ClubInstanceType {
  adventurers = 'adventurers',
  pathfinders = 'pathfinders',
  master_guilds = 'master_guilds',
}

// DTOs
class UpdatePreferenceDto {
  @IsBoolean()
  declare enabled: boolean;
}

class SendNotificationDto {
  @IsString()
  @IsNotEmpty()
  declare userId: string;

  @IsString()
  @IsNotEmpty()
  declare title: string;

  @IsString()
  @IsNotEmpty()
  declare body: string;

  @IsObject()
  @IsOptional()
  data?: Record<string, string>;
}

class BroadcastNotificationDto {
  @IsString()
  @IsNotEmpty()
  declare title: string;

  @IsString()
  @IsNotEmpty()
  declare body: string;

  @IsObject()
  @IsOptional()
  data?: Record<string, string>;
}

class RegisterFcmTokenDto {
  @IsString()
  @IsNotEmpty()
  declare token: string;

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
  @ApiResponse({ status: 201, description: 'Notification queued' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires notifications:send',
  })
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
  @ApiResponse({ status: 201, description: 'Broadcast queued' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires notifications:broadcast',
  })
  async broadcast(@Body() dto: BroadcastNotificationDto, @Request() req) {
    return this.notificationsService.broadcast(
      dto,
      req.user.sub,
      'admin:broadcast',
    );
  }

  @Post('club/:instanceType/:instanceId')
  @RequirePermissions('notifications:club')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Send notification to club members' })
  @ApiResponse({ status: 201, description: 'Club notification queued' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires notifications:club',
  })
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
      instanceType,
    );
  }

  @Get('targets/club')
  @RequirePermissions('notifications:club')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary: 'Get authorized club notification targets for current actor',
  })
  @ApiResponse({
    status: 200,
    description:
      'Returns only club targets authorized by active assignment scope for notifications:club',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires notifications:club',
  })
  async getAuthorizedClubTargets(@Request() req) {
    return this.notificationsService.getAuthorizedClubTargets(req.user.sub);
  }

  @Get('history')
  @ActingScope('self:read')
  @SkipPermissions()
  @ApiResponse({
    status: 200,
    description:
      "Paginated notification history. Regular users get inbox items { delivery_id, read_at, created_at, log_id, title, body, type, target_type, target_id, source }; `target_id` is the club section id for target_type club_section | section_role (the app uses it to open the right section), the recipient's own user id for target_type user, and null for any other target type.",
    schema: {
      example: {
        data: [
          {
            delivery_id: '3f1c0f6e-0a57-4a53-9d0c-6f1f4b0d2a11',
            read_at: null,
            created_at: '2026-10-28T15:04:00.000Z',
            log_id: 412,
            title: 'Nueva persona esperando aprobación',
            body: 'Hay una solicitud de membresía lista para revisar en tu sección.',
            type: 'SECTION_ROLE',
            target_type: 'section_role',
            target_id: '166',
            source: 'membership_requests:new_request',
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiOperation({
    summary: 'Get paginated notification history',
    description:
      'Authenticated users see their own inbox. Admins see notification audit logs scoped to their territory/scope; super-admin receives the unfiltered audit trail.',
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
  @ActingScope('self:read')
  @SkipPermissions()
  @UseGuards(JwtAuthGuard)
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiOperation({
    summary: 'Get unread notification count for the current user',
    description:
      'Returns the number of notification_deliveries where read_at is null for the calling user.',
  })
  @ApiResponse({
    status: 200,
    description: 'Unread count',
    schema: { example: { count: 3 } },
  })
  async getUnreadCount(@Request() req) {
    return this.notificationsService.getUnreadCount(req.user.sub);
  }

  @Patch('read-all')
  @ActingScope('self:read')
  @SkipPermissions()
  @UseGuards(JwtAuthGuard)
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiOperation({
    summary: 'Mark all unread notifications as read',
    description:
      'Bulk sets read_at = NOW() for all unread deliveries of the calling user.',
  })
  @ApiResponse({
    status: 200,
    description: 'Count of updated rows',
    schema: { example: { updated: 5 } },
  })
  async markAllRead(@Request() req) {
    return this.notificationsService.markAllDeliveriesRead(req.user.sub);
  }

  @Patch(':deliveryId/read')
  @ActingScope('self:read')
  @SkipPermissions()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Mark a single notification delivery as read',
    description:
      'Sets read_at = NOW() for the given delivery. Returns 404 if not found or not owned by the caller.',
  })
  @ApiParam({
    name: 'deliveryId',
    description: 'UUID of the notification_deliveries row',
  })
  @ApiResponse({ status: 200, description: 'Updated delivery row' })
  @ApiResponse({
    status: 404,
    description: 'Delivery not found or not owned by caller',
  })
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
  @SkipPermissions()
  @UseGuards(JwtAuthGuard)
  @ApiResponse({ status: 200, description: 'User notification preferences' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
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
  @SkipPermissions()
  @UseGuards(JwtAuthGuard)
  @ApiResponse({ status: 200, description: 'Preference updated' })
  @ApiResponse({ status: 400, description: 'Invalid notification category' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
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
@SkipPermissions()
export class FcmTokensController {
  constructor(private fcmTokensService: FcmTokensService) {}

  @Post()
  @ApiOperation({ summary: 'Register FCM token' })
  @ApiResponse({ status: 201, description: 'FCM token registered' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  async registerToken(@Body() dto: RegisterFcmTokenDto, @Request() req) {
    return this.fcmTokensService.registerToken(req.user.sub, dto);
  }

  @Delete('by-token')
  @ApiOperation({ summary: 'Unregister FCM token by token string' })
  @ApiResponse({ status: 200, description: 'FCM token unregistered' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  async unregisterByToken(@Body('token') token: string, @Request() req) {
    return this.fcmTokensService.unregisterToken(token, req.user.sub);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Unregister FCM token by record ID' })
  @ApiResponse({ status: 200, description: 'FCM token unregistered' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'Token record not found' })
  async unregisterToken(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req,
  ) {
    return this.fcmTokensService.unregisterTokenById(id, req.user.sub);
  }

  @Get()
  @ApiOperation({ summary: 'Get current user FCM tokens' })
  @ApiResponse({ status: 200, description: 'List of FCM tokens' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  async getMyTokens(@Request() req) {
    return this.fcmTokensService.getUserTokens(req.user.sub);
  }

  // Backwards compatible endpoint for admin/owner access
  @Get('user/:userId')
  @UseGuards(OwnerOrAdminGuard)
  @ApiOperation({
    summary:
      'Get FCM tokens by user ID (owner or admin/assistant-admin/super-admin)',
  })
  @ApiResponse({ status: 200, description: 'List of FCM tokens for user' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — must be owner or admin',
  })
  async getUserTokens(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.fcmTokensService.getUserTokens(userId);
  }
}

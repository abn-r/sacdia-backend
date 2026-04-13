import {
  Controller,
  Post,
  Body,
  Param,
  Delete,
  Get,
  Put,
  Request,
  UseGuards,
  ParseUUIDPipe,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  BadRequestException,
  ParseEnumPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
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
import { RequirePermissions } from '../common/decorators';
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

  // TODO [SECURITY M-2]: Admin notification history shows ALL logs regardless of
  // the admin's territory/scope. A local field admin can currently see notification
  // logs for all users across all clubs and fields.
  // Fix: retrieve the caller's authorization context (local_field_id or union_id)
  // via AuthorizationContextService and pass it to getNotificationHistory so the
  // service can filter notification_logs by the scoped territory. Only super_admin
  // should receive unfiltered results. This requires extending both the service
  // query and the AuthorizationContextService to expose scope information.
  @Get('history')
  @ApiOperation({
    summary: 'Get paginated notification history',
    description:
      'Admins (admin|super_admin) see all logs. Regular users see only their own notifications (target_type=user). NOTE: admin scope restriction by territory is pending implementation.',
  })
  async getHistory(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Request() req,
  ) {
    return this.notificationsService.getNotificationHistory(
      req.user.sub,
      page,
      limit,
    );
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
      throw new BadRequestException(
        `Unknown category "${category}". Valid categories: ${NOTIFICATION_CATEGORIES.join(', ')}`,
      );
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

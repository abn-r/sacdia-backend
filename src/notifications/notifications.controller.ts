import {
  Controller,
  Post,
  Body,
  Param,
  Delete,
  Get,
  Request,
  UseGuards,
  ParseUUIDPipe,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { FcmTokensService } from './fcm-tokens.service';
import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';
import { GlobalRoles } from '../common/decorators';
import { RequirePermissions } from '../common/decorators';
import {
  JwtAuthGuard,
  OwnerOrAdminGuard,
  PermissionsGuard,
  GlobalRolesGuard,
} from '../common/guards';

// DTOs
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
  ) {}

  @Post('send')
  @RequirePermissions('notifications:send')
  @ApiOperation({ summary: 'Send notification to specific user' })
  async sendToUser(@Body() dto: SendNotificationDto, @Request() req) {
    return this.notificationsService.sendToUser(dto, req.user.sub);
  }

  @Post('broadcast')
  @RequirePermissions('notifications:broadcast')
  @ApiOperation({ summary: 'Send notification to all users' })
  async broadcast(@Body() dto: BroadcastNotificationDto, @Request() req) {
    return this.notificationsService.broadcast(dto, req.user.sub);
  }

  @Post('club/:instanceType/:instanceId')
  @RequirePermissions('notifications:club')
  @ApiOperation({ summary: 'Send notification to club members' })
  async sendToClub(
    @Param('instanceType')
    instanceType: 'adventurers' | 'pathfinders' | 'master_guilds',
    @Param('instanceId') instanceId: string,
    @Body() dto: BroadcastNotificationDto,
    @Request() req,
  ) {
    return this.notificationsService.sendToClubMembers(
      parseInt(instanceId),
      dto,
      req.user.sub,
    );
  }

  @Get('history')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles('admin', 'super_admin')
  @ApiOperation({ summary: 'Get paginated notification history' })
  async getHistory(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.notificationsService.getNotificationHistory(page, limit);
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

  @Delete(':id')
  @ApiOperation({ summary: 'Unregister FCM token by record ID' })
  async unregisterToken(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
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

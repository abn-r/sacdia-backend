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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { FcmTokensService } from './fcm-tokens.service';
import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';
import { GlobalRoles } from '../common/decorators/global-roles.decorator';
import {
  GlobalRolesGuard,
  JwtAuthGuard,
  OwnerOrAdminGuard,
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
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private notificationsService: NotificationsService,
    private fcmTokensService: FcmTokensService,
  ) {}

  @Post('send')
  @ApiOperation({ summary: 'Send notification to specific user' })
  async sendToUser(@Body() dto: SendNotificationDto) {
    return this.notificationsService.sendToUser(dto);
  }

  @Post('broadcast')
  @UseGuards(GlobalRolesGuard)
  @GlobalRoles('super_admin', 'admin')
  @ApiOperation({ summary: 'Send notification to all users' })
  async broadcast(@Body() dto: BroadcastNotificationDto) {
    return this.notificationsService.broadcast(dto);
  }

  @Post('club/:instanceType/:instanceId')
  @UseGuards(GlobalRolesGuard)
  @GlobalRoles('super_admin', 'admin')
  @ApiOperation({ summary: 'Send notification to club members' })
  async sendToClub(
    @Param('instanceType')
    instanceType: 'adventurers' | 'pathfinders' | 'master_guilds',
    @Param('instanceId') instanceId: string,
    @Body() dto: BroadcastNotificationDto,
  ) {
    return this.notificationsService.sendToClubMembers(
      parseInt(instanceId),
      instanceType,
      dto,
    );
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

  @Delete(':token')
  @ApiOperation({ summary: 'Unregister FCM token' })
  async unregisterToken(@Param('token') token: string, @Request() req) {
    return this.fcmTokensService.unregisterToken(token, req.user.sub);
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

import {
  Controller,
  Post,
  Body,
  Param,
  Delete,
  Get,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { FcmTokensService } from './fcm-tokens.service';
import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

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
  @ApiOperation({ summary: 'Send notification to all users' })
  async broadcast(@Body() dto: BroadcastNotificationDto) {
    return this.notificationsService.broadcast(dto);
  }

  @Post('club/:instanceType/:instanceId')
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
@Controller('fcm-tokens')
export class FcmTokensController {
  constructor(private fcmTokensService: FcmTokensService) {}

  @Post()
  @ApiOperation({ summary: 'Register FCM token' })
  async registerToken(@Body() dto: RegisterFcmTokenDto & { userId: string }) {
    return this.fcmTokensService.registerToken(dto.userId, dto);
  }

  @Delete(':token')
  @ApiOperation({ summary: 'Unregister FCM token' })
  async unregisterToken(@Param('token') token: string) {
    return this.fcmTokensService.unregisterToken(token);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get user FCM tokens' })
  async getUserTokens(@Param('userId') userId: string) {
    return this.fcmTokensService.getUserTokens(userId);
  }
}

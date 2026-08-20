import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GlobalRoles } from '../common/decorators';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { JwtAuthGuard, GlobalRolesGuard } from '../common/guards';
import {
  NotificationCategorySettingDto,
  NotificationStatsQueryDto,
  NotificationStatsResponseDto,
  PatchNotificationCategorySettingDto,
} from './dto';
import { AdminNotificationsService } from './admin-notifications.service';
import { NotificationCategorySettingsService } from '../notifications/notification-category-settings.service';

@ApiTags('admin-notifications')
@ApiBearerAuth()
@Controller('admin/notifications')
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
@GlobalRoles('admin', 'super-admin')
@SkipPermissions()
export class AdminNotificationsController {
  constructor(
    private readonly adminNotificationsService: AdminNotificationsService,
    private readonly categorySettingsService: NotificationCategorySettingsService,
  ) {}

  @Get('stats')
  @ApiOperation({
    summary: 'FCM notification delivery metrics for administrators',
    description:
      'Returns active/inactive FCM token counts and a per-day delivery success rate. ' +
      'Requires admin or super-admin global role.',
  })
  @ApiOkResponse({
    description: 'Notification delivery stats',
    type: NotificationStatsResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid JWT',
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not have admin or super-admin global role',
  })
  async getStats(
    @Query() query: NotificationStatsQueryDto,
  ): Promise<NotificationStatsResponseDto> {
    return this.adminNotificationsService.getStats(query);
  }

  @Get('categories')
  @ApiOperation({
    summary: 'List global notification category delivery settings',
  })
  @ApiOkResponse({
    description: 'Notification category settings',
    type: NotificationCategorySettingDto,
    isArray: true,
  })
  async listCategorySettings(): Promise<NotificationCategorySettingDto[]> {
    return this.categorySettingsService.listCategorySettings();
  }

  @Patch('categories')
  @ApiOperation({
    summary: 'Update a notification category delivery setting',
  })
  @ApiOkResponse({
    description: 'Updated notification category settings',
    type: NotificationCategorySettingDto,
    isArray: true,
  })
  async patchCategorySetting(
    @Body() dto: PatchNotificationCategorySettingDto,
  ): Promise<NotificationCategorySettingDto[]> {
    return this.categorySettingsService.updateCategorySetting(dto.category, {
      mobileEnabled: dto.mobileEnabled,
      defaultEnabled: dto.defaultEnabled,
    });
  }
}

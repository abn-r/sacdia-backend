import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { GlobalRoles } from '../common/decorators';
import { JwtAuthGuard, GlobalRolesGuard } from '../common/guards';
import { NotificationStatsQueryDto, NotificationStatsResponseDto } from './dto';
import { AdminNotificationsService } from './admin-notifications.service';

@ApiTags('admin-notifications')
@ApiBearerAuth()
@Controller('admin/notifications')
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
@GlobalRoles('admin', 'super-admin')
export class AdminNotificationsController {
  constructor(
    private readonly adminNotificationsService: AdminNotificationsService,
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
  async getStats(
    @Query() query: NotificationStatsQueryDto,
  ): Promise<NotificationStatsResponseDto> {
    return this.adminNotificationsService.getStats(query);
  }
}

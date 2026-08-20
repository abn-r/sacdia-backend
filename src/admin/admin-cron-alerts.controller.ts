import {
  Controller,
  Get,
  Post,
  Param,
  ParseIntPipe,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import { JwtAuthGuard, GlobalRolesGuard } from '../common/guards';
import { GlobalRoles } from '../common/decorators';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { AdminCronAlertsService } from './admin-cron-alerts.service';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
@GlobalRoles('admin', 'super-admin')
@SkipPermissions()
@Controller('admin/cron-alerts')
export class AdminCronAlertsController {
  constructor(private readonly cronAlertsService: AdminCronAlertsService) {}

  // ──────────────────────────────────────────────────────────────────────────
  // GET /admin/cron-alerts — paginated alert history
  // ──────────────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'Paginated cron alert history',
    description:
      'Returns the history of automated cron job alerts from cron_alerts_log. ' +
      'Supports filtering by job name, since date, and resolved/open status.',
  })
  @ApiQuery({
    name: 'jobName',
    required: false,
    description: 'Filter by job name',
  })
  @ApiQuery({
    name: 'since',
    required: false,
    description: 'ISO date — only alerts after this timestamp',
  })
  @ApiQuery({
    name: 'unresolved',
    required: false,
    type: Boolean,
    description: 'When true, return only open (unresolved) alerts',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default 20, max 100)',
  })
  @ApiOkResponse({
    description: 'Paginated alert history',
    schema: {
      properties: {
        status: { type: 'string', example: 'ok' },
        data: {
          type: 'object',
          properties: {
            total: { type: 'number' },
            page: { type: 'number' },
            limit: { type: 'number' },
            items: { type: 'array' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Caller does not have admin or super-admin global role',
  })
  async getCronAlerts(
    @Query('jobName') jobName?: string,
    @Query('since') since?: string,
    @Query('unresolved') unresolved?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.cronAlertsService.getAlertHistory({
      jobName,
      since,
      unresolved: unresolved === 'true',
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { status: 'ok', data };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // POST /admin/cron-alerts/:id/resolve — manual resolution
  // ──────────────────────────────────────────────────────────────────────────

  @Post(':id/resolve')
  @GlobalRoles('super-admin')
  @ApiOperation({
    summary: 'Manually resolve a cron alert (super-admin only)',
    description:
      'Sets resolved_at = now() on the given cron_alerts_log row, closing the open alert. ' +
      'The action is audited via the caller user ID.',
  })
  @ApiParam({ name: 'id', description: 'cron_alerts_log.id', type: Number })
  @ApiOkResponse({
    description: 'Alert resolved successfully',
    schema: {
      properties: {
        status: { type: 'string', example: 'ok' },
        data: { type: 'object' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Caller does not have super-admin global role',
  })
  @ApiResponse({
    status: 404,
    description: 'cron_alerts_log row not found for the given id',
  })
  async resolveAlert(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: ExpressRequest & { user: { sub: string } },
  ) {
    const actorId = req.user.sub;
    const data = await this.cronAlertsService.resolveAlert(id, actorId);
    return { status: 'ok', data };
  }
}

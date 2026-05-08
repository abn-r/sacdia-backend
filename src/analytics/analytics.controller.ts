import {
  Controller,
  Get,
  Optional,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import { JwtAuthGuard, GlobalRolesGuard } from '../common/guards';
import { GlobalRoles } from '../common/decorators';
import { AnalyticsService } from './analytics.service';
import { SlaDashboardDto } from './dto/sla-dashboard.dto';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { JobsOverviewService, JobsOverviewDto } from './jobs-overview.service';
import {
  CronRunsService,
  CronRunsSummaryDto,
  CronHistoryPage,
} from './cron-runs.service';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly authorizationContext: AuthorizationContextService,
    @Optional()
    private readonly jobsOverviewService: JobsOverviewService | undefined,
    private readonly cronRunsService: CronRunsService,
  ) {}

  @Get('sla-dashboard')
  @GlobalRoles('admin', 'coordinator')
  @ApiOperation({
    summary: 'SLA Dashboard',
    description:
      'Returns aggregated SLA metrics for investiture pipeline, validation queues, camporee approvals, timing, and throughput. ' +
      'Coordinators are automatically scoped to their local_field_id. ' +
      'Cached for 60 seconds.',
  })
  @ApiOkResponse({
    description: 'SLA Dashboard data',
    type: SlaDashboardDto,
  })
  async getSlaDashboard(
    @Request() req: ExpressRequest & { user: { sub: string } },
  ): Promise<{ status: string; data: SlaDashboardDto }> {
    const userId = req.user.sub;

    // Coordinators are scoped to their local_field_id; admins see the global view
    const localFieldId = await this.resolveLocalFieldScope(userId);

    const data = await this.analyticsService.getSlaDashboard(localFieldId);

    return { status: 'ok', data };
  }

  @Get('jobs-overview')
  @GlobalRoles('admin', 'super-admin')
  @ApiOperation({
    summary: 'Overview de jobs y colas BullMQ (admin only)',
    description:
      'Returns job counts per queue (waiting, active, completed, failed, delayed, paused) ' +
      'and the 20 most recent failed jobs across all BullMQ queues. ' +
      'Requires Redis to be configured; returns 503 implicitly when queues are unavailable.',
  })
  @ApiOkResponse({
    description: 'Jobs overview data',
    schema: {
      properties: {
        status: { type: 'string', example: 'ok' },
        data: { $ref: '#/components/schemas/JobsOverviewDto' },
      },
    },
  })
  async getJobsOverview(): Promise<{ status: string; data: JobsOverviewDto }> {
    if (!this.jobsOverviewService) {
      throw new ServiceUnavailableException(
        'Queue service unavailable: Redis is not configured',
      );
    }
    const data = await this.jobsOverviewService.getOverview();
    return { status: 'ok', data };
  }

  @Post('jobs/:queue/:jobId/retry')
  @GlobalRoles('super-admin')
  @ApiOperation({ summary: 'Retry failed BullMQ job (super-admin only)' })
  @ApiParam({ name: 'queue', description: 'Queue name' })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  async retryJob(
    @Param('queue') queue: string,
    @Param('jobId') jobId: string,
  ): Promise<{ status: string }> {
    if (!this.jobsOverviewService) {
      throw new ServiceUnavailableException('Jobs service unavailable');
    }
    await this.jobsOverviewService.retryFailedJob(queue, jobId);
    return { status: 'ok' };
  }

  @Get('queues/:queueName/health')
  @GlobalRoles('admin', 'super-admin')
  @ApiOperation({
    summary: 'Queue health snapshot (admin only)',
    description:
      'Returns job counts (active, waiting, completed, failed, delayed) and ' +
      'paused status for a single BullMQ queue. ' +
      'Supported queues: notifications, achievements, emails, background-jobs.',
  })
  @ApiParam({
    name: 'queueName',
    description: 'BullMQ queue name',
    example: 'background-jobs',
  })
  @ApiOkResponse({
    description: 'Queue health data',
    schema: {
      properties: {
        status: { type: 'string', example: 'ok' },
        data: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            active: { type: 'number' },
            waiting: { type: 'number' },
            completed: { type: 'number' },
            failed: { type: 'number' },
            delayed: { type: 'number' },
            paused: { type: 'boolean' },
          },
        },
      },
    },
  })
  async getQueueHealth(
    @Param('queueName') queueName: string,
  ): Promise<{ status: string; data: object }> {
    if (!this.jobsOverviewService) {
      throw new ServiceUnavailableException(
        'Queue service unavailable: Redis is not configured',
      );
    }
    const data = await this.jobsOverviewService.getQueueHealth(queueName);
    return { status: 'ok', data };
  }

  @Get('cron-runs')
  @GlobalRoles('admin', 'super-admin')
  @ApiOperation({ summary: 'Resumen de ejecuciones de cron jobs (admin only)' })
  @ApiOkResponse({
    description: 'Cron runs summary',
    schema: {
      properties: {
        status: { type: 'string', example: 'ok' },
        data: { $ref: '#/components/schemas/CronRunsSummaryDto' },
      },
    },
  })
  async getCronRuns(): Promise<{ status: string; data: CronRunsSummaryDto }> {
    const data = await this.cronRunsService.getSummary();
    return { status: 'ok', data };
  }

  @Get('cron-runs/history')
  @GlobalRoles('admin', 'super-admin')
  @ApiOperation({ summary: 'Historial paginado de cron runs con filtros' })
  @ApiQuery({ name: 'job_name', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['running', 'completed', 'failed', 'skipped'],
  })
  @ApiQuery({ name: 'since', required: false, description: 'ISO date string' })
  @ApiQuery({ name: 'until', required: false, description: 'ISO date string' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getCronRunsHistory(
    @Query('job_name') jobName?: string,
    @Query('status') status?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ): Promise<{ status: string; data: CronHistoryPage }> {
    const data = await this.cronRunsService.getHistory({
      jobName,
      status,
      since,
      until,
      page,
      limit,
    });
    return { status: 'ok', data };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Returns the local_field_id if the user is a coordinator (and NOT an admin).
   * Admins see the global view (no filter).
   */
  private async resolveLocalFieldScope(
    userId: string,
  ): Promise<number | undefined> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);

    const roleNames = resolved.authorization.grants.global_roles.map((g) =>
      g.role_name.toLowerCase(),
    );

    const isAdmin = roleNames.some((r) =>
      ['admin', 'assistant-admin', 'super-admin'].includes(r),
    );

    if (isAdmin) {
      return undefined;
    }

    // For coordinators, return the local_field_id from their effective scope
    const scopeLocalFieldId =
      resolved.authorization.effective.scope.global.local_field?.id;

    if (typeof scopeLocalFieldId === 'number') {
      return scopeLocalFieldId;
    }

    // Fallback: use the local_field_id from the user's profile
    const profileLocalFieldId = resolved.profile.local_field_id;
    return typeof profileLocalFieldId === 'number'
      ? profileLocalFieldId
      : undefined;
  }
}

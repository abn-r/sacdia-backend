import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import { JwtAuthGuard, GlobalRolesGuard } from '../../common/guards';
import { GlobalRoles } from '../../common/decorators';
import { SkipPermissions } from '../../common/decorators/skip-permissions.decorator';
import { namedThrottle } from '../../config/throttler.helpers';
import {
  AdminCronJobsService,
  type CronJobRunResult,
} from './admin-cron-jobs.service';
import type { CronJobListItem } from './cron-job.registry';

/**
 * Scheduled jobs on demand ("Ejecutar ahora").
 *
 * Super-admin only. No `@ActingScope` anywhere: a guardian acting for a
 * dependent, a supervised teen and a linked device are denied by default
 * (admin routes are "never-scope").
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
@GlobalRoles('super-admin')
@SkipPermissions()
@Controller('admin/cron-jobs')
export class AdminCronJobsController {
  constructor(private readonly cronJobsService: AdminCronJobsService) {}

  @Get()
  @ApiOperation({
    summary: 'List the scheduled jobs that can be run on demand (super-admin)',
    description:
      'Allowlist of every @Cron job with its cron expression (5 fields) and time zone. `runnable` is false when the owning provider is not running in this app.',
  })
  @ApiOkResponse({ description: 'Allowlisted jobs' })
  @ApiResponse({ status: 403, description: 'Caller is not a super-admin' })
  list(): { status: 'success'; data: { jobs: CronJobListItem[] } } {
    return { status: 'success', data: { jobs: this.cronJobsService.list() } };
  }

  @Post(':jobName/run')
  @HttpCode(200)
  @Throttle(namedThrottle({ ttl: 60000, limit: 10 }))
  @ApiOperation({
    summary: 'Run a scheduled job now (super-admin)',
    description:
      'Runs the job through the same entry point the scheduler uses (same distributed lock, same cron_run_log row, marked metadata.trigger = manual) and waits for it to finish. A job whose lock is held, or that is already running manually, returns status "skipped". Jobs backed by a queue return "enqueued": true and finish in the worker. The action is audited as admin.cron_job.run.',
  })
  @ApiParam({ name: 'jobName', description: 'Name from GET /admin/cron-jobs' })
  @ApiOkResponse({ description: 'Result of the run' })
  @ApiResponse({ status: 403, description: 'Caller is not a super-admin' })
  @ApiResponse({
    status: 404,
    description: 'CRON_JOB_NOT_FOUND: unknown or non-allowlisted job',
  })
  async run(
    @Param('jobName') jobName: string,
    @Request() req: ExpressRequest & { user: { sub: string } },
  ): Promise<{ status: 'success'; data: CronJobRunResult }> {
    const data = await this.cronJobsService.run(jobName, req.user.sub);
    return { status: 'success', data };
  }
}

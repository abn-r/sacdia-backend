import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AppNotFoundException,
  AppConflictException,
  AppBadRequestException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor';
import { ACHIEVEMENTS_QUEUE } from '../achievements/achievements.constants';
import { DATA_EXPORTS_QUEUE } from '../data-export/data-export.processor';

export interface JobCounts {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export interface FailedJob {
  job_id: string | number | null;
  queue: string;
  name: string;
  failed_reason: string | null;
  attempts: number;
  timestamp: string | null;
}

export interface JobsOverviewDto {
  queues: JobCounts[];
  recent_failed: FailedJob[];
}

@Injectable()
export class JobsOverviewService {
  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notificationsQueue: Queue,
    @InjectQueue(ACHIEVEMENTS_QUEUE)
    private readonly achievementsQueue: Queue,
    @InjectQueue(DATA_EXPORTS_QUEUE)
    private readonly dataExportsQueue: Queue,
  ) {}

  async getOverview(): Promise<JobsOverviewDto> {
    const queues: Array<{ name: string; queue: Queue }> = [
      { name: NOTIFICATIONS_QUEUE, queue: this.notificationsQueue },
      { name: ACHIEVEMENTS_QUEUE, queue: this.achievementsQueue },
      { name: DATA_EXPORTS_QUEUE, queue: this.dataExportsQueue },
    ];

    const queueStats: JobCounts[] = await Promise.all(
      queues.map(async ({ name, queue }) => {
        const counts = await queue.getJobCounts(
          'waiting',
          'active',
          'completed',
          'failed',
          'delayed',
          'paused',
        );
        return {
          name,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
          paused: counts.paused ?? 0,
        };
      }),
    );

    const failedGroups = await Promise.all(
      queues.map(async ({ name, queue }) => {
        const jobs = await queue.getFailed(0, 19);
        return jobs.map<FailedJob>((j) => ({
          job_id: j.id ?? null,
          queue: name,
          name: j.name,
          failed_reason: j.failedReason ?? null,
          attempts: j.attemptsMade,
          timestamp: j.finishedOn
            ? new Date(j.finishedOn).toISOString()
            : null,
        }));
      }),
    );

    const recent_failed = failedGroups
      .flat()
      .sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))
      .slice(0, 20);

    return { queues: queueStats, recent_failed };
  }

  async retryFailedJob(queueName: string, jobId: string): Promise<void> {
    if (!this.notificationsQueue || !this.achievementsQueue || !this.dataExportsQueue) {
      throw new ServiceUnavailableException('Queues unavailable (Redis not configured)');
    }

    const queueMap: Record<string, Queue> = {
      [NOTIFICATIONS_QUEUE]: this.notificationsQueue,
      [ACHIEVEMENTS_QUEUE]: this.achievementsQueue,
      [DATA_EXPORTS_QUEUE]: this.dataExportsQueue,
    };
    const queue = queueMap[queueName];
    if (!queue) throw new AppNotFoundException(ErrorCode.ANALYTICS_QUEUE_NOT_FOUND);

    const job = await queue.getJob(jobId);
    if (!job) throw new AppNotFoundException(ErrorCode.ANALYTICS_JOB_NOT_FOUND);

    const state = await job.getState();
    if (state === 'active') {
      throw new AppConflictException(ErrorCode.ANALYTICS_JOB_ACTIVE);
    }
    if (state !== 'failed') {
      throw new AppBadRequestException(ErrorCode.ANALYTICS_JOB_RETRY_FAILED);
    }

    await job.retry();
  }
}

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/node';
import { master_honor_requirement_group_type_enum } from '@prisma/client';
import {
  MasterHonorJob,
  MASTER_HONORS_QUEUE,
  MASTER_HONOR_RECALCULATION_BATCH_DELAY_MS,
  MASTER_HONOR_RECALCULATION_BATCH_SIZE,
} from './master-honors.constants';
import { PrismaService } from '../prisma/prisma.service';
import { MasterHonorsEvaluatorService } from './master-honors-evaluator.service';

@Processor(MASTER_HONORS_QUEUE)
export class MasterHonorsRecalculationProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(MasterHonorsRecalculationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evaluator: MasterHonorsEvaluatorService,
  ) {
    super();
  }

  onApplicationBootstrap() {
    this.worker.on('error', (err: Error) => {
      this.logger.error(`BullMQ worker error: ${err.message}`, err.stack);
    });

    this.worker.on('failed', (job: Job | undefined, error: Error) => {
      this.logger.error(
        `Job ${job?.id ?? 'unknown'} (${job?.name ?? 'unknown'}) failed: ${error.message}`,
      );
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(error, {
          tags: {
            bullmq: true,
            queue: MASTER_HONORS_QUEUE,
            job_name: job?.name ?? 'unknown',
          },
          extra: {
            job_id: job?.id,
            attempts: job?.attemptsMade,
            failed_reason: job?.failedReason,
          },
        });
      }
    });
  }

  async process(job: Job<MasterHonorJob>) {
    switch (job.data.kind) {
      case 'user':
        return this.processUserJob(job.data);
      case 'master-honor':
        return this.processMasterHonorJob(job.data.masterHonorId);
      case 'all':
        return this.processAllUsersJob();
      default:
        this.logger.warn(
          `Master honors recalculation: unknown job type ${(job.data as { kind: string }).kind}`,
        );
        return { processed: 0, users: 0 };
    }
  }

  private async processUserJob(data: {
    userId: string;
    masterHonorId?: number;
  }) {
    const jobId = this.generateJobId();

    await this.evaluator.evaluateUser(data.userId, {
      masterHonorId: data.masterHonorId,
      jobId: `bull:${jobId}`,
    });

    return {
      processed: 1,
      users: 1,
    };
  }

  private async processMasterHonorJob(masterHonorId: number) {
    const users = await this.getUsersAffectedByMasterHonor(masterHonorId);

    if (users.length === 0) {
      this.logger.warn(
        `Master honors recalculation: no affected users found for master_honor_id=${masterHonorId}`,
      );
      return { processed: 0, users: 0 };
    }

    return this.processUsersInBatches(users, {
      masterHonorId,
      jobTag: `master-honor:${masterHonorId}`,
    });
  }

  private async processAllUsersJob() {
    const [approvedHonorRows, existingMasterHonorRows] = await Promise.all([
      this.prisma.users_honors.findMany({
        where: {
          validation_status: 'APPROVED',
          active: true,
        },
        select: { user_id: true },
        distinct: ['user_id'],
      }),
      this.prisma.users_master_honors.findMany({
        where: {
          active: true,
        },
        select: { user_id: true },
        distinct: ['user_id'],
      }),
    ]);

    const users = new Set<string>([
      ...approvedHonorRows.map((row) => row.user_id),
      ...existingMasterHonorRows.map((row) => row.user_id),
    ]);

    const usersArray = Array.from(users);

    if (usersArray.length === 0) {
      return { processed: 0, users: 0 };
    }

    return this.processUsersInBatches(usersArray, {
      jobTag: 'all-users',
    });
  }

  private async processUsersInBatches(
    users: string[],
    opts: { masterHonorId?: number; jobTag: string },
  ) {
    let processed = 0;

    for (let i = 0; i < users.length; i += MASTER_HONOR_RECALCULATION_BATCH_SIZE) {
      const batch = users.slice(i, i + MASTER_HONOR_RECALCULATION_BATCH_SIZE);
      const jobId = this.generateJobId();

      await Promise.all(
        batch.map(async (userId) => {
          try {
            await this.evaluator.evaluateUser(userId, {
              masterHonorId: opts.masterHonorId,
              jobId: `bull:${opts.jobTag}:${jobId}`,
            });
            processed += 1;
          } catch (error: unknown) {
            this.logger.warn(
              `Failed to recalc master honors for user ${userId}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }),
      );

      if (i + MASTER_HONOR_RECALCULATION_BATCH_SIZE < users.length) {
        await new Promise((resolve) =>
          setTimeout(resolve, MASTER_HONOR_RECALCULATION_BATCH_DELAY_MS),
        );
      }
    }

    return {
      processed,
      users: users.length,
    };
  }

  private async getUsersAffectedByMasterHonor(masterHonorId: number): Promise<string[]> {
    const [existingRecordRows, masterHonor] = await Promise.all([
      this.prisma.users_master_honors.findMany({
        where: {
          master_honor_id: masterHonorId,
          active: true,
        },
        select: { user_id: true },
        distinct: ['user_id'],
      }),
      this.prisma.master_honors.findUnique({
        where: { master_honor_id: masterHonorId },
        select: {
          master_honor_id: true,
          requirement_groups: {
            where: { active: true },
            select: {
              group_type: true,
              honors_category_id: true,
              options: {
                where: {
                  active: true,
                  honors: {
                    some: { active: true },
                  },
                },
                select: {
                  honors: {
                    where: { active: true },
                    select: { honor_id: true },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const users = new Set(existingRecordRows.map((row) => row.user_id));

    if (!masterHonor) {
      return Array.from(users);
    }

    const explicitHonorIds = new Set<number>();
    const relatedCategoryIds = new Set<number>();

    for (const group of masterHonor.requirement_groups) {
      if (group.group_type === master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS) {
        for (const option of group.options) {
          for (const honor of option.honors) {
            explicitHonorIds.add(honor.honor_id);
          }
        }
      }

      if (
        group.group_type === master_honor_requirement_group_type_enum.CATEGORY_COUNT &&
        group.honors_category_id !== null
      ) {
        relatedCategoryIds.add(group.honors_category_id);
      }
    }

    const affectedRows = [
      ...explicitHonorIds.size
        ? [
            await this.prisma.users_honors.findMany({
              where: {
                active: true,
                validation_status: 'APPROVED',
                honor_id: {
                  in: Array.from(explicitHonorIds),
                },
              },
              select: { user_id: true },
              distinct: ['user_id'],
            }),
          ]
        : [],
      ...relatedCategoryIds.size
        ? [
            await this.prisma.users_honors.findMany({
              where: {
                active: true,
                validation_status: 'APPROVED',
                honors: {
                  honors_category_id: {
                    in: Array.from(relatedCategoryIds),
                  },
                },
              },
              select: { user_id: true },
              distinct: ['user_id'],
            }),
          ]
        : [],
    ];

    for (const row of affectedRows.flat()) {
      users.add(row.user_id);
    }

    return Array.from(users);
  }

  private generateJobId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

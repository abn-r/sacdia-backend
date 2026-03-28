import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job } from 'bullmq';
import { firebaseAdmin } from '../config/firebase-admin.module';
import { PrismaService } from '../prisma/prisma.service';
import { FcmTokensService } from './fcm-tokens.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { isUuid, chunkArray } from '../common/utils/notification.utils';

export const NOTIFICATIONS_QUEUE = 'notifications';

export type NotificationJobType =
  | 'send-to-user'
  | 'send-to-section-role'
  | 'send-to-global-role'
  | 'broadcast';

export interface SendToUserJobData {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sentBy: string;
  source?: string;
}

export interface SendToSectionRoleJobData {
  clubSectionId: number;
  roleNames: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
  source?: string;
}

export interface SendToGlobalRoleJobData {
  roleNames: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
  localFieldId?: number;
  source?: string;
  unionId?: number;
}

export interface BroadcastJobData {
  title: string;
  body: string;
  data?: Record<string, string>;
  sentBy: string;
  source?: string;
}

export type NotificationJobData =
  | SendToUserJobData
  | SendToSectionRoleJobData
  | SendToGlobalRoleJobData
  | BroadcastJobData;

/**
 * FCM error codes that indicate a token is permanently invalid and should be
 * deactivated. Transient errors (rate limits, server errors, etc.) are NOT
 * included — those tokens should be retried, not discarded.
 */
const PERMANENT_FCM_ERROR_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
]);

@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fcmTokensService: FcmTokensService,
    private readonly preferencesService: NotificationPreferencesService,
  ) {
    super();
  }

  /**
   * Attach error/stalled event listeners to the BullMQ worker so that
   * Redis connection drops and job failures never emit an unhandled 'error'
   * event, which would crash the Node process.
   *
   * Must be in onApplicationBootstrap (not onModuleInit) — the WorkerHost
   * internal _worker instance is only available after all modules are
   * initialized and BullRegistrar has run.
   */
  onApplicationBootstrap() {
    this.worker.on('error', (err: Error) => {
      this.logger.error(`BullMQ worker error: ${err.message}`, err.stack);
    });

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      this.logger.error(
        `Job ${job?.id ?? 'unknown'} (${job?.name ?? 'unknown'}) failed: ${err.message}`,
      );
    });
  }

  async process(job: Job<NotificationJobData, unknown, NotificationJobType>) {
    switch (job.name) {
      case 'send-to-user':
        return this.handleSendToUser(job as Job<SendToUserJobData>);
      case 'send-to-section-role':
        return this.handleSendToSectionRole(
          job as Job<SendToSectionRoleJobData>,
        );
      case 'send-to-global-role':
        return this.handleSendToGlobalRole(job as Job<SendToGlobalRoleJobData>);
      case 'broadcast':
        return this.handleBroadcast(job as Job<BroadcastJobData>);
      default:
        this.logger.warn(`Unknown notification job type: ${job.name}`);
    }
  }

  // ---------------------------------------------------------------------------
  // send-to-user
  // ---------------------------------------------------------------------------

  private async handleSendToUser(job: Job<SendToUserJobData>) {
    const { userId, title, body, data, sentBy, source } = job.data;

    const allowed = await this.preferencesService.isAllowedForUser(
      userId,
      source,
    );
    if (!allowed) {
      this.logger.debug(
        `Notification to user ${userId} skipped — opted out of source "${source}" (job ${job.id})`,
      );
      return { skipped: true, reason: 'user_preference' };
    }

    const tokens = await this.prisma.user_fcm_tokens.findMany({
      where: { user_id: userId, active: true },
      select: { token: true },
    });

    if (tokens.length === 0) {
      this.logger.debug(
        `No active FCM tokens for user ${userId} — skipping job ${job.id}`,
      );
      return { skipped: true, reason: 'no-tokens' };
    }

    const tokenStrings = tokens.map((t) => t.token);
    const { successCount, failureCount } = await this.sendMulticast(
      tokenStrings,
      title,
      body,
      data,
    );

    await this.prisma.notification_logs.create({
      data: {
        title,
        body,
        type: 'USER',
        target_type: 'user',
        target_id: userId,
        sent_by: isUuid(sentBy) ? sentBy : null,
        source: source ?? null,
        tokens_sent: successCount,
        tokens_failed: failureCount,
      },
    });

    return { successCount, failureCount };
  }

  // ---------------------------------------------------------------------------
  // send-to-section-role
  // ---------------------------------------------------------------------------

  private async handleSendToSectionRole(job: Job<SendToSectionRoleJobData>) {
    const { clubSectionId, roleNames, title, body, data, source } = job.data;

    const assignments = await this.prisma.club_role_assignments.findMany({
      where: {
        club_section_id: clubSectionId,
        active: true,
        status: 'active',
        roles: { role_name: { in: roleNames } },
      },
      select: { user_id: true },
    });

    const rawUserIds = [...new Set(assignments.map((a) => a.user_id))];

    if (rawUserIds.length === 0) {
      this.logger.debug(
        `No users found for section-role notification (sectionId=${clubSectionId}, roles=${roleNames.join(',')}) — job ${job.id}`,
      );
      return { skipped: true, reason: 'no-users' };
    }

    const allowedSet = await this.preferencesService.filterAllowedUsers(
      rawUserIds,
      source,
    );
    const userIds = rawUserIds.filter((id) => allowedSet.has(id));

    if (userIds.length === 0) {
      return { skipped: true, reason: 'all-opted-out' };
    }

    const tokens = await this.prisma.user_fcm_tokens.findMany({
      where: { user_id: { in: userIds }, active: true },
      select: { token: true },
    });

    if (tokens.length === 0) {
      return { skipped: true, reason: 'no-tokens' };
    }

    const tokenStrings = tokens.map((t) => t.token);
    const batches = chunkArray(tokenStrings, 500);

    const batchResults = await Promise.allSettled(
      batches.map((batch) => this.sendMulticast(batch, title, body, data)),
    );

    let totalSuccess = 0;
    let totalFailure = 0;
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        totalSuccess += result.value.successCount;
        totalFailure += result.value.failureCount;
      } else {
        this.logger.warn(
          `handleSendToSectionRole batch failed: ${result.reason?.message ?? result.reason}`,
        );
      }
    }

    await this.prisma.notification_logs.create({
      data: {
        title,
        body,
        type: 'SECTION_ROLE',
        target_type: 'section_role',
        target_id: String(clubSectionId),
        sent_by: null,
        source: source ?? null,
        tokens_sent: totalSuccess,
        tokens_failed: totalFailure,
      },
    });

    return { successCount: totalSuccess, failureCount: totalFailure };
  }

  // ---------------------------------------------------------------------------
  // send-to-global-role
  // ---------------------------------------------------------------------------

  private async handleSendToGlobalRole(job: Job<SendToGlobalRoleJobData>) {
    const { roleNames, title, body, data, localFieldId, source, unionId } =
      job.data;

    const where: Record<string, unknown> = {
      active: true,
      roles: {
        role_name: { in: roleNames },
        role_category: 'GLOBAL',
        active: true,
      },
    };

    if (unionId) {
      where.users = { union_id: unionId };
    } else if (localFieldId) {
      where.users = { local_field_id: localFieldId };
    }

    const userRoles = await this.prisma.users_roles.findMany({
      where,
      select: { user_id: true },
    });

    const rawUserIds = [...new Set(userRoles.map((ur) => ur.user_id))];

    if (rawUserIds.length === 0) {
      this.logger.debug(
        `No users found for global-role notification (roles=${roleNames.join(',')}) — job ${job.id}`,
      );
      return { skipped: true, reason: 'no-users' };
    }

    const allowedSet = await this.preferencesService.filterAllowedUsers(
      rawUserIds,
      source,
    );
    const userIds = rawUserIds.filter((id) => allowedSet.has(id));

    if (userIds.length === 0) {
      return { skipped: true, reason: 'all-opted-out' };
    }

    const tokens = await this.prisma.user_fcm_tokens.findMany({
      where: { user_id: { in: userIds }, active: true },
      select: { token: true },
    });

    if (tokens.length === 0) {
      return { skipped: true, reason: 'no-tokens' };
    }

    const tokenStrings = tokens.map((t) => t.token);
    const batches = chunkArray(tokenStrings, 500);

    const batchResults = await Promise.allSettled(
      batches.map((batch) => this.sendMulticast(batch, title, body, data)),
    );

    let totalSuccess = 0;
    let totalFailure = 0;
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        totalSuccess += result.value.successCount;
        totalFailure += result.value.failureCount;
      } else {
        this.logger.warn(
          `handleSendToGlobalRole batch failed: ${result.reason?.message ?? result.reason}`,
        );
      }
    }

    await this.prisma.notification_logs.create({
      data: {
        title,
        body,
        type: 'GLOBAL_ROLE',
        target_type: 'global_role',
        target_id: localFieldId ? String(localFieldId) : null,
        sent_by: null,
        source: source ?? null,
        tokens_sent: totalSuccess,
        tokens_failed: totalFailure,
      },
    });

    return { successCount: totalSuccess, failureCount: totalFailure };
  }

  // ---------------------------------------------------------------------------
  // broadcast
  // ---------------------------------------------------------------------------

  private async handleBroadcast(job: Job<BroadcastJobData>) {
    const { title, body, data, sentBy, source } = job.data;

    const tokens = await this.prisma.user_fcm_tokens.findMany({
      where: { active: true },
      select: { token: true, user_id: true },
    });

    if (tokens.length === 0) {
      this.logger.debug(
        `No active FCM tokens found for broadcast — job ${job.id}`,
      );
      return { skipped: true, reason: 'no-tokens' };
    }

    const uniqueUserIds = [...new Set(tokens.map((t) => t.user_id))];
    const allowedSet = await this.preferencesService.filterAllowedUsers(
      uniqueUserIds,
      source,
    );
    const filteredTokens = tokens.filter((t) => allowedSet.has(t.user_id));

    if (filteredTokens.length === 0) {
      this.logger.debug(
        `All users opted out of broadcast source "${source}" — job ${job.id}`,
      );
      return { skipped: true, reason: 'all-opted-out' };
    }

    const tokenStrings = filteredTokens.map((t) => t.token);
    const batches = chunkArray(tokenStrings, 500);
    let totalSuccess = 0;
    let totalFailure = 0;

    for (const batch of batches) {
      const result = await this.sendMulticast(batch, title, body, data);
      totalSuccess += result.successCount;
      totalFailure += result.failureCount;
    }

    await this.prisma.notification_logs.create({
      data: {
        title,
        body,
        type: 'BROADCAST',
        target_type: 'all',
        target_id: null,
        sent_by: isUuid(sentBy) ? sentBy : null,
        source: source ?? null,
        tokens_sent: totalSuccess,
        tokens_failed: totalFailure,
      },
    });

    return { successCount: totalSuccess, failureCount: totalFailure };
  }

  // ---------------------------------------------------------------------------
  // Core FCM helper — shared by processor and NotificationsService fallback
  // ---------------------------------------------------------------------------

  /**
   * Sends a multicast FCM message to the given tokens.
   * Only marks tokens with permanent FCM error codes as inactive.
   * Transient errors (rate limits, server errors) are logged but do not deactivate the token.
   * Returns success/failure counts.
   */
  async sendMulticast(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<{ successCount: number; failureCount: number }> {
    const response = await firebaseAdmin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data,
    });

    if (response.failureCount > 0) {
      const permanentlyFailedTokens: string[] = [];

      response.responses.forEach((resp, idx) => {
        if (resp.success) return;
        const code = resp.error?.code;
        if (PERMANENT_FCM_ERROR_CODES.has(code ?? '')) {
          permanentlyFailedTokens.push(tokens[idx]);
        } else {
          this.logger.warn(
            `Transient FCM error for token ${tokens[idx]}: ${code ?? 'unknown'} — not deactivating`,
          );
        }
      });

      if (permanentlyFailedTokens.length > 0) {
        await this.prisma.user_fcm_tokens
          .updateMany({
            where: { token: { in: permanentlyFailedTokens } },
            data: { active: false },
          })
          .catch((err: Error) => {
            this.logger.warn(
              `Failed to deactivate invalid tokens: ${err.message}`,
            );
          });
      }
    }

    if (response.successCount > 0) {
      const succeededTokens = response.responses
        .map((resp, idx) => (resp.success ? tokens[idx] : null))
        .filter((token): token is string => token !== null);

      this.fcmTokensService
        .updateLastUsed(succeededTokens)
        .catch((err: Error) => {
          this.logger.warn(
            `Failed to update last_used for delivered tokens: ${err.message}`,
          );
        });
    }

    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
    };
  }
}

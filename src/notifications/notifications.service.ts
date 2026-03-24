import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { firebaseAdmin } from '../config/firebase-admin.module';
import { PrismaService } from '../prisma/prisma.service';
import { FcmTokensService } from './fcm-tokens.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import {
  NOTIFICATIONS_QUEUE,
  SendToUserJobData,
  SendToSectionRoleJobData,
  SendToGlobalRoleJobData,
  BroadcastJobData,
} from './notifications.processor';

export interface SendNotificationDto {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface BroadcastNotificationDto {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Default BullMQ job options for notification jobs.
 * - Up to 3 attempts with exponential backoff.
 * - After exhausting retries the job is moved to the failed set and logged —
 *   notifications are best-effort, so we never throw to the caller.
 */
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 2000, // 2 s → 4 s → 8 s
  },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
};

/** Returns true when the string looks like a valid UUID v4. */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

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

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  /**
   * `queue` is optional — it is only injected when REDIS_URL is configured
   * and NotificationsModule registers the BullMQ queue. When undefined, all
   * methods fall back to synchronous FCM calls (current behaviour).
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly fcmTokensService: FcmTokensService,
    private readonly preferencesService: NotificationPreferencesService,
    @Optional()
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly queue: Queue | undefined,
  ) {
    if (queue) {
      this.logger.log('NotificationsService: async queue mode (BullMQ)');
    } else {
      this.logger.log(
        'NotificationsService: synchronous mode (no Redis configured)',
      );
    }
  }

  private isFcmConfigured(): boolean {
    return firebaseAdmin.apps.length > 0;
  }

  private isQueueReady(): boolean {
    return !!this.queue;
  }

  // ---------------------------------------------------------------------------
  // sendToUser
  // ---------------------------------------------------------------------------

  /**
   * Enviar notificación a un usuario específico.
   * Enqueues via BullMQ when Redis is available; otherwise sends synchronously.
   */
  async sendToUser(
    dto: SendNotificationDto,
    sentBy: string,
    source?: string,
  ) {
    if (!this.isFcmConfigured()) {
      return {
        success: false,
        message: 'FCM service is not configured in this environment',
      };
    }

    if (this.isQueueReady()) {
      const jobData: SendToUserJobData = {
        userId: dto.userId,
        title: dto.title,
        body: dto.body,
        data: dto.data,
        sentBy,
        source,
      };
      await this.queue!.add('send-to-user', jobData, DEFAULT_JOB_OPTIONS);
      return { success: true, queued: true };
    }

    // Synchronous fallback
    return this.sendToUserSync(dto, sentBy, source);
  }

  // ---------------------------------------------------------------------------
  // broadcast
  // ---------------------------------------------------------------------------

  /**
   * Enviar notificación a todos los usuarios activos.
   */
  async broadcast(
    dto: BroadcastNotificationDto,
    sentBy: string,
    source?: string,
  ) {
    if (!this.isFcmConfigured()) {
      return {
        success: false,
        message: 'FCM service is not configured in this environment',
      };
    }

    if (this.isQueueReady()) {
      const jobData: BroadcastJobData = {
        title: dto.title,
        body: dto.body,
        data: dto.data,
        sentBy,
        source,
      };
      await this.queue!.add('broadcast', jobData, DEFAULT_JOB_OPTIONS);
      return { success: true, queued: true };
    }

    // Synchronous fallback
    return this.broadcastSync(dto, sentBy, source);
  }

  // ---------------------------------------------------------------------------
  // sendToClubMembers
  // ---------------------------------------------------------------------------

  /**
   * Enviar notificación a miembros de una sección de club.
   */
  async sendToClubMembers(
    clubSectionId: number,
    dto: Omit<BroadcastNotificationDto, 'userId'>,
    sentBy: string,
    source?: string,
  ) {
    if (!this.isFcmConfigured()) {
      return {
        success: false,
        message: 'FCM service is not configured in this environment',
      };
    }

    // sendToClubMembers is a legacy variant of sendToSectionRole without role
    // filtering. We keep it synchronous-only for backward compatibility since
    // it logs a distinct notification_logs entry with memberCount.
    return this.sendToClubMembersSync(clubSectionId, dto, sentBy, source);
  }

  // ---------------------------------------------------------------------------
  // sendToSectionRole
  // ---------------------------------------------------------------------------

  /**
   * Send notification to all users with a specific club role in a given section.
   * @param source - Identifier of the system event that triggered this (e.g. 'validation:class_submitted')
   */
  async sendToSectionRole(
    clubSectionId: number,
    roleNames: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
    source?: string,
  ): Promise<void> {
    try {
      if (this.isQueueReady()) {
        const jobData: SendToSectionRoleJobData = {
          clubSectionId,
          roleNames,
          title,
          body,
          data,
          source,
        };
        await this.queue!.add(
          'send-to-section-role',
          jobData,
          DEFAULT_JOB_OPTIONS,
        );
        return;
      }

      // Synchronous fallback
      await this.sendToSectionRoleSync(
        clubSectionId,
        roleNames,
        title,
        body,
        data,
        source,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to send section-role notification: ${error.message}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // sendToGlobalRole
  // ---------------------------------------------------------------------------

  /**
   * Send notification to all users with a specific global role.
   * @param source - Identifier of the system event that triggered this (e.g. 'investiture:club_approved')
   */
  async sendToGlobalRole(
    roleNames: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
    localFieldId?: number,
    source?: string,
  ): Promise<void> {
    try {
      if (this.isQueueReady()) {
        const jobData: SendToGlobalRoleJobData = {
          roleNames,
          title,
          body,
          data,
          localFieldId,
          source,
        };
        await this.queue!.add(
          'send-to-global-role',
          jobData,
          DEFAULT_JOB_OPTIONS,
        );
        return;
      }

      // Synchronous fallback
      await this.sendToGlobalRoleSync(
        roleNames,
        title,
        body,
        data,
        localFieldId,
        source,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to send global-role notification: ${error.message}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // notifySafe
  // ---------------------------------------------------------------------------

  /**
   * Fire-and-forget wrapper: enqueues (or sends) notification without blocking.
   * Logs errors but never throws.
   * @param source - Identifier of the system event that triggered this (e.g. 'requests:transfer_reviewed')
   */
  async notifySafe(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
    source?: string,
  ): Promise<void> {
    try {
      await this.sendToUser({ userId, title, body, data }, 'system', source);
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue notification to user ${userId}: ${error.message}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Notification history
  // ---------------------------------------------------------------------------

  /**
   * Obtener historial paginado de notificaciones enviadas.
   */
  async getNotificationHistory(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.notification_logs.findMany({
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          users: {
            select: {
              user_id: true,
              name: true,
              paternal_last_name: true,
              email: true,
            },
          },
        },
      }),
      this.prisma.notification_logs.count(),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ============================================================================
  // SYNCHRONOUS FALLBACK IMPLEMENTATIONS
  // Used when REDIS_URL is not configured (local dev without Redis).
  // ============================================================================

  private async sendToUserSync(
    dto: SendNotificationDto,
    sentBy: string,
    source?: string,
  ) {
    const allowed = await this.preferencesService.isAllowedForUser(dto.userId, source);
    if (!allowed) {
      this.logger.debug(
        `Notification to user ${dto.userId} skipped — opted out of source "${source}"`,
      );
      return { success: false, skipped: true, reason: 'user_preference' };
    }

    const tokens = await this.prisma.user_fcm_tokens.findMany({
      where: { user_id: dto.userId, active: true },
      select: { token: true },
    });

    if (tokens.length === 0) {
      return { success: false, message: 'No active FCM tokens found' };
    }

    const tokenStrings = tokens.map((t) => t.token);
    const { successCount, failureCount } = await this.sendMulticastDirect(
      tokenStrings,
      dto.title,
      dto.body,
      dto.data,
    );

    await this.prisma.notification_logs.create({
      data: {
        title: dto.title,
        body: dto.body,
        type: 'USER',
        target_type: 'user',
        target_id: dto.userId,
        sent_by: isUuid(sentBy) ? sentBy : null,
        source: source ?? null,
        tokens_sent: successCount,
        tokens_failed: failureCount,
      },
    });

    return { success: true, successCount, failureCount };
  }

  private async broadcastSync(
    dto: BroadcastNotificationDto,
    sentBy: string,
    source?: string,
  ) {
    const tokens = await this.prisma.user_fcm_tokens.findMany({
      where: { active: true },
      select: { token: true, user_id: true },
    });

    if (tokens.length === 0) {
      return { success: false, message: 'No active tokens' };
    }

    const uniqueUserIds = [...new Set(tokens.map((t) => t.user_id))];
    const allowedSet = await this.preferencesService.filterAllowedUsers(uniqueUserIds, source);
    const filteredTokens = tokens.filter((t) => allowedSet.has(t.user_id));

    if (filteredTokens.length === 0) {
      return { success: false, message: 'All users opted out' };
    }

    const tokenStrings = filteredTokens.map((t) => t.token);
    const batches = this.chunkArray(tokenStrings, 500);
    let totalSuccess = 0;
    let totalFailure = 0;

    for (const batch of batches) {
      const result = await this.sendMulticastDirect(
        batch,
        dto.title,
        dto.body,
        dto.data,
      );
      totalSuccess += result.successCount;
      totalFailure += result.failureCount;
    }

    await this.prisma.notification_logs.create({
      data: {
        title: dto.title,
        body: dto.body,
        type: 'BROADCAST',
        target_type: 'all',
        target_id: null,
        sent_by: isUuid(sentBy) ? sentBy : null,
        source: source ?? null,
        tokens_sent: totalSuccess,
        tokens_failed: totalFailure,
      },
    });

    return { success: true, successCount: totalSuccess, failureCount: totalFailure };
  }

  private async sendToClubMembersSync(
    clubSectionId: number,
    dto: Omit<BroadcastNotificationDto, 'userId'>,
    sentBy: string,
    source?: string,
  ) {
    const members = await this.prisma.club_role_assignments.findMany({
      where: { club_section_id: clubSectionId, active: true },
      select: { user_id: true },
    });

    const rawUserIds = [...new Set(members.map((m) => m.user_id))];
    if (rawUserIds.length === 0) {
      return { success: false, message: 'No members found' };
    }

    const allowedUserIds = [
      ...(await this.preferencesService.filterAllowedUsers(rawUserIds, source)),
    ];
    const userIds = allowedUserIds;

    if (userIds.length === 0) {
      return { success: false, message: 'No members found' };
    }

    const tokens = await this.prisma.user_fcm_tokens.findMany({
      where: { user_id: { in: userIds }, active: true },
      select: { token: true },
    });

    if (tokens.length === 0) {
      return { success: false, message: 'No active tokens for club members' };
    }

    const tokenStrings = tokens.map((t) => t.token);
    const batches = this.chunkArray(tokenStrings, 500);
    let totalSuccess = 0;
    let totalFailure = 0;

    for (const batch of batches) {
      const result = await this.sendMulticastDirect(
        batch,
        dto.title,
        dto.body,
        dto.data,
      );
      totalSuccess += result.successCount;
      totalFailure += result.failureCount;
    }

    await this.prisma.notification_logs.create({
      data: {
        title: dto.title,
        body: dto.body,
        type: 'CLUB',
        target_type: 'club_section',
        target_id: String(clubSectionId),
        sent_by: isUuid(sentBy) ? sentBy : null,
        source: source ?? null,
        tokens_sent: totalSuccess,
        tokens_failed: totalFailure,
      },
    });

    return {
      success: true,
      successCount: totalSuccess,
      failureCount: totalFailure,
      memberCount: rawUserIds.length,
    };
  }

  private async sendToSectionRoleSync(
    clubSectionId: number,
    roleNames: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
    source?: string,
  ): Promise<void> {
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
      return;
    }

    const allowedSet = await this.preferencesService.filterAllowedUsers(rawUserIds, source);
    const userIds = rawUserIds.filter((id) => allowedSet.has(id));

    if (userIds.length === 0) {
      return;
    }

    const tokens = await this.prisma.user_fcm_tokens.findMany({
      where: { user_id: { in: userIds }, active: true },
      select: { token: true },
    });

    if (tokens.length === 0) {
      return;
    }

    const tokenStrings = tokens.map((t) => t.token);
    const batches = this.chunkArray(tokenStrings, 500);

    const batchResults = await Promise.allSettled(
      batches.map((batch) => this.sendMulticastDirect(batch, title, body, data)),
    );

    let totalSuccess = 0;
    let totalFailure = 0;
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        totalSuccess += result.value.successCount;
        totalFailure += result.value.failureCount;
      } else {
        this.logger.warn(
          `sendToSectionRoleSync batch failed: ${result.reason?.message ?? result.reason}`,
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
  }

  private async sendToGlobalRoleSync(
    roleNames: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
    localFieldId?: number,
    source?: string,
  ): Promise<void> {
    const where: Record<string, unknown> = {
      active: true,
      roles: {
        role_name: { in: roleNames },
        role_category: 'GLOBAL',
        active: true,
      },
    };

    if (localFieldId) {
      where.users = { local_field_id: localFieldId };
    }

    const userRoles = await this.prisma.users_roles.findMany({
      where,
      select: { user_id: true },
    });

    const rawUserIds = [...new Set(userRoles.map((ur) => ur.user_id))];

    if (rawUserIds.length === 0) {
      return;
    }

    const allowedSet = await this.preferencesService.filterAllowedUsers(rawUserIds, source);
    const userIds = rawUserIds.filter((id) => allowedSet.has(id));

    if (userIds.length === 0) {
      return;
    }

    const tokens = await this.prisma.user_fcm_tokens.findMany({
      where: { user_id: { in: userIds }, active: true },
      select: { token: true },
    });

    if (tokens.length === 0) {
      return;
    }

    const tokenStrings = tokens.map((t) => t.token);
    const batches = this.chunkArray(tokenStrings, 500);

    const batchResults = await Promise.allSettled(
      batches.map((batch) => this.sendMulticastDirect(batch, title, body, data)),
    );

    let totalSuccess = 0;
    let totalFailure = 0;
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        totalSuccess += result.value.successCount;
        totalFailure += result.value.failureCount;
      } else {
        this.logger.warn(
          `sendToGlobalRoleSync batch failed: ${result.reason?.message ?? result.reason}`,
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
  }

  // ---------------------------------------------------------------------------
  // Core FCM helper (synchronous path)
  // ---------------------------------------------------------------------------

  /**
   * Direct FCM multicast — used by the synchronous fallback methods.
   * Only marks tokens with permanent FCM error codes as inactive.
   * Transient errors (rate limits, server errors, etc.) are logged but do not deactivate the token.
   * The processor exposes its own equivalent `sendMulticast` method for the
   * async path.
   */
  private async sendMulticastDirect(
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
        await this.prisma.user_fcm_tokens.updateMany({
          where: { token: { in: permanentlyFailedTokens } },
          data: { active: false },
        });
      }
    }

    if (response.successCount > 0) {
      const succeededTokens = response.responses
        .map((resp, idx) => (resp.success ? tokens[idx] : null))
        .filter((token): token is string => token !== null);

      this.fcmTokensService.updateLastUsed(succeededTokens).catch((err: Error) => {
        this.logger.warn(`Failed to update last_used for delivered tokens: ${err.message}`);
      });
    }

    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
    };
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

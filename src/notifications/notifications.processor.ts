// =============================================================================
// NOTIFICATION DELIVERY CONTRACT
// =============================================================================
// See notifications.service.ts for the authoritative contract comment.
// TL;DR: log + deliveries are created BEFORE FCM push for every targeted user.
// FCM push is best-effort. No-token users still get an inbox entry.
// Opt-out (notification_preferences) suppresses BOTH push and inbox.
// =============================================================================

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Job } from 'bullmq';
import { firebaseAdmin } from '../config/firebase-admin.module';
import { PrismaService } from '../prisma/prisma.service';
import { FcmTokensService } from './fcm-tokens.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { isUuid, chunkArray } from '../common/utils/notification.utils';

export const NOTIFICATIONS_QUEUE = 'notifications';

// ---------------------------------------------------------------------------
// Realtime invalidation — silent push to trigger client cache refresh
// ---------------------------------------------------------------------------

export const REALTIME_INVALIDATE_JOB = 'realtime.invalidate';

export interface RealtimeInvalidatePayload {
  sectionId: number;
  resource: 'activities'; // extensible later
  action: 'CREATED' | 'UPDATED' | 'DELETED';
  entityId: number;
  actorId: string;
  timestamp: string; // ISO
}

export type NotificationJobType =
  | 'send-to-user'
  | 'send-to-section-role'
  | 'send-to-global-role'
  | 'send-to-club-members'
  | 'broadcast'
  | 'realtime.invalidate';

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

export interface SendToClubMembersJobData {
  clubSectionId: number;
  title: string;
  body: string;
  data?: Record<string, string>;
  sentBy: string;
  source?: string;
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
  | SendToClubMembersJobData
  | BroadcastJobData
  | RealtimeInvalidatePayload;

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
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, {
          tags: {
            bullmq: true,
            queue: job?.queueName ?? 'unknown',
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
      case 'send-to-club-members':
        return this.handleSendToClubMembers(
          job as Job<SendToClubMembersJobData>,
        );
      case 'broadcast':
        return this.handleBroadcast(job as Job<BroadcastJobData>);
      case REALTIME_INVALIDATE_JOB:
        return this.handleRealtimeInvalidate(
          job as Job<RealtimeInvalidatePayload>,
        );
      default:
        this.logger.warn(`Unknown notification job type: ${job.name}`);
    }
  }

  // ---------------------------------------------------------------------------
  // send-to-user
  // ---------------------------------------------------------------------------

  private async handleSendToUser(job: Job<SendToUserJobData>) {
    const { userId, title, body, data, sentBy, source } = job.data;

    // Step 1: Check opt-out. Opt-out suppresses BOTH push and inbox delivery.
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

    // Step 2: Create log + delivery BEFORE FCM push. The inbox entry must
    // exist regardless of whether the user has active FCM tokens.
    await this.prisma.$transaction(async (tx) => {
      const log = await tx.notification_logs.create({
        data: {
          title,
          body,
          type: 'USER',
          target_type: 'user',
          target_id: userId,
          sent_by: isUuid(sentBy) ? sentBy : null,
          source: source ?? null,
          tokens_sent: 0,
          tokens_failed: 0,
        },
      });
      await tx.notification_deliveries.create({
        data: { log_id: log.log_id, user_id: userId },
      });
    }).catch((err: Error) => {
      this.logger.warn(
        `handleSendToUser: failed to persist log/delivery for user ${userId}: ${err.message}`,
      );
    });

    // Step 3: FCM push — best effort, only if tokens exist.
    const tokens = await this.prisma.user_fcm_tokens.findMany({
      where: { user_id: userId, active: true },
      select: { token: true },
    });

    if (tokens.length === 0) {
      this.logger.debug(
        `handleSendToUser: no active FCM tokens for user ${userId} — delivery created, push skipped (job ${job.id})`,
      );
      return { successCount: 0, failureCount: 0, skippedPush: true };
    }

    const tokenStrings = tokens.map((t) => t.token);
    const { successCount, failureCount } = await this.sendMulticast(
      tokenStrings,
      title,
      body,
      data,
    );

    return { successCount, failureCount, skippedPush: false };
  }

  // ---------------------------------------------------------------------------
  // send-to-section-role
  // ---------------------------------------------------------------------------

  private async handleSendToSectionRole(job: Job<SendToSectionRoleJobData>) {
    const { clubSectionId, roleNames, title, body, data, source } = job.data;

    // Step 1: Resolve target users by role — genuine empty set is a hard stop.
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

    // Opt-out suppresses both push and inbox delivery.
    const allowedSet = await this.preferencesService.filterAllowedUsers(
      rawUserIds,
      source,
    );
    const userIds = rawUserIds.filter((id) => allowedSet.has(id));

    if (userIds.length === 0) {
      return { skipped: true, reason: 'all-opted-out' };
    }

    // Step 2: Create log + deliveries for all allowed users atomically.
    await this.prisma.$transaction(async (tx) => {
      const log = await tx.notification_logs.create({
        data: {
          title,
          body,
          type: 'SECTION_ROLE',
          target_type: 'section_role',
          target_id: String(clubSectionId),
          sent_by: null,
          source: source ?? null,
          tokens_sent: 0,
          tokens_failed: 0,
        },
      });
      await tx.notification_deliveries.createMany({
        data: userIds.map((uid) => ({ log_id: log.log_id, user_id: uid })),
        skipDuplicates: true,
      });
    }).catch((err: Error) => {
      this.logger.warn(
        `handleSendToSectionRole: failed to persist log/deliveries for section ${clubSectionId}: ${err.message}`,
      );
    });

    // Step 3: FCM push — best effort, only to users with active tokens.
    const tokens = await this.prisma.user_fcm_tokens.findMany({
      where: { user_id: { in: userIds }, active: true },
      select: { token: true },
    });

    if (tokens.length === 0) {
      this.logger.debug(
        `handleSendToSectionRole: no active FCM tokens for section ${clubSectionId} — deliveries created, push skipped (job ${job.id})`,
      );
      return { successCount: 0, failureCount: 0, skippedPush: true };
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

    return { successCount: totalSuccess, failureCount: totalFailure, skippedPush: false };
  }

  // ---------------------------------------------------------------------------
  // send-to-global-role
  // ---------------------------------------------------------------------------

  private async handleSendToGlobalRole(job: Job<SendToGlobalRoleJobData>) {
    const { roleNames, title, body, data, localFieldId, source, unionId } =
      job.data;

    // Step 1: Resolve target users by global role — genuine empty set is a hard stop.
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

    // Opt-out suppresses both push and inbox delivery.
    const allowedSet = await this.preferencesService.filterAllowedUsers(
      rawUserIds,
      source,
    );
    const userIds = rawUserIds.filter((id) => allowedSet.has(id));

    if (userIds.length === 0) {
      return { skipped: true, reason: 'all-opted-out' };
    }

    // Step 2: Create log + deliveries for all allowed users atomically.
    await this.prisma.$transaction(async (tx) => {
      const log = await tx.notification_logs.create({
        data: {
          title,
          body,
          type: 'GLOBAL_ROLE',
          target_type: 'global_role',
          target_id: localFieldId ? String(localFieldId) : null,
          sent_by: null,
          source: source ?? null,
          tokens_sent: 0,
          tokens_failed: 0,
        },
      });
      await tx.notification_deliveries.createMany({
        data: userIds.map((uid) => ({ log_id: log.log_id, user_id: uid })),
        skipDuplicates: true,
      });
    }).catch((err: Error) => {
      this.logger.warn(
        `handleSendToGlobalRole: failed to persist log/deliveries for roles ${roleNames.join(',')}: ${err.message}`,
      );
    });

    // Step 3: FCM push — best effort, only to users with active tokens.
    const tokens = await this.prisma.user_fcm_tokens.findMany({
      where: { user_id: { in: userIds }, active: true },
      select: { token: true },
    });

    if (tokens.length === 0) {
      this.logger.debug(
        `handleSendToGlobalRole: no active FCM tokens for roles ${roleNames.join(',')} — deliveries created, push skipped (job ${job.id})`,
      );
      return { successCount: 0, failureCount: 0, skippedPush: true };
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

    return { successCount: totalSuccess, failureCount: totalFailure, skippedPush: false };
  }

  // ---------------------------------------------------------------------------
  // send-to-club-members
  // ---------------------------------------------------------------------------

  /**
   * Handles async fan-out to all active members of a club section.
   * Mirrors the logic of sendToClubMembersSync but runs in the BullMQ worker.
   * Opt-out preferences suppress BOTH push AND inbox delivery.
   */
  private async handleSendToClubMembers(job: Job<SendToClubMembersJobData>) {
    const { clubSectionId, title, body, data, sentBy, source } = job.data;

    // Step 1: Resolve members — genuine empty set is a hard stop.
    const members = await this.prisma.club_role_assignments.findMany({
      where: { club_section_id: clubSectionId, active: true },
      select: { user_id: true },
    });

    const rawUserIds = [...new Set(members.map((m) => m.user_id))];
    if (rawUserIds.length === 0) {
      this.logger.debug(
        `handleSendToClubMembers: no members for section ${clubSectionId} — job ${job.id}`,
      );
      return { skipped: true, reason: 'no-members' };
    }

    // Step 2: Apply opt-out preference filter.
    const allowedSet = await this.preferencesService.filterAllowedUsers(
      rawUserIds,
      source,
    );
    const userIds = [...allowedSet];

    if (userIds.length === 0) {
      this.logger.debug(
        `handleSendToClubMembers: all members opted out for section ${clubSectionId} — job ${job.id}`,
      );
      return { skipped: true, reason: 'all-opted-out' };
    }

    // Step 3: Create log + deliveries for all allowed members atomically.
    // This happens regardless of FCM token availability (inbox-first guarantee).
    await this.prisma
      .$transaction(async (tx) => {
        const log = await tx.notification_logs.create({
          data: {
            title,
            body,
            type: 'CLUB',
            target_type: 'club_section',
            target_id: String(clubSectionId),
            sent_by: isUuid(sentBy) ? sentBy : null,
            source: source ?? null,
            tokens_sent: 0,
            tokens_failed: 0,
          },
        });
        await tx.notification_deliveries.createMany({
          data: userIds.map((uid) => ({ log_id: log.log_id, user_id: uid })),
          skipDuplicates: true,
        });
      })
      .catch((err: Error) => {
        this.logger.warn(
          `handleSendToClubMembers: failed to persist log/deliveries for section ${clubSectionId}: ${err.message}`,
        );
      });

    // Step 4: FCM push — best effort, only to members with active tokens.
    const tokenRows = await this.prisma.user_fcm_tokens.findMany({
      where: { user_id: { in: userIds }, active: true },
      select: { token: true },
    });

    if (tokenRows.length === 0) {
      this.logger.debug(
        `handleSendToClubMembers: no active FCM tokens for section ${clubSectionId} — deliveries created, push skipped (job ${job.id})`,
      );
      return {
        successCount: 0,
        failureCount: 0,
        memberCount: rawUserIds.length,
        skippedPush: true,
      };
    }

    const tokenStrings = tokenRows.map((t) => t.token);
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
          `handleSendToClubMembers batch failed: ${result.reason?.message ?? result.reason}`,
        );
      }
    }

    return {
      successCount: totalSuccess,
      failureCount: totalFailure,
      memberCount: rawUserIds.length,
      skippedPush: false,
    };
  }

  // ---------------------------------------------------------------------------
  // broadcast
  // ---------------------------------------------------------------------------

  private async handleBroadcast(job: Job<BroadcastJobData>) {
    const { title, body, data, sentBy, source } = job.data;

    // Step 1: Resolve all active users — the inbox recipients.
    // Query users directly, NOT tokens, so users without tokens still get a
    // delivery row. Opt-out suppresses both push and inbox.
    const activeUsers = await this.prisma.users.findMany({
      where: { active: true },
      select: { user_id: true },
    });

    if (activeUsers.length === 0) {
      this.logger.debug(
        `No active users found for broadcast — job ${job.id}`,
      );
      return { skipped: true, reason: 'no-users' };
    }

    const allUserIds = activeUsers.map((u) => u.user_id);
    const allowedSet = await this.preferencesService.filterAllowedUsers(
      allUserIds,
      source,
    );
    const allowedUserIds = [...allowedSet];

    if (allowedUserIds.length === 0) {
      this.logger.debug(
        `All users opted out of broadcast source "${source}" — job ${job.id}`,
      );
      return { skipped: true, reason: 'all-opted-out' };
    }

    // Step 2: Create log + deliveries for all allowed users atomically.
    await this.prisma.$transaction(async (tx) => {
      const log = await tx.notification_logs.create({
        data: {
          title,
          body,
          type: 'BROADCAST',
          target_type: 'all',
          target_id: null,
          sent_by: isUuid(sentBy) ? sentBy : null,
          source: source ?? null,
          tokens_sent: 0,
          tokens_failed: 0,
        },
      });
      await tx.notification_deliveries.createMany({
        data: allowedUserIds.map((uid) => ({
          log_id: log.log_id,
          user_id: uid,
        })),
        skipDuplicates: true,
      });
    }).catch((err: Error) => {
      this.logger.warn(
        `handleBroadcast: failed to persist log/deliveries: ${err.message}`,
      );
    });

    // Step 3: FCM push — best effort, only to users with active tokens.
    const tokenRows = await this.prisma.user_fcm_tokens.findMany({
      where: { user_id: { in: allowedUserIds }, active: true },
      select: { token: true },
    });

    if (tokenRows.length === 0) {
      this.logger.debug(
        `handleBroadcast: no active FCM tokens for any allowed user — deliveries created, push skipped (job ${job.id})`,
      );
      return {
        successCount: 0,
        failureCount: 0,
        deliveriesCreated: allowedUserIds.length,
        skippedPush: true,
      };
    }

    const tokenStrings = tokenRows.map((t) => t.token);
    const batches = chunkArray(tokenStrings, 500);
    let totalSuccess = 0;
    let totalFailure = 0;

    for (const batch of batches) {
      const result = await this.sendMulticast(batch, title, body, data);
      totalSuccess += result.successCount;
      totalFailure += result.failureCount;
    }

    return {
      successCount: totalSuccess,
      failureCount: totalFailure,
      deliveriesCreated: allowedUserIds.length,
      skippedPush: false,
    };
  }

  // ---------------------------------------------------------------------------
  // realtime.invalidate
  // ---------------------------------------------------------------------------

  /**
   * Handles a realtime cache-invalidation job.
   *
   * Resolves FCM tokens for all active members of the target section
   * (excluding the actor), then sends a silent data-only push so clients
   * can invalidate their local cache without showing a visible notification.
   *
   * Design choices:
   * - No notification_logs / notification_deliveries rows are created — this
   *   is a transport-layer signal, not a user-visible notification.
   * - Empty recipient list → early return (FCM rejects empty token arrays).
   * - Permanently invalid tokens are revoked in DB.
   */
  private async handleRealtimeInvalidate(
    job: Job<RealtimeInvalidatePayload>,
  ): Promise<{ recipientCount: number; successCount: number; failureCount: number; skipped?: boolean }> {
    const { sectionId, actorId, resource, action, entityId } = job.data;

    // Resolve FCM tokens for section members, excluding the actor.
    // Uses club_role_assignments as the membership source (active: true).
    const tokenRows = await this.prisma.user_fcm_tokens.findMany({
      where: {
        active: true,
        users: {
          club_role_assignments: {
            some: {
              club_section_id: sectionId,
              active: true,
            },
          },
          user_id: { not: actorId },
        },
      },
      select: { token: true },
    });

    if (tokenRows.length === 0) {
      this.logger.log(
        `handleRealtimeInvalidate: no recipients for section ${sectionId} (action=${action}, entity=${entityId}) — job ${job.id}`,
      );
      return { recipientCount: 0, successCount: 0, failureCount: 0, skipped: true };
    }

    const tokens = tokenRows.map((r) => r.token);
    const { successCount, failureCount } = await this.sendSilentMulticast(
      tokens,
      job.data,
    );

    this.logger.log(
      JSON.stringify({
        job_id: job.id,
        section_id: sectionId,
        resource,
        action,
        entity_id: entityId,
        recipient_count: tokens.length,
        success_count: successCount,
        failure_count: failureCount,
      }),
    );

    return { recipientCount: tokens.length, successCount, failureCount };
  }

  /**
   * Sends a data-only (silent) FCM multicast message.
   * Does NOT include a `notification` key — prevents OS-level visible alerts.
   * All payload values are coerced to strings as required by FCM data messages.
   * APNS content-available:1 + Android high priority ensure background wake-up.
   */
  private async sendSilentMulticast(
    tokens: string[],
    payload: RealtimeInvalidatePayload,
  ): Promise<{ successCount: number; failureCount: number }> {
    const data: Record<string, string> = {
      type: 'cache_invalidate',
      sectionId: String(payload.sectionId),
      resource: payload.resource,
      action: payload.action,
      entityId: String(payload.entityId),
      actorId: payload.actorId,
      timestamp: payload.timestamp,
    };

    const response = await firebaseAdmin.messaging().sendEachForMulticast({
      tokens,
      data,
      apns: {
        headers: { 'apns-priority': '5' },
        payload: { aps: { 'content-available': 1 } },
      },
      android: { priority: 'high' },
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
            `sendSilentMulticast: transient FCM error for token ${tokens[idx]}: ${code ?? 'unknown'} — not deactivating`,
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
              `sendSilentMulticast: failed to revoke invalid tokens: ${err.message}`,
            );
          });
      }
    }

    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
    };
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

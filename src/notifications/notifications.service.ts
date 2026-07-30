// =============================================================================
// NOTIFICATION DELIVERY CONTRACT
// =============================================================================
// The `notification_deliveries` table is the SOURCE OF TRUTH for the user
// inbox. Every send operation MUST create a log + delivery row for every
// targeted user, REGARDLESS of whether those users have active FCM tokens.
//
// FCM push is a best-effort delivery mechanism layered ON TOP:
//   - If a user has active tokens → send push.
//   - If a user has no tokens   → skip push, inbox delivery still created.
//
// User opt-out preferences (`notification_preferences`) suppress BOTH push
// AND inbox delivery. A user who opted out of a source will not receive a
// push notification AND will not see the notification in their inbox.
// Rationale: opt-out signals the user does not want to be notified about
// that source at all — the inbox is not an override of that intent.
// =============================================================================

import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  AppBadRequestException,
  AppNotFoundException,
  AppForbiddenException,
  AppInternalServerErrorException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { firebaseAdmin } from '../config/firebase-admin.module';
import { PrismaService } from '../prisma/prisma.service';
import { FcmTokensService } from './fcm-tokens.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import {
  NOTIFICATIONS_QUEUE,
  REALTIME_INVALIDATE_JOB,
  RealtimeInvalidatePayload,
  SendToUserJobData,
  SendToClubMembersJobData,
  SendToSectionRoleJobData,
  SendToGlobalRoleJobData,
  BroadcastChunkJobData,
  BROADCAST_CHUNK_JOB,
} from './notifications.processor';
import { isUuid, chunkArray } from '../common/utils/notification.utils';

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

export type NotificationClubInstanceType =
  'adventurers' | 'pathfinders' | 'master_guilds';

export interface NotificationClubTarget {
  clubId: number;
  clubName: string;
  sectionId: number;
  sectionName: string;
  instanceType: NotificationClubInstanceType;
  instanceId: number;
  label: string;
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

const BROADCAST_USERS_PAGE_SIZE = 500;
const BROADCAST_CHUNK_SIZE = 500;

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
    private readonly authorizationContext: AuthorizationContextService,
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
    return firebaseAdmin.getApps().length > 0;
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
  async sendToUser(dto: SendNotificationDto, sentBy: string, source?: string) {
    if (this.isQueueReady() && this.isFcmConfigured()) {
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
    if (!this.isQueueReady()) {
      if (this.isProductionEnvironment()) {
        throw new AppInternalServerErrorException(
          ErrorCode.NOTIF_BROADCAST_QUEUE_UNAVAILABLE,
          {
            environment: process.env.NODE_ENV,
          },
        );
      }

      return this.broadcastSync(dto, sentBy, source);
    }

    return this.broadcastAsync(dto, sentBy, source);
  }

  private isProductionEnvironment(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  private async broadcastAsync(
    dto: BroadcastNotificationDto,
    sentBy: string,
    source?: string,
  ) {
    let logId: number | undefined;
    let hasActiveUsers = false;
    let hasAllowedUsers = false;
    let queuedUsers = 0;
    let skip = 0;

    while (true) {
      const users = await this.prisma.users.findMany({
        where: { active: true },
        select: { user_id: true },
        orderBy: { user_id: 'asc' },
        skip,
        take: BROADCAST_USERS_PAGE_SIZE,
      });

      if (users.length === 0) {
        break;
      }

      hasActiveUsers = true;
      skip += users.length;

      const userIds = users.map((u) => u.user_id);
      const allowedSet = await this.preferencesService.filterAllowedUsers(
        userIds,
        source,
      );
      const allowedUserIds = [...allowedSet];

      if (allowedUserIds.length === 0) {
        continue;
      }

      hasAllowedUsers = true;

      if (typeof logId !== 'number') {
        const log = await this.prisma.notification_logs.create({
          data: {
            title: dto.title,
            body: dto.body,
            type: 'BROADCAST',
            target_type: 'all',
            target_id: null,
            sent_by: isUuid(sentBy) ? sentBy : null,
            source: source ?? null,
            tokens_sent: 0,
            tokens_failed: 0,
          },
        });
        logId = log.log_id;
      }

      for (const userIdChunk of chunkArray(
        allowedUserIds,
        BROADCAST_CHUNK_SIZE,
      )) {
        const jobData: BroadcastChunkJobData = {
          logId,
          userIds: userIdChunk,
          title: dto.title,
          body: dto.body,
          data: dto.data,
          sentBy,
          source,
        };

        await this.queue!.add(
          BROADCAST_CHUNK_JOB,
          jobData,
          DEFAULT_JOB_OPTIONS,
        );
        queuedUsers += userIdChunk.length;
      }
    }

    if (!hasActiveUsers) {
      return { success: false, message: 'No active users' };
    }

    if (!hasAllowedUsers || typeof logId !== 'number') {
      return { success: false, message: 'All users opted out' };
    }

    return {
      success: true,
      queued: true,
      logId,
      deliveriesCreated: queuedUsers,
    };
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
    expectedInstanceType?: NotificationClubInstanceType,
  ) {
    if (isUuid(sentBy)) {
      await this.assertExactClubAssignmentScope(sentBy, clubSectionId);
    }

    if (expectedInstanceType) {
      await this.assertClubSectionMatchesInstanceType(
        clubSectionId,
        expectedInstanceType,
      );
    }

    if (this.isQueueReady() && this.isFcmConfigured()) {
      const jobData: SendToClubMembersJobData = {
        clubSectionId,
        title: dto.title,
        body: dto.body,
        data: dto.data,
        sentBy,
        source,
      };
      await this.queue!.add(
        'send-to-club-members',
        jobData,
        DEFAULT_JOB_OPTIONS,
      );
      return { success: true, queued: true };
    }

    // Synchronous fallback
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
      if (this.isQueueReady() && this.isFcmConfigured()) {
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
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to send section-role notification: ${error instanceof Error ? error.message : String(error)}`,
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
    unionId?: number,
  ): Promise<void> {
    try {
      if (this.isQueueReady() && this.isFcmConfigured()) {
        const jobData: SendToGlobalRoleJobData = {
          roleNames,
          title,
          body,
          data,
          localFieldId,
          source,
          unionId,
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
        unionId,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to send global-role notification: ${error instanceof Error ? error.message : String(error)}`,
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
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to enqueue notification to user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // sendSilentToSection — realtime cache invalidation
  // ---------------------------------------------------------------------------

  /**
   * Enqueues a silent (data-only) FCM push to all active members of the
   * given section (excluding the actor). Used to trigger client-side cache
   * invalidation after an activity mutation.
   *
   * This method is fire-and-forget by design:
   * - It never throws — errors are caught and logged.
   * - It does NOT create notification_logs or notification_deliveries rows.
   * - When Redis is unavailable the job is silently dropped (invalidation is
   *   best-effort; the client will sync on next foreground fetch).
   */
  async sendSilentToSection(input: RealtimeInvalidatePayload): Promise<void> {
    if (!this.isQueueReady()) {
      this.logger.debug(
        `sendSilentToSection: queue not available — skipping realtime invalidation for section ${input.sectionId}`,
      );
      return;
    }

    await this.queue!.add(REALTIME_INVALIDATE_JOB, input, {
      attempts: 2,
      backoff: { type: 'exponential' as const, delay: 1000 },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 25 },
    }).catch((err: Error) => {
      this.logger.error(
        `sendSilentToSection: failed to enqueue realtime.invalidate for section ${input.sectionId}: ${err.message}`,
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Notification history
  // ---------------------------------------------------------------------------

  /**
   * Obtener historial paginado de notificaciones.
   *
   * - Admins (admin | super-admin | assistant-admin): devuelve audit log
   *   territorialmente filtrado según el scope del caller. Only super-admin
   *   receives the unfiltered audit trail.
   *
   * - Usuarios regulares: consulta notification_deliveries (mailbox-per-user).
   *   Esto resuelve el bug donde sendToSectionRole / broadcast / sendToClubMembers
   *   jamás generaban un log con target_type='user', por lo que la bandeja de
   *   entrada siempre aparecía vacía para usuarios no-admin.
   */
  async getNotificationHistory(
    callerUserId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    // Defense-in-depth: cap limit regardless of caller (controller already clamps,
    // but this protects any future internal caller too).
    const safeLimit = Math.min(limit, 100);

    const isAdmin = await this.authorizationContext.hasAnyGlobalRole(
      callerUserId,
      ['admin', 'super-admin', 'assistant-admin'],
    );

    const skip = (page - 1) * safeLimit;

    if (isAdmin) {
      const resolved =
        await this.authorizationContext.resolveUserAuthorization(callerUserId);
      const where = this.buildAdminHistoryWhere(callerUserId, resolved);

      // Admin path: read directly from notification_logs (full audit log)
      const [data, total] = await Promise.all([
        this.prisma.notification_logs.findMany({
          where,
          skip,
          take: safeLimit,
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
        this.prisma.notification_logs.count({ where }),
      ]);

      return {
        data,
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      };
    }

    // Regular user path: read from notification_deliveries (per-recipient mailbox)
    const [deliveries, total] = await Promise.all([
      this.prisma.notification_deliveries.findMany({
        where: { user_id: callerUserId },
        include: { notification_log: true },
        orderBy: { created_at: 'desc' },
        skip,
        take: safeLimit,
      }),
      this.prisma.notification_deliveries.count({
        where: { user_id: callerUserId },
      }),
    ]);

    const data = deliveries.map((d) => ({
      delivery_id: d.delivery_id,
      read_at: d.read_at,
      created_at: d.created_at,
      log_id: d.notification_log.log_id,
      title: d.notification_log.title,
      body: d.notification_log.body,
      type: d.notification_log.type,
      target_type: d.notification_log.target_type,
      source: d.notification_log.source,
    }));

    return {
      data,
      total,
      page,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  async getAuthorizedClubTargets(
    callerUserId: string,
  ): Promise<{ data: NotificationClubTarget[] }> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(callerUserId);

    const activeAssignmentId =
      resolved.authorization.active_assignment.assignment_id;
    if (!activeAssignmentId) {
      return { data: [] };
    }

    const activeGrant = resolved.authorization.grants.club_assignments.find(
      (assignment) => assignment.assignment_id === activeAssignmentId,
    );
    const activeSectionId =
      activeGrant?.section.club_section_id ??
      resolved.authorization.effective.scope.club?.section.club_section_id;

    if (!activeSectionId) {
      return { data: [] };
    }

    const sections = await this.prisma.club_sections.findMany({
      where: {
        club_section_id: { in: [activeSectionId] },
        active: true,
      },
      select: {
        club_section_id: true,
        club_type_id: true,
        name: true,
        clubs: {
          select: {
            club_id: true,
            name: true,
          },
        },
        club_types: {
          select: {
            name: true,
          },
        },
      },
    });

    const data = sections
      .filter((section) => Boolean(section.clubs?.club_id))
      .flatMap((section) => {
        const instanceType = this.mapClubSectionToInstanceType(section);
        if (!instanceType) {
          return [];
        }

        const clubName =
          section.clubs?.name ??
          activeGrant?.club.club_name ??
          resolved.authorization.effective.scope.club?.club.club_name ??
          `Club ${section.clubs?.club_id ?? section.club_section_id}`;

        const sectionName =
          section.name ??
          section.club_types?.name ??
          activeGrant?.section.club_type_name ??
          `Sección ${section.club_section_id}`;

        return {
          clubId:
            section.clubs?.club_id ??
            activeGrant?.club.club_id ??
            resolved.authorization.effective.scope.club?.club.club_id ??
            0,
          clubName,
          sectionId: section.club_section_id,
          sectionName,
          instanceType,
          instanceId: section.club_section_id,
          label: `${clubName} — ${sectionName}`,
        } satisfies NotificationClubTarget;
      })
      .filter((target) => target.clubId > 0)
      .sort((a, b) =>
        a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }),
      );

    return { data };
  }

  private async assertClubSectionMatchesInstanceType(
    clubSectionId: number,
    expectedInstanceType: NotificationClubInstanceType,
  ): Promise<void> {
    const section = await this.prisma.club_sections.findFirst({
      where: { club_section_id: clubSectionId, active: true },
      select: {
        club_section_id: true,
        club_type_id: true,
        club_types: {
          select: {
            name: true,
          },
        },
      },
    });

    const actualInstanceType = section
      ? this.mapClubSectionToInstanceType(section)
      : null;

    if (actualInstanceType !== expectedInstanceType) {
      throw new AppBadRequestException(ErrorCode.NOTIF_TARGET_TYPE_MISMATCH, {
        clubSectionId,
        expectedInstanceType,
        actualInstanceType,
      });
    }
  }

  private async assertExactClubAssignmentScope(
    userId: string,
    clubSectionId: number,
  ): Promise<void> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);
    const activeClubScope = resolved.authorization.effective.scope.club;

    if (
      !activeClubScope ||
      activeClubScope.section.club_section_id !== clubSectionId
    ) {
      throw new AppForbiddenException(ErrorCode.NOTIF_SEND_FORBIDDEN);
    }
  }

  private mapClubSectionToInstanceType(section: {
    club_type_id: number | null;
    club_types?: { name: string | null } | null;
  }): NotificationClubInstanceType | null {
    const byName = this.mapClubTypeNameToInstanceType(section.club_types?.name);
    if (byName) {
      return byName;
    }

    return this.mapClubTypeIdToInstanceType(section.club_type_id);
  }

  private mapClubTypeNameToInstanceType(
    clubTypeName?: string | null,
  ): NotificationClubInstanceType | null {
    const normalized = (clubTypeName ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    if (normalized.includes('aventur')) {
      return 'adventurers';
    }

    if (normalized.includes('conquist') || normalized.includes('pathfinder')) {
      return 'pathfinders';
    }

    if (normalized.includes('guia') || normalized.includes('master')) {
      return 'master_guilds';
    }

    return null;
  }

  private buildAdminHistoryWhere(
    callerUserId: string,
    resolved: Awaited<
      ReturnType<AuthorizationContextService['resolveUserAuthorization']>
    >,
  ) {
    const globalRoleNames = new Set(
      resolved.authorization.grants.global_roles.map((grant) =>
        grant.role_name.toLowerCase(),
      ),
    );

    if (globalRoleNames.has('super-admin')) {
      return {};
    }

    const globalScope = resolved.authorization.effective.scope.global;
    const unionId = globalScope.union?.id;
    if (typeof unionId === 'number') {
      return {
        deliveries: {
          some: {
            user: {
              union_id: unionId,
            },
          },
        },
      };
    }

    const localFieldId = globalScope.local_field?.id;
    if (typeof localFieldId === 'number') {
      return {
        deliveries: {
          some: {
            user: {
              local_field_id: localFieldId,
            },
          },
        },
      };
    }

    const countryId = globalScope.country?.id;
    if (typeof countryId === 'number') {
      return {
        deliveries: {
          some: {
            user: {
              country_id: countryId,
            },
          },
        },
      };
    }

    return { sent_by: callerUserId };
  }

  private mapClubTypeIdToInstanceType(
    clubTypeId: number | null,
  ): NotificationClubInstanceType | null {
    switch (clubTypeId) {
      case 1:
        return 'adventurers';
      case 2:
        return 'pathfinders';
      case 3:
        return 'master_guilds';
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Inbox helpers (unread count, mark read, mark all read)
  // ---------------------------------------------------------------------------

  /**
   * Count unread deliveries for the calling user.
   */
  async getUnreadCount(callerUserId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification_deliveries.count({
      where: { user_id: callerUserId, read_at: null },
    });
    return { count };
  }

  /**
   * Mark a single delivery as read. Verifies ownership — throws NotFoundException
   * if the delivery does not exist or belongs to another user.
   */
  async markDeliveryRead(deliveryId: string, callerUserId: string) {
    const delivery = await this.prisma.notification_deliveries.findFirst({
      where: { delivery_id: deliveryId, user_id: callerUserId },
    });
    if (!delivery) {
      throw new AppNotFoundException(ErrorCode.NOTIF_NOT_FOUND);
    }
    return this.prisma.notification_deliveries.update({
      where: { delivery_id: deliveryId },
      data: { read_at: new Date() },
    });
  }

  /**
   * Bulk mark all unread deliveries as read for the calling user.
   */
  async markAllDeliveriesRead(
    callerUserId: string,
  ): Promise<{ updated: number }> {
    const result = await this.prisma.notification_deliveries.updateMany({
      where: { user_id: callerUserId, read_at: null },
      data: { read_at: new Date() },
    });
    return { updated: result.count };
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
    // Step 1: Check opt-out. Opt-out suppresses BOTH push and inbox delivery.
    const allowed = await this.preferencesService.isAllowedForUser(
      dto.userId,
      source,
    );
    if (!allowed) {
      this.logger.debug(
        `Notification to user ${dto.userId} skipped — opted out of source "${source}"`,
      );
      return { success: false, skipped: true, reason: 'user_preference' };
    }

    // Step 2: Create log + delivery BEFORE FCM push. The inbox entry must
    // exist regardless of whether the user has active FCM tokens.
    let successCount = 0;
    let failureCount = 0;
    let logId: number | undefined;

    await this.prisma
      .$transaction(async (tx) => {
        const log = await tx.notification_logs.create({
          data: {
            title: dto.title,
            body: dto.body,
            type: 'USER',
            target_type: 'user',
            target_id: dto.userId,
            sent_by: isUuid(sentBy) ? sentBy : null,
            source: source ?? null,
            tokens_sent: 0,
            tokens_failed: 0,
          },
        });
        logId = log.log_id;
        await tx.notification_deliveries.create({
          data: { log_id: log.log_id, user_id: dto.userId },
        });
      })
      .catch((err: Error) => {
        this.logger.warn(
          `sendToUserSync: failed to persist log/delivery for user ${dto.userId}: ${err.message}`,
        );
      });

    // Step 3: FCM push — best effort, only if tokens exist.
    const tokens = await this.prisma.user_fcm_tokens.findMany({
      where: { user_id: dto.userId, active: true },
      select: { token: true },
    });

    if (tokens.length > 0 && this.isFcmConfigured()) {
      const tokenStrings = tokens.map((t) => t.token);
      ({ successCount, failureCount } = await this.sendMulticastDirect(
        tokenStrings,
        dto.title,
        dto.body,
        dto.data,
      ));
      await this.updateNotificationLogTokenCounts(
        logId,
        successCount,
        failureCount,
        `sendToUserSync user ${dto.userId}`,
      );
    } else if (tokens.length > 0) {
      this.logger.debug(
        `sendToUserSync: FCM not configured — delivery created, push skipped for user ${dto.userId}`,
      );
    } else {
      this.logger.debug(
        `sendToUserSync: no active FCM tokens for user ${dto.userId} — delivery created, push skipped`,
      );
    }

    return {
      success: true,
      successCount,
      failureCount,
      skippedPush: tokens.length === 0 || !this.isFcmConfigured(),
    };
  }

  private async broadcastSync(
    dto: BroadcastNotificationDto,
    sentBy: string,
    source?: string,
  ) {
    // Step 1: Resolve all active users — the inbox recipients.
    // We query users directly, NOT tokens, so users without tokens still get
    // a delivery row. Opt-out suppresses both push and inbox.
    const activeUsers = await this.prisma.users.findMany({
      where: { active: true },
      select: { user_id: true },
    });

    if (activeUsers.length === 0) {
      return { success: false, message: 'No active users' };
    }

    const allUserIds = activeUsers.map((u) => u.user_id);
    const allowedSet = await this.preferencesService.filterAllowedUsers(
      allUserIds,
      source,
    );
    const allowedUserIds = [...allowedSet];

    if (allowedUserIds.length === 0) {
      return { success: false, message: 'All users opted out' };
    }

    // Step 2: Create log + deliveries for ALL allowed users atomically.
    // Token count is unknown at this point; we'll update after FCM.
    let totalSuccess = 0;
    let totalFailure = 0;
    let logId: number | undefined;

    await this.prisma
      .$transaction(async (tx) => {
        const log = await tx.notification_logs.create({
          data: {
            title: dto.title,
            body: dto.body,
            type: 'BROADCAST',
            target_type: 'all',
            target_id: null,
            sent_by: isUuid(sentBy) ? sentBy : null,
            source: source ?? null,
            tokens_sent: 0,
            tokens_failed: 0,
          },
        });
        logId = log.log_id;
        await tx.notification_deliveries.createMany({
          data: allowedUserIds.map((uid) => ({
            log_id: log.log_id,
            user_id: uid,
          })),
          skipDuplicates: true,
        });
      })
      .catch((err: Error) => {
        this.logger.warn(
          `broadcastSync: failed to persist log/deliveries: ${err.message}`,
        );
      });

    // Step 3: FCM push — best effort, only to users with active tokens.
    const tokenRows = await this.prisma.user_fcm_tokens.findMany({
      where: { user_id: { in: allowedUserIds }, active: true },
      select: { token: true },
    });

    if (tokenRows.length > 0 && this.isFcmConfigured()) {
      const tokenStrings = tokenRows.map((t) => t.token);
      const batches = chunkArray(tokenStrings, 500);

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
      await this.updateNotificationLogTokenCounts(
        logId,
        totalSuccess,
        totalFailure,
        'broadcastSync',
      );
    } else if (tokenRows.length > 0) {
      this.logger.debug(
        `broadcastSync: FCM not configured — deliveries created, push skipped`,
      );
    } else {
      this.logger.debug(
        `broadcastSync: no active FCM tokens for any allowed user — deliveries created, push skipped`,
      );
    }

    return {
      success: true,
      successCount: totalSuccess,
      failureCount: totalFailure,
      deliveriesCreated: allowedUserIds.length,
      skippedPush: tokenRows.length === 0 || !this.isFcmConfigured(),
    };
  }

  private async sendToClubMembersSync(
    clubSectionId: number,
    dto: Omit<BroadcastNotificationDto, 'userId'>,
    sentBy: string,
    source?: string,
  ) {
    // Step 1: Resolve members — genuine empty set is a hard stop.
    const members = await this.prisma.club_role_assignments.findMany({
      where: { club_section_id: clubSectionId, active: true, status: 'active' },
      select: { user_id: true },
    });

    const rawUserIds = [...new Set(members.map((m) => m.user_id))];
    if (rawUserIds.length === 0) {
      return { success: false, message: 'No members found' };
    }

    // Opt-out suppresses both push and inbox delivery.
    const allowedSet = await this.preferencesService.filterAllowedUsers(
      rawUserIds,
      source,
    );
    const userIds = [...allowedSet];

    if (userIds.length === 0) {
      return { success: false, message: 'All members opted out' };
    }

    // Step 2: Create log + deliveries for all allowed members atomically.
    // This happens regardless of FCM token availability.
    let totalSuccess = 0;
    let totalFailure = 0;
    let logId: number | undefined;

    await this.prisma
      .$transaction(async (tx) => {
        const log = await tx.notification_logs.create({
          data: {
            title: dto.title,
            body: dto.body,
            type: 'CLUB',
            target_type: 'club_section',
            target_id: String(clubSectionId),
            sent_by: isUuid(sentBy) ? sentBy : null,
            source: source ?? null,
            tokens_sent: 0,
            tokens_failed: 0,
          },
        });
        logId = log.log_id;
        await tx.notification_deliveries.createMany({
          data: userIds.map((uid) => ({ log_id: log.log_id, user_id: uid })),
          skipDuplicates: true,
        });
      })
      .catch((err: Error) => {
        this.logger.warn(
          `sendToClubMembersSync: failed to persist log/deliveries for section ${clubSectionId}: ${err.message}`,
        );
      });

    // Step 3: FCM push — best effort, only to members with active tokens.
    const tokens = await this.prisma.user_fcm_tokens.findMany({
      where: { user_id: { in: userIds }, active: true },
      select: { token: true },
    });

    if (tokens.length > 0 && this.isFcmConfigured()) {
      const tokenStrings = tokens.map((t) => t.token);
      const batches = chunkArray(tokenStrings, 500);

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
      await this.updateNotificationLogTokenCounts(
        logId,
        totalSuccess,
        totalFailure,
        `sendToClubMembersSync section ${clubSectionId}`,
      );
    } else if (tokens.length > 0) {
      this.logger.debug(
        `sendToClubMembersSync: FCM not configured for section ${clubSectionId} — deliveries created, push skipped`,
      );
    } else {
      this.logger.debug(
        `sendToClubMembersSync: no active FCM tokens for section ${clubSectionId} — deliveries created, push skipped`,
      );
    }

    return {
      success: true,
      successCount: totalSuccess,
      failureCount: totalFailure,
      memberCount: rawUserIds.length,
      skippedPush: tokens.length === 0 || !this.isFcmConfigured(),
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
      return;
    }

    // Opt-out suppresses both push and inbox delivery.
    const allowedSet = await this.preferencesService.filterAllowedUsers(
      rawUserIds,
      source,
    );
    const userIds = rawUserIds.filter((id) => allowedSet.has(id));

    if (userIds.length === 0) {
      return;
    }

    // Step 2: Create log + deliveries for all allowed users atomically.
    // This happens regardless of FCM token availability.
    let logId: number | undefined;

    await this.prisma
      .$transaction(async (tx) => {
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
        logId = log.log_id;
        await tx.notification_deliveries.createMany({
          data: userIds.map((uid) => ({ log_id: log.log_id, user_id: uid })),
          skipDuplicates: true,
        });
      })
      .catch((err: Error) => {
        this.logger.warn(
          `sendToSectionRoleSync: failed to persist log/deliveries for section ${clubSectionId}: ${err.message}`,
        );
      });

    // Step 3: FCM push — best effort, only to users with active tokens.
    const tokens = await this.prisma.user_fcm_tokens.findMany({
      where: { user_id: { in: userIds }, active: true },
      select: { token: true },
    });

    if (tokens.length === 0 || !this.isFcmConfigured()) {
      this.logger.debug(
        `sendToSectionRoleSync: ${tokens.length === 0 ? 'no active FCM tokens' : 'FCM not configured'} for section ${clubSectionId} — deliveries created, push skipped`,
      );
      return;
    }

    const tokenStrings = tokens.map((t) => t.token);
    const batches = chunkArray(tokenStrings, 500);

    const { successCount, failureCount } =
      await this.sendMulticastDirectBatches(
        batches,
        title,
        body,
        data,
        `sendToSectionRoleSync section ${clubSectionId}`,
      );
    await this.updateNotificationLogTokenCounts(
      logId,
      successCount,
      failureCount,
      `sendToSectionRoleSync section ${clubSectionId}`,
    );
  }

  private async sendToGlobalRoleSync(
    roleNames: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
    localFieldId?: number,
    source?: string,
    unionId?: number,
  ): Promise<void> {
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
      return;
    }

    // Opt-out suppresses both push and inbox delivery.
    const allowedSet = await this.preferencesService.filterAllowedUsers(
      rawUserIds,
      source,
    );
    const userIds = rawUserIds.filter((id) => allowedSet.has(id));

    if (userIds.length === 0) {
      return;
    }

    // Step 2: Create log + deliveries for all allowed users atomically.
    // This happens regardless of FCM token availability.
    let logId: number | undefined;

    await this.prisma
      .$transaction(async (tx) => {
        const log = await tx.notification_logs.create({
          data: {
            title,
            body,
            type: 'GLOBAL_ROLE',
            target_type: 'global_role',
            target_id: unionId
              ? String(unionId)
              : localFieldId
                ? String(localFieldId)
                : null,
            sent_by: null,
            source: source ?? null,
            tokens_sent: 0,
            tokens_failed: 0,
          },
        });
        logId = log.log_id;
        await tx.notification_deliveries.createMany({
          data: userIds.map((uid) => ({ log_id: log.log_id, user_id: uid })),
          skipDuplicates: true,
        });
      })
      .catch((err: Error) => {
        this.logger.warn(
          `sendToGlobalRoleSync: failed to persist log/deliveries for roles ${roleNames.join(',')}: ${err.message}`,
        );
      });

    // Step 3: FCM push — best effort, only to users with active tokens.
    const tokens = await this.prisma.user_fcm_tokens.findMany({
      where: { user_id: { in: userIds }, active: true },
      select: { token: true },
    });

    if (tokens.length === 0 || !this.isFcmConfigured()) {
      this.logger.debug(
        `sendToGlobalRoleSync: ${tokens.length === 0 ? 'no active FCM tokens' : 'FCM not configured'} for roles ${roleNames.join(',')} — deliveries created, push skipped`,
      );
      return;
    }

    const tokenStrings = tokens.map((t) => t.token);
    const batches = chunkArray(tokenStrings, 500);

    const { successCount, failureCount } =
      await this.sendMulticastDirectBatches(
        batches,
        title,
        body,
        data,
        `sendToGlobalRoleSync roles ${roleNames.join(',')}`,
      );
    await this.updateNotificationLogTokenCounts(
      logId,
      successCount,
      failureCount,
      `sendToGlobalRoleSync roles ${roleNames.join(',')}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Core FCM helper (synchronous path)
  // ---------------------------------------------------------------------------

  private async sendMulticastDirectBatches(
    batches: string[][],
    title: string,
    body: string,
    data: Record<string, string> | undefined,
    context: string,
  ): Promise<{ successCount: number; failureCount: number }> {
    let successCount = 0;
    let failureCount = 0;

    for (const batch of batches) {
      try {
        const result = await this.sendMulticastDirect(batch, title, body, data);
        successCount += result.successCount;
        failureCount += result.failureCount;
      } catch (err) {
        this.logger.warn(
          `${context} batch failed: ${(err as Error).message ?? String(err)}`,
        );
      }
    }

    return { successCount, failureCount };
  }

  private async updateNotificationLogTokenCounts(
    logId: number | undefined,
    tokensSent: number,
    tokensFailed: number,
    context: string,
  ): Promise<void> {
    if (typeof logId !== 'number') return;

    await this.prisma.notification_logs
      .update({
        where: { log_id: logId },
        data: {
          tokens_sent: tokensSent,
          tokens_failed: tokensFailed,
        },
      })
      .catch((err: Error) => {
        this.logger.warn(
          `${context}: failed to update notification token counters for log ${logId}: ${err.message}`,
        );
      });
  }

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
    const response = await firebaseAdmin.getMessaging().sendEachForMulticast({
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

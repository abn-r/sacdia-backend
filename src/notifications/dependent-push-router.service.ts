import { Injectable, Logger } from '@nestjs/common';
import { chunkArray } from '../common/utils/notification.utils';
import {
  ACTIVE_USER_GUARDIAN,
  GUARDIAN_MANAGED_DEPENDENT,
} from '../guardianships/guardianship-queries';
import { MAX_GUARDIANS_PER_DEPENDENT } from '../guardianships/guardianships.constants';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { FCM_MAX_BATCH_SIZE, type FcmTargetRow } from './fcm-targets';

/** Sources emitted TO guardians directly must never be re-fanned-out. */
const FAMILY_SOURCE_PREFIX = 'family:';

/**
 * Above this many recipients, one query for every dependent in the system is
 * cheaper than a huge IN list (dependents are a tiny fraction of the users).
 */
const LOAD_ALL_DEPENDENTS_THRESHOLD = 2000;

export interface DependentRoute {
  dependentUserId: string;
  /** First name, used as the push label ("Ana · title"). */
  displayName: string;
  guardianUserIds: string[];
}

export interface GuardianPush {
  dependentUserId: string;
  guardianUserIds: string[];
  /** Active FCM targets (tokens and FIDs) of the notified guardians. */
  targets: FcmTargetRow[];
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  source?: string;
}

export type MulticastSender = (
  targets: FcmTargetRow[],
  title: string,
  body: string,
  data?: Record<string, string>,
) => Promise<{ successCount: number; failureCount: number }>;

/**
 * A dependent has no account and therefore no FCM tokens: a push addressed to
 * one would go nowhere. This router expands such recipients to their active
 * guardians (max 4), labels the push with the child's first name and honors
 * each guardian's own notification preferences.
 *
 * The dependent's INBOX delivery is created by the callers exactly as for any
 * user and stays on the dependent (the guardian reads it by switching profile).
 * Silent realtime pushes never reach this router, and `family:*` sources are
 * skipped because those notifications already address the guardians.
 */
@Injectable()
export class DependentPushRouterService {
  private readonly logger = new Logger(DependentPushRouterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  /** `family:*` sources already target guardians: never fan out again. */
  isRoutableSource(source: string | undefined): boolean {
    return !(source ?? '').startsWith(FAMILY_SOURCE_PREFIX);
  }

  /**
   * Which of `userIds` are dependents that can be reached through guardians?
   * ONE query regardless of how many ids come in. Frozen, purged and inactive
   * dependents are excluded, and so are teens running their own enabled login
   * (GUARDIAN_MANAGED_DEPENDENT); so are dependents without any active guardian.
   */
  async expand(userIds: readonly string[]): Promise<DependentRoute[]> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return [];

    const loadAll = unique.length > LOAD_ALL_DEPENDENTS_THRESHOLD;
    const rows = await this.prisma.users.findMany({
      where: {
        ...(loadAll ? {} : { user_id: { in: unique } }),
        // A teen with an ENABLED supervised login gets no guardian copies (they
        // receive their own pushes); a disabled guardian-enabled one does again.
        ...GUARDIAN_MANAGED_DEPENDENT,
      },
      select: {
        user_id: true,
        name: true,
        guardianships_as_dependent: {
          where: ACTIVE_USER_GUARDIAN,
          orderBy: { created_at: 'asc' },
          take: MAX_GUARDIANS_PER_DEPENDENT,
          select: { guardian_user_id: true },
        },
      },
    });

    const wanted = loadAll ? new Set(unique) : null;
    return rows
      .filter((row) => (wanted ? wanted.has(row.user_id) : true))
      .map((row) => ({
        dependentUserId: row.user_id,
        displayName: firstName(row.name),
        guardianUserIds: row.guardianships_as_dependent
          .map((guardianship) => guardianship.guardian_user_id)
          .filter((id): id is string => id !== null),
      }))
      .filter((route) => route.guardianUserIds.length > 0);
  }

  /** The pushes that guardians must receive for a notification to `userIds`. */
  async buildPushes(
    userIds: readonly string[],
    payload: PushPayload,
  ): Promise<GuardianPush[]> {
    if (!this.isRoutableSource(payload.source)) return [];

    const routes = await this.expand(userIds);
    if (routes.length === 0) return [];

    const guardianIds = [
      ...new Set(routes.flatMap((route) => route.guardianUserIds)),
    ];
    const allowed = await this.preferences.filterAllowedUsers(
      guardianIds,
      payload.source,
    );
    if (allowed.size === 0) return [];

    const tokenRows = await this.prisma.user_fcm_tokens.findMany({
      where: { user_id: { in: [...allowed] }, active: true },
      select: { user_id: true, token: true, kind: true },
    });
    const targetsByGuardian = new Map<string, FcmTargetRow[]>();
    for (const row of tokenRows) {
      targetsByGuardian.set(row.user_id, [
        ...(targetsByGuardian.get(row.user_id) ?? []),
        { token: row.token, kind: row.kind },
      ]);
    }

    const pushes: GuardianPush[] = [];
    for (const route of routes) {
      const guardians = route.guardianUserIds.filter((id) => allowed.has(id));
      // A device shared by several guardians would otherwise be pushed twice.
      const targets = [
        ...new Map(
          guardians
            .flatMap((id) => targetsByGuardian.get(id) ?? [])
            .map((target) => [target.token, target] as const),
        ).values(),
      ];
      if (targets.length === 0) continue;
      pushes.push({
        dependentUserId: route.dependentUserId,
        guardianUserIds: guardians,
        targets,
        title: `${route.displayName} · ${payload.title}`,
        body: payload.body,
        data: {
          ...(payload.data ?? {}),
          dependent_user_id: route.dependentUserId,
        },
      });
    }
    return pushes;
  }

  /**
   * Builds and sends the guardian pushes with the caller's own multicast (so
   * invalid-token cleanup stays where it already lives). Best effort: it never
   * throws, because the primary delivery already happened.
   */
  async routeAndSend(
    userIds: readonly string[],
    payload: PushPayload,
    send: MulticastSender,
    context: string,
  ): Promise<{ successCount: number; failureCount: number }> {
    let successCount = 0;
    let failureCount = 0;
    try {
      const pushes = await this.buildPushes(userIds, payload);
      for (const push of pushes) {
        for (const batch of chunkArray(push.targets, FCM_MAX_BATCH_SIZE)) {
          try {
            const result = await send(batch, push.title, push.body, push.data);
            successCount += result.successCount;
            failureCount += result.failureCount;
          } catch (error) {
            this.logger.warn(
              `${context}: guardian push for dependent ${push.dependentUserId} failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
      }
    } catch (error) {
      this.logger.warn(
        `${context}: dependent push routing failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return { successCount, failureCount };
  }
}

function firstName(name: string | null): string {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : 'Menor';
}

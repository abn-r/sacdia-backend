import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { ageToday } from '../common/age/age.util';
import { CountryAgePolicyService } from '../common/age/country-age-policy.service';
import type { SupervisedLoginEvents } from '../auth/supervised/supervised-login-events.port';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_USER_GUARDIAN } from './guardianship-queries';
import { MAX_GUARDIANS_PER_DEPENDENT } from './guardianships.constants';

/** Mandatory source: a guardian cannot mute it (see MANDATORY_SOURCE_PREFIXES). */
export const SECURITY_SOURCE = 'family:security';
/** Told to the teen when an adult links as their guardian. */
export const GUARDIAN_LINKED_SOURCE = 'family:guardian_linked';

/** A burst of logins is ONE notice per 15 minutes (refresh never notifies). */
export const NEW_SESSION_DEDUPE_MS = 15 * 60 * 1000;

export type SecurityEvent =
  | 'teen_new_session'
  | 'teen_password_changed'
  | 'teen_password_reset'
  | 'teen_login_locked'
  | 'teen_login_disabled'
  | 'teen_login_enabled'
  | 'teen_login_reactivated'
  | 'device_paired'
  | 'device_revoked'
  | 'teen_guardian_linked';

interface NoticeText {
  title: string;
  body: string;
}

/**
 * Security notices about a supervised minor (Phase 3a, FP3-23).
 *
 * Channel: push + inbox through NotificationsService, NEVER email (the Resend
 * queue is capped at 90/day). Source `family:security`, which is mandatory: a
 * guardian cannot mute it.
 *
 * Recipients: every active, non-test, NON-custodian user guardian with a
 * VERIFIED row (max 4), minus the person who performed the action. A pending
 * link (a stranger holding a leaked code) and club custody never receive them,
 * and they stop at the age of majority.
 *
 * Text rules: the title starts with the child's first name; no body ever
 * contains a password, a handle, an IP or a token.
 *
 * Everything here is best effort: it never throws and the originating login,
 * reset or update never waits on it for correctness. It implements the
 * SupervisedLoginEvents port, so the login and guardian-control code stay
 * decoupled from the notification stack.
 */
@Injectable()
export class GuardianSecurityNotificationsService implements SupervisedLoginEvents {
  private readonly logger = new Logger(
    GuardianSecurityNotificationsService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly countryAgePolicy: CountryAgePolicyService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // ---------------------------------------------------------------------------
  // SupervisedLoginEvents
  // ---------------------------------------------------------------------------

  async onLoginLocked(input: {
    identifier: string;
    retryAfterSeconds: number;
  }): Promise<void> {
    const teenId = await this.resolveIdentifier(input.identifier);
    // Unknown identifier: nothing to tell, and nothing to reveal either.
    if (!teenId) return;
    await this.notifyGuardians(teenId, 'teen_login_locked', {});
  }

  async onTeenSessionStarted(input: { userId: string }): Promise<void> {
    await this.notifyGuardians(input.userId, 'teen_new_session', {});
  }

  async onTeenPasswordChanged(input: { userId: string }): Promise<void> {
    await this.notifyGuardians(input.userId, 'teen_password_changed', {});
  }

  async onPasswordReset(input: {
    dependentUserId: string;
    actorUserId?: string;
  }): Promise<void> {
    await this.notifyGuardians(input.dependentUserId, 'teen_password_reset', {
      excludeUserId: input.actorUserId,
    });
    if (input.actorUserId) {
      // The teen learns on their next login, without a push that would ring on a
      // phone that was just signed out.
      await this.inboxOnly(input.dependentUserId, {
        title: 'Tu contraseña fue restablecida',
        body: 'Un tutor restableció la contraseña de tu cuenta. Inicia sesión de nuevo.',
      });
    }
  }

  async onLoginEnabled(input: {
    dependentUserId: string;
    actorUserId: string;
  }): Promise<void> {
    await this.notifyGuardians(input.dependentUserId, 'teen_login_enabled', {
      excludeUserId: input.actorUserId,
    });
  }

  async onLoginDisabled(input: {
    dependentUserId: string;
    actorUserId: string;
  }): Promise<void> {
    await this.notifyGuardians(input.dependentUserId, 'teen_login_disabled', {
      excludeUserId: input.actorUserId,
    });
  }

  async onLoginReactivated(input: {
    dependentUserId: string;
    actorUserId: string;
  }): Promise<void> {
    await this.notifyGuardians(
      input.dependentUserId,
      'teen_login_reactivated',
      {
        excludeUserId: input.actorUserId,
      },
    );
  }

  /** Told to the TEEN (transparency): an adult accepted their code, pending verification. */
  async onGuardianLinked(input: {
    teenUserId: string;
    guardianUserId: string;
  }): Promise<void> {
    try {
      await this.notifications.sendToUser(
        {
          userId: input.teenUserId,
          title: 'Un adulto se vinculó como tu tutor',
          body: 'El club debe verificar la ficha de consentimiento firmada para activar tu cuenta completa.',
          data: {
            type: 'teen_guardian_linked',
            event: 'teen_guardian_linked',
          },
        },
        'system',
        GUARDIAN_LINKED_SOURCE,
      );
    } catch (error) {
      this.warn('teen_guardian_linked', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Device hooks (called by 3b)
  // ---------------------------------------------------------------------------

  async onDevicePaired(input: {
    dependentUserId: string;
    label: string;
    platform: string;
  }): Promise<void> {
    await this.notifyGuardians(input.dependentUserId, 'device_paired', {
      detail: `${input.label} (${input.platform})`,
    });
  }

  async onDeviceRevoked(input: {
    dependentUserId: string;
    label: string;
    excludeUserId?: string;
  }): Promise<void> {
    await this.notifyGuardians(input.dependentUserId, 'device_revoked', {
      detail: input.label,
      excludeUserId: input.excludeUserId,
    });
  }

  // ---------------------------------------------------------------------------
  // Core
  // ---------------------------------------------------------------------------

  /**
   * Who gets the notice: verified non-custodian user guardians, at most 4,
   * without the actor. Empty for an adult, an unknown user or a child with no
   * verified guardian (no-op, no error).
   */
  async recipientsOf(
    dependentId: string,
    excludeUserId?: string,
  ): Promise<{ firstName: string; guardianIds: string[] } | null> {
    const dependent = await this.prisma.users.findUnique({
      where: { user_id: dependentId },
      select: {
        name: true,
        birthday: true,
        country_id: true,
        guardianships_as_dependent: {
          where: { ...ACTIVE_USER_GUARDIAN, consent_status: 'verified' },
          orderBy: { created_at: 'asc' },
          take: MAX_GUARDIANS_PER_DEPENDENT,
          select: { guardian_user_id: true },
        },
      },
    });
    if (!dependent || !dependent.birthday) return null;

    // Notices stop at the age of majority.
    const policy = await this.countryAgePolicy.getPolicy(dependent.country_id);
    if (ageToday(dependent.birthday, policy.timeZone) >= policy.ageOfMajority) {
      return null;
    }

    const guardianIds = [
      ...new Set(
        dependent.guardianships_as_dependent
          .map((row) => row.guardian_user_id)
          .filter((id): id is string => id !== null && id !== excludeUserId),
      ),
    ];
    if (guardianIds.length === 0) return null;
    return { firstName: firstNameOf(dependent.name), guardianIds };
  }

  private async notifyGuardians(
    dependentId: string,
    event: SecurityEvent,
    options: { excludeUserId?: string; detail?: string },
  ): Promise<void> {
    try {
      if (
        event === 'teen_new_session' &&
        !(await this.claimNewSessionWindow(dependentId))
      ) {
        return;
      }

      const target = await this.recipientsOf(
        dependentId,
        options.excludeUserId,
      );
      if (!target) return;

      const text = noticeText(event, target.firstName, options.detail);
      await Promise.allSettled(
        target.guardianIds.map((guardianId) =>
          this.notifications.sendToUser(
            {
              userId: guardianId,
              title: text.title,
              body: text.body,
              data: {
                type: 'dependent_security',
                event,
                dependent_user_id: dependentId,
              },
            },
            'system',
            SECURITY_SOURCE,
          ),
        ),
      );
    } catch (error) {
      this.warn(event, error);
    }
  }

  /**
   * True the first time within 15 minutes; later logins inside the window are
   * silent. A cache outage lets the notice through (one extra notice is better
   * than a missing one).
   */
  private async claimNewSessionWindow(dependentId: string): Promise<boolean> {
    const key = `family-security:new-session:${dependentId}`;
    try {
      if (await this.cache.get(key)) return false;
      await this.cache.set(key, 1, NEW_SESSION_DEDUPE_MS);
    } catch (error) {
      this.warn('new_session_dedupe', error);
    }
    return true;
  }

  /** Inbox row without a push (the same tables a normal send writes first). */
  private async inboxOnly(userId: string, text: NoticeText): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const log = await tx.notification_logs.create({
          data: {
            title: text.title,
            body: text.body,
            type: 'USER',
            target_type: 'user',
            target_id: userId,
            sent_by: null,
            source: SECURITY_SOURCE,
            tokens_sent: 0,
            tokens_failed: 0,
          },
        });
        await tx.notification_deliveries.create({
          data: { log_id: log.log_id, user_id: userId },
        });
      });
    } catch (error) {
      this.warn('inbox_only', error);
    }
  }

  /** An email contains '@'; anything else is a login handle. */
  private async resolveIdentifier(identifier: string): Promise<string | null> {
    try {
      if (identifier.includes('@')) {
        const user = await this.prisma.users.findFirst({
          where: { email: { equals: identifier, mode: 'insensitive' } },
          select: { user_id: true },
        });
        return user?.user_id ?? null;
      }
      const login = await this.prisma.supervised_logins.findFirst({
        where: { login_handle: identifier },
        select: { user_id: true },
      });
      return login?.user_id ?? null;
    } catch (error) {
      this.warn('resolve_identifier', error);
      return null;
    }
  }

  private warn(event: string, error: unknown): void {
    // Never log the identifier, a handle or any recipient detail.
    this.logger.warn(
      `security notice (${event}) failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function firstNameOf(name: string | null): string {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : 'Tu menor';
}

/** Spanish texts; the title always starts with the child's first name. */
export function noticeText(
  event: SecurityEvent,
  first: string,
  detail?: string,
): NoticeText {
  switch (event) {
    case 'teen_new_session':
      return {
        title: `${first} · nuevo inicio de sesión`,
        body: `${first} inició sesión en su cuenta.`,
      };
    case 'teen_password_changed':
      return {
        title: `${first} · cambió su contraseña`,
        body: `${first} cambió la contraseña de su cuenta.`,
      };
    case 'teen_password_reset':
      return {
        title: `${first} · contraseña restablecida`,
        body: `La contraseña de la cuenta de ${first} fue restablecida y se cerraron sus sesiones.`,
      };
    case 'teen_login_locked':
      return {
        title: `${first} · acceso bloqueado temporalmente`,
        body: `Hubo varios intentos fallidos de inicio de sesión en la cuenta de ${first}. Se bloqueó temporalmente.`,
      };
    case 'teen_login_disabled':
      return {
        title: `${first} · acceso desactivado`,
        body: `Se desactivó el inicio de sesión propio de ${first}.`,
      };
    case 'teen_login_enabled':
      return {
        title: `${first} · acceso propio activado`,
        body: `Un tutor activó el inicio de sesión propio de ${first}.`,
      };
    case 'teen_login_reactivated':
      return {
        title: `${first} · acceso reactivado`,
        body: `Se reactivó el inicio de sesión propio de ${first}.`,
      };
    case 'device_paired':
      return {
        title: `${first} · dispositivo vinculado`,
        body: `Se vinculó un dispositivo a la cuenta de ${first}${detail ? `: ${detail}` : ''}.`,
      };
    case 'device_revoked':
      return {
        title: `${first} · dispositivo desvinculado`,
        body: `Se desvinculó un dispositivo de la cuenta de ${first}${detail ? `: ${detail}` : ''}.`,
      };
    case 'teen_guardian_linked':
      return {
        title: `${first} · tutor vinculado`,
        body: `Un adulto se vinculó como tutor de ${first}.`,
      };
  }
}

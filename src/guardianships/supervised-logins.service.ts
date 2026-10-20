import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import {
  getAuditCorrelationId,
  markExplicitAuditRecorded,
} from '../audit-logs/audit-request-context';
import { ActingForCache } from '../auth/acting-for/acting-for.cache';
import {
  NEW_PASSWORD_COMPLEXITY,
  NEW_PASSWORD_MAX_LENGTH,
  NEW_PASSWORD_MIN_LENGTH,
} from '../auth/password-policy';
import {
  fireEvent,
  resolveSupervisedLoginEvents,
  SUPERVISED_LOGIN_EVENTS,
  type SupervisedLoginEvents,
} from '../auth/supervised/supervised-login-events.port';
import { BetterAuthService } from '../better-auth/better-auth.service';
import { ageToday } from '../common/age/age.util';
import { CountryAgePolicyService } from '../common/age/country-age-policy.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { TokenBlacklistService } from '../common/services/token-blacklist.service';
import { PrismaService } from '../prisma/prisma.service';
import { DependentActionLimiter } from './dependent-action-limiter';
import type {
  DisableSupervisedLoginDto,
  EnableSupervisedLoginDto,
  ReactivateSupervisedLoginDto,
  SetSupervisedPasswordDto,
} from './dto';
import { FamilyFeatureFlagsService } from './family-feature-flags.service';
import { GuardianPowersPolicy } from './guardian-powers.policy';
import { lockDependent } from './guardianship-queries';
import {
  LINKED_DEVICE_REVOKER,
  type LinkedDeviceRevoker,
} from './linked-device-revoker.port';
import { allocateLoginHandle, isUniqueViolation } from './login-handle.util';

const BCRYPT_ROUNDS = 12;
const HOUR_MS = 3_600_000;
/** Matches the access JWT life: revocation records must outlive issued tokens. */
const JWT_TTL_SECONDS = 28_800;
const HANDLE_ATTEMPTS = 3;

/** Reasons a minor cannot get (or keep managing) a supervised login. */
export type IneligibleReason =
  | 'age_below_min'
  | 'age_over_majority'
  | 'birthday_missing'
  | 'has_account'
  | 'inactive'
  | 'already_enabled'
  | 'consent_not_verified';

export interface SupervisedLoginView {
  method: 'email' | 'handle';
  login_handle: string | null;
  email: string | null;
  origin: 'self_registered' | 'guardian_enabled';
  enabled_at: string | null;
  disabled_at: string | null;
  disabled_reason: string | null;
  password_set_by: 'guardian' | 'self';
}

interface DependentRow {
  user_id: string;
  name: string | null;
  email: string | null;
  active: boolean;
  birthday: Date | null;
  country_id: number | null;
  dependent_profile: { frozen_at: Date | null; purged_at: Date | null } | null;
  account: Array<{ id: string }>;
  supervised_login: LoginRow | null;
}

interface LoginRow {
  method: string;
  login_handle: string | null;
  origin: string;
  enabled_at: Date | null;
  disabled_at: Date | null;
  disabled_reason: string | null;
  password_set_by: string;
}

const DEPENDENT_SELECT = {
  user_id: true,
  name: true,
  email: true,
  active: true,
  birthday: true,
  country_id: true,
  dependent_profile: { select: { frozen_at: true, purged_at: true } },
  account: { select: { id: true }, take: 1 },
  supervised_login: {
    select: {
      method: true,
      login_handle: true,
      origin: true,
      enabled_at: true,
      disabled_at: true,
      disabled_reason: true,
      password_set_by: true,
    },
  },
} satisfies Prisma.usersSelect;

function unprocessable(
  code: ErrorCode,
  namedArgs?: Record<string, unknown>,
): AppException {
  return new AppException(code, HttpStatus.UNPROCESSABLE_ENTITY, namedArgs);
}

function notFound(): AppException {
  return new AppException(
    ErrorCode.GUARDIANSHIP_NOT_FOUND,
    HttpStatus.NOT_FOUND,
  );
}

/** The registration password policy, answered as 422 so the whole action rolls back. */
export function assertPasswordPolicy(password: string): void {
  if (
    typeof password !== 'string' ||
    password.length < NEW_PASSWORD_MIN_LENGTH ||
    password.length > NEW_PASSWORD_MAX_LENGTH ||
    !NEW_PASSWORD_COMPLEXITY.test(password)
  ) {
    throw unprocessable(ErrorCode.SUPERVISED_LOGIN_PASSWORD_INVALID);
  }
}

/**
 * The guardian's CONTROL of a minor's own login (Phase 3a, FP3-11..14).
 *
 * Every method is flag-gated (404 FAMILY_FEATURE_DISABLED), runs as the guardian
 * themselves (no ActingScope: acting is refused by the guard), and needs a
 * VERIFIED guardianship (GuardianPowersPolicy). The password is hashed here and
 * never returned, logged or audited. One transaction per action, serialized per
 * dependent with the shared advisory lock; the acting-for epoch is bumped only
 * after the commit, so the very next request of the child (and of a guardian
 * acting for it) sees the new state.
 */
@Injectable()
export class SupervisedLoginsService {
  private readonly logger = new Logger(SupervisedLoginsService.name);
  private readonly events: SupervisedLoginEvents;

  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: FamilyFeatureFlagsService,
    private readonly powers: GuardianPowersPolicy,
    private readonly actingForCache: ActingForCache,
    private readonly countryAgePolicy: CountryAgePolicyService,
    private readonly betterAuth: BetterAuthService,
    private readonly tokenBlacklist: TokenBlacklistService,
    private readonly limiter: DependentActionLimiter,
    @Inject(LINKED_DEVICE_REVOKER)
    private readonly deviceRevoker: LinkedDeviceRevoker,
    // REQUIRED (no @Optional): an unbound token must fail at boot, not turn
    // every guardian security notice into a silent no-op (FP3-23).
    @Inject(SUPERVISED_LOGIN_EVENTS)
    events?: Partial<SupervisedLoginEvents>,
  ) {
    this.events = resolveSupervisedLoginEvents(events);
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Eligibility plus the login as the guardian sees it. A guardian whose link is
   * still PENDING gets `eligible: false / consent_not_verified` and nothing
   * else (no handle, no email): the powers start with the director's check.
   */
  async get(
    guardianId: string,
    dependentId: string,
  ): Promise<{
    eligible: boolean;
    ineligible_reason: IneligibleReason | null;
    supervised_login: SupervisedLoginView | null;
  }> {
    this.flags.assertEnabled('teen_login');
    try {
      await this.powers.assertVerifiedGuardian(guardianId, dependentId);
    } catch (error) {
      if (
        error instanceof AppException &&
        error.code === ErrorCode.GUARDIANSHIP_CONSENT_NOT_VERIFIED
      ) {
        return {
          eligible: false,
          ineligible_reason: 'consent_not_verified',
          supervised_login: null,
        };
      }
      throw error;
    }

    const dependent = await this.loadDependent(this.prisma, dependentId);
    const policy = await this.countryAgePolicy.getPolicy(dependent.country_id);
    const reason = this.ineligibleReason(dependent, policy);
    return {
      eligible: reason === null,
      ineligible_reason: reason,
      supervised_login: dependent.supervised_login
        ? this.toView(dependent.supervised_login, dependent.email)
        : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Enable
  // ---------------------------------------------------------------------------

  async enable(
    guardianId: string,
    dependentId: string,
    dto: EnableSupervisedLoginDto,
  ): Promise<{
    supervised_login: SupervisedLoginView;
    devices_revoked: number;
  }> {
    this.flags.assertEnabled('teen_login');
    await this.powers.assertVerifiedGuardian(guardianId, dependentId);
    assertPasswordPolicy(dto.password);

    // Hashing is slow: do it before taking the lock.
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const email = dto.method === 'email' ? (dto.email ?? '').trim() : null;

    let result: { view: SupervisedLoginView; devicesRevoked: number } | null =
      null;
    for (let attempt = 1; attempt <= HANDLE_ATTEMPTS; attempt += 1) {
      try {
        result = await this.prisma.$transaction((tx) =>
          this.enableInTransaction(tx, guardianId, dependentId, {
            method: dto.method,
            email,
            passwordHash,
          }),
        );
        break;
      } catch (error) {
        if (isUniqueViolation(error)) {
          if (dto.method === 'email') {
            throw new AppException(
              ErrorCode.SUPERVISED_LOGIN_EMAIL_UNAVAILABLE,
              HttpStatus.CONFLICT,
            );
          }
          // A concurrent enable took the handle (or the row): try a new handle.
          if (attempt < HANDLE_ATTEMPTS) continue;
        }
        throw error;
      }
    }
    if (!result) {
      throw new Error('could not enable the supervised login');
    }

    await this.actingForCache.bump(dependentId);
    void fireEvent(
      () =>
        this.events.onLoginEnabled({
          dependentUserId: dependentId,
          actorUserId: guardianId,
        }),
      (error) => this.warnEvent('enabled', error),
    );
    return {
      supervised_login: result.view,
      devices_revoked: result.devicesRevoked,
    };
  }

  private async enableInTransaction(
    tx: Prisma.TransactionClient,
    guardianId: string,
    dependentId: string,
    input: {
      method: 'email' | 'handle';
      email: string | null;
      passwordHash: string;
    },
  ): Promise<{ view: SupervisedLoginView; devicesRevoked: number }> {
    await lockDependent(tx, dependentId);
    // Re-check under the lock: the consent may have been revoked meanwhile.
    const guardian = await this.powers.assertVerifiedGuardian(
      guardianId,
      dependentId,
      { db: tx },
    );

    const dependent = await this.loadDependent(tx, dependentId);
    if (!dependent.active) throw notFound();
    if (dependent.account.length > 0 || dependent.supervised_login) {
      throw new AppException(
        ErrorCode.SUPERVISED_LOGIN_ALREADY_ENABLED,
        HttpStatus.CONFLICT,
      );
    }
    const policy = await this.countryAgePolicy.getPolicy(dependent.country_id);
    const reason = this.ineligibleReason(dependent, policy);
    if (reason !== null) {
      throw unprocessable(ErrorCode.SUPERVISED_LOGIN_NOT_ELIGIBLE, { reason });
    }

    let loginHandle: string | null = null;
    if (input.method === 'email') {
      const taken = await tx.users.findUnique({
        where: { email: input.email as string },
        select: { user_id: true },
      });
      if (taken && taken.user_id !== dependentId) {
        throw new AppException(
          ErrorCode.SUPERVISED_LOGIN_EMAIL_UNAVAILABLE,
          HttpStatus.CONFLICT,
        );
      }
    } else {
      loginHandle = await allocateLoginHandle(
        dependent.name,
        async (handle) => {
          const found = await tx.supervised_logins.findFirst({
            where: { login_handle: handle },
            select: { user_id: true },
          });
          return found !== null;
        },
      );
    }

    const now = new Date();
    if (input.method === 'email') {
      await tx.users.update({
        where: { user_id: dependentId },
        data: { email: input.email, email_verified: false },
      });
    }
    await tx.account.create({
      data: {
        id: randomUUID(),
        accountId: dependentId,
        providerId: 'credential',
        userId: dependentId,
        password: input.passwordHash,
      },
    });
    const created = await tx.supervised_logins.create({
      data: {
        user_id: dependentId,
        method: input.method,
        login_handle: loginHandle,
        origin: 'guardian_enabled',
        enabled_by_guardianship_id: guardian.guardianship_id,
        enabled_by_user_id: guardianId,
        enabled_at: now,
        password_set_by: 'guardian',
        pending_since: null,
      },
      select: {
        method: true,
        login_handle: true,
        origin: true,
        enabled_at: true,
        disabled_at: true,
        disabled_reason: true,
        password_set_by: true,
      },
    });

    // The child now acts alone: any paired device goes in the same transaction.
    const devicesRevoked = await this.deviceRevoker.revokeAllForDependent(
      tx,
      dependentId,
      'teen_login_enabled',
    );

    await this.recordAudit(tx, {
      action: 'enabled',
      dependentId,
      actorId: guardianId,
      at: now,
      changes: { method: input.method, devices_revoked: devicesRevoked },
    });

    return {
      view: this.toView(created, input.email),
      devicesRevoked,
    };
  }

  // ---------------------------------------------------------------------------
  // Disable / reactivate
  // ---------------------------------------------------------------------------

  async disable(
    guardianId: string,
    dependentId: string,
    dto: DisableSupervisedLoginDto,
  ): Promise<{ supervised_login: SupervisedLoginView }> {
    this.flags.assertEnabled('teen_login');
    await this.powers.assertVerifiedGuardian(guardianId, dependentId);

    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockDependent(tx, dependentId);
      await this.powers.assertVerifiedGuardian(guardianId, dependentId, {
        db: tx,
      });
      const { dependent, login } = await this.loadManagedLogin(tx, dependentId);

      // Already disabled: idempotent, nothing to cut again.
      if (login.disabled_at) {
        return {
          changed: false as const,
          view: this.toView(login, dependent.email),
        };
      }

      const now = new Date();
      const updated = await tx.supervised_logins.update({
        where: { user_id: dependentId },
        data: {
          disabled_at: now,
          disabled_by_user_id: guardianId,
          disabled_reason: 'guardian',
          modified_at: now,
        },
        select: LOGIN_VIEW_SELECT,
      });
      const sessions = await tx.session.deleteMany({
        where: { userId: dependentId },
      });
      await this.recordAudit(tx, {
        action: 'disabled',
        dependentId,
        actorId: guardianId,
        at: now,
        changes: {
          reason: dto.reason ?? null,
          sessions_revoked: sessions.count,
        },
      });
      return {
        changed: true as const,
        view: this.toView(updated, dependent.email),
      };
    });

    if (outcome.changed) {
      await this.cutAccess(dependentId);
      void fireEvent(
        () =>
          this.events.onLoginDisabled({
            dependentUserId: dependentId,
            actorUserId: guardianId,
          }),
        (error) => this.warnEvent('disabled', error),
      );
    }
    return { supervised_login: outcome.view };
  }

  async reactivate(
    guardianId: string,
    dependentId: string,
    dto: ReactivateSupervisedLoginDto,
  ): Promise<{ supervised_login: SupervisedLoginView }> {
    this.flags.assertEnabled('teen_login');
    await this.powers.assertVerifiedGuardian(guardianId, dependentId);

    // A handle login comes back with a NEW guardian-set password: the old hash
    // is replaced, never revived.
    const preview = await this.loadDependent(this.prisma, dependentId);
    const needsPassword = preview.supervised_login?.method === 'handle';
    let passwordHash: string | null = null;
    if (needsPassword) {
      if (dto.password === undefined) {
        throw unprocessable(ErrorCode.SUPERVISED_LOGIN_PASSWORD_INVALID);
      }
      assertPasswordPolicy(dto.password);
      passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    }

    const view = await this.prisma.$transaction(async (tx) => {
      await lockDependent(tx, dependentId);
      await this.powers.assertVerifiedGuardian(guardianId, dependentId, {
        db: tx,
      });
      const { dependent, login } = await this.loadManagedLogin(tx, dependentId);
      if (!login.disabled_at) {
        throw new AppException(
          ErrorCode.SUPERVISED_LOGIN_ALREADY_ENABLED,
          HttpStatus.CONFLICT,
        );
      }

      const now = new Date();
      if (login.method === 'handle') {
        if (!passwordHash) {
          throw unprocessable(ErrorCode.SUPERVISED_LOGIN_PASSWORD_INVALID);
        }
        await tx.account.updateMany({
          where: { userId: dependentId, providerId: 'credential' },
          data: { password: passwordHash },
        });
      }
      const updated = await tx.supervised_logins.update({
        where: { user_id: dependentId },
        data: {
          disabled_at: null,
          disabled_by_user_id: null,
          disabled_reason: null,
          ...(login.method === 'handle' ? { password_set_by: 'guardian' } : {}),
          modified_at: now,
        },
        select: LOGIN_VIEW_SELECT,
      });
      // Sessions are NOT restored: the child signs in again.
      await this.recordAudit(tx, {
        action: 'reactivated',
        dependentId,
        actorId: guardianId,
        at: now,
        changes: { method: login.method },
      });
      return this.toView(updated, dependent.email);
    });

    await this.actingForCache.bump(dependentId);
    void fireEvent(
      () =>
        this.events.onLoginReactivated({
          dependentUserId: dependentId,
          actorUserId: guardianId,
        }),
      (error) => this.warnEvent('reactivated', error),
    );
    return { supervised_login: view };
  }

  // ---------------------------------------------------------------------------
  // Reset password
  // ---------------------------------------------------------------------------

  /**
   * Handle login: the guardian sets a NEW password. Email login: the sessions
   * are cut and the STANDARD reset email goes to the child (the guardian never
   * learns or sets that password). Either way every session dies and the next
   * request with an old token is a 401. 5 per hour per dependent.
   */
  async resetPassword(
    guardianId: string,
    dependentId: string,
    dto: SetSupervisedPasswordDto,
  ): Promise<{
    sessions_revoked: number;
    method: 'handle' | 'email';
    email_sent: boolean;
  }> {
    this.flags.assertEnabled('teen_login');
    await this.powers.assertVerifiedGuardian(guardianId, dependentId);
    // 429 with the generic "try again later" message and a Retry-After header.
    await this.limiter.consume(
      `supervised-reset:${dependentId}`,
      5,
      HOUR_MS,
      ErrorCode.AUTH_LOGIN_LOCKED,
    );

    const preview = await this.loadDependent(this.prisma, dependentId);
    if (!preview.supervised_login && preview.account.length === 0) {
      throw new AppException(
        ErrorCode.SUPERVISED_LOGIN_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    const method =
      (preview.supervised_login?.method as 'handle' | 'email' | undefined) ??
      'email';

    let passwordHash: string | null = null;
    if (method === 'handle') {
      if (dto.password === undefined) {
        throw unprocessable(ErrorCode.SUPERVISED_LOGIN_PASSWORD_INVALID);
      }
      assertPasswordPolicy(dto.password);
      passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockDependent(tx, dependentId);
      await this.powers.assertVerifiedGuardian(guardianId, dependentId, {
        db: tx,
      });
      const { dependent, login } = await this.loadManagedLogin(tx, dependentId);

      const now = new Date();
      if (login.method === 'handle') {
        await tx.account.updateMany({
          where: { userId: dependentId, providerId: 'credential' },
          data: { password: passwordHash as string },
        });
        await tx.supervised_logins.update({
          where: { user_id: dependentId },
          data: { password_set_by: 'guardian', modified_at: now },
        });
      }
      const sessions = await tx.session.deleteMany({
        where: { userId: dependentId },
      });
      await this.recordAudit(tx, {
        action: 'password_reset',
        dependentId,
        actorId: guardianId,
        at: now,
        changes: { method: login.method, sessions_revoked: sessions.count },
      });
      return {
        sessions: sessions.count,
        email: dependent.email,
        method: login.method,
      };
    });

    await this.cutAccess(dependentId);

    let emailSent = false;
    if (outcome.method === 'email') {
      if (!outcome.email) {
        throw unprocessable(ErrorCode.SUPERVISED_LOGIN_NOT_ELIGIBLE, {
          reason: 'email_missing',
        });
      }
      // The standard reset flow: the child picks the new password from the link.
      await this.betterAuth.resetPasswordForEmail(
        outcome.email,
        process.env.FRONTEND_URL
          ? `${process.env.FRONTEND_URL}/reset-password`
          : undefined,
      );
      emailSent = true;
    }

    void fireEvent(
      () =>
        this.events.onPasswordReset({
          dependentUserId: dependentId,
          actorUserId: guardianId,
        }),
      (error) => this.warnEvent('password_reset', error),
    );
    return {
      sessions_revoked: outcome.sessions,
      method: outcome.method as 'handle' | 'email',
      email_sent: emailSent,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * After a cut (disable, reset): drop every access token the child still holds
   * and move the epoch. Both are best effort AFTER the commit: the sessions are
   * already gone, which is what the strategy's per-request session check reads.
   */
  private async cutAccess(dependentId: string): Promise<void> {
    try {
      await this.tokenBlacklist.blacklistAllUserTokens(
        dependentId,
        JWT_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'supervised_blacklist_failed',
          dependent: dependentId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    await this.actingForCache.bump(dependentId);
  }

  private async loadDependent(
    db: Prisma.TransactionClient | PrismaService,
    dependentId: string,
  ): Promise<DependentRow> {
    const dependent = await db.users.findUnique({
      where: { user_id: dependentId },
      select: DEPENDENT_SELECT,
    });
    if (!dependent) throw notFound();
    return dependent as DependentRow;
  }

  /**
   * The dependent and its login, for disable / reactivate / reset. A teen who
   * has an account but no supervised row (verified before this phase) gets one
   * created on demand. A minor only: a person of age is not managed any more.
   */
  private async loadManagedLogin(
    tx: Prisma.TransactionClient,
    dependentId: string,
  ): Promise<{ dependent: DependentRow; login: LoginRow }> {
    const dependent = await this.loadDependent(tx, dependentId);
    if (!dependent.active) throw notFound();

    const policy = await this.countryAgePolicy.getPolicy(dependent.country_id);
    if (
      !dependent.birthday ||
      ageToday(dependent.birthday, policy.timeZone) >= policy.ageOfMajority
    ) {
      // Past majority the guardian has no say: indistinguishable from a stranger.
      throw notFound();
    }

    let login = dependent.supervised_login;
    if (!login) {
      if (dependent.account.length === 0) {
        throw new AppException(
          ErrorCode.SUPERVISED_LOGIN_NOT_FOUND,
          HttpStatus.NOT_FOUND,
        );
      }
      login = await tx.supervised_logins.create({
        data: {
          user_id: dependentId,
          method: 'email',
          origin: 'self_registered',
          password_set_by: 'self',
          pending_since: null,
        },
        select: LOGIN_VIEW_SELECT,
      });
    }
    return { dependent, login };
  }

  private ineligibleReason(
    dependent: DependentRow,
    policy: {
      minSelfLoginAge: number;
      ageOfMajority: number;
      timeZone: string;
    },
  ): IneligibleReason | null {
    if (!dependent.active) return 'inactive';
    if (dependent.supervised_login) return 'already_enabled';
    if (dependent.account.length > 0) return 'has_account';
    if (!dependent.birthday) return 'birthday_missing';
    const age = ageToday(dependent.birthday, policy.timeZone);
    if (age < policy.minSelfLoginAge) return 'age_below_min';
    if (age >= policy.ageOfMajority) return 'age_over_majority';
    return null;
  }

  private toView(login: LoginRow, email: string | null): SupervisedLoginView {
    return {
      method: login.method as 'email' | 'handle',
      login_handle: login.login_handle,
      email: login.method === 'email' ? email : null,
      origin: login.origin as 'self_registered' | 'guardian_enabled',
      enabled_at: login.enabled_at ? login.enabled_at.toISOString() : null,
      disabled_at: login.disabled_at ? login.disabled_at.toISOString() : null,
      disabled_reason: login.disabled_reason,
      password_set_by: login.password_set_by as 'guardian' | 'self',
    };
  }

  /**
   * Written with the SAME transaction client so the change and its audit row
   * commit or roll back together. The password, the handle and the email are
   * never part of it.
   */
  private async recordAudit(
    tx: Prisma.TransactionClient,
    input: {
      action: 'enabled' | 'disabled' | 'reactivated' | 'password_reset';
      dependentId: string;
      actorId: string;
      at: Date;
      changes: Record<string, unknown>;
    },
  ): Promise<void> {
    markExplicitAuditRecorded();
    await tx.audit_logs.create({
      data: {
        entity_type: 'supervised_login',
        entity_id: input.dependentId,
        action: input.action,
        actor_user_id: input.actorId,
        actor_kind: 'user',
        target_user_id: input.dependentId,
        summary: `Acceso propio del menor: ${input.action}`,
        changes: input.changes as Prisma.InputJsonValue,
        result: 'succeeded',
        source: 'service',
        correlation_id: getAuditCorrelationId() ?? null,
        effective_at: input.at,
      },
    });
  }

  private warnEvent(event: string, error: unknown): void {
    this.logger.warn(
      `supervised login notice (${event}) failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

const LOGIN_VIEW_SELECT = {
  method: true,
  login_handle: true,
  origin: true,
  enabled_at: true,
  disabled_at: true,
  disabled_reason: true,
  password_set_by: true,
} satisfies Prisma.supervised_loginsSelect;

import { Injectable, Logger } from '@nestjs/common';
import {
  AppException,
  AppServiceUnavailableException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { ageToday } from '../../common/age/age.util';
import { CountryAgePolicyService } from '../../common/age/country-age-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FamilyFeatureFlagsService } from '../../guardianships/family-feature-flags.service';
import {
  SUPERVISED_STATE_MEMO,
  TEEN_PENDING_SCOPES,
  TEEN_SCOPES,
  type ActingForScope,
  type SupervisionStatus,
} from '../acting-for/auth-principal';
import {
  SupervisedPrincipalCache,
  type SupervisedLoginMethod,
  type SupervisedState,
} from './supervised-principal.cache';

interface ResolvedFromDatabase {
  state: SupervisedState;
  /** Country reference zone, used to cap the cache TTL at local midnight. */
  timeZone: string | null;
}

interface SupervisedStateMemo {
  userId: string;
  state: SupervisedState;
}

function loginMethodOf(login: { method: string } | null): {
  login_method?: SupervisedLoginMethod;
} {
  if (login?.method === 'handle' || login?.method === 'email') {
    return { login_method: login.method };
  }
  return {};
}

/** Scope set a supervised principal carries for each supervision status. */
export function scopesForSupervision(
  supervision: SupervisionStatus,
): readonly ActingForScope[] {
  return supervision === 'active' ? TEEN_SCOPES : TEEN_PENDING_SCOPES;
}

const ADULT: SupervisedState = { state: 'adult' };
const TEEN_LOGIN_DISABLED: SupervisedState = {
  state: 'blocked',
  cause: 'teen_login_disabled',
};
const PROFILE_INCOMPLETE: SupervisedState = { state: 'profile_incomplete' };

interface UnknownAgeFacts {
  access_panel: boolean | null;
  users_pr: { complete: boolean } | null;
  users_roles: Array<{ user_role_id: string }>;
}

/**
 * A NULL birthday is only an adult when the account is NOT a self-service
 * sign-up still in onboarding. Restricted when ALL of these hold:
 *  - a post-registration row exists and is not complete (email register and
 *    social sign-in create it; admin-created and seeded legacy accounts have
 *    none, or a completed one);
 *  - the account has no panel access and no staff global role (an admin who
 *    later signs in with Google gets a fresh, incomplete row from the social
 *    provisioning and must not lose the panel).
 */
function isOnboardingWithUnknownAge(user: UnknownAgeFacts): boolean {
  return (
    user.users_pr !== null &&
    user.users_pr.complete !== true &&
    user.access_panel !== true &&
    user.users_roles.length === 0
  );
}

/**
 * Decides, from SERVER state only, whether a user is an adult or a supervised
 * minor. It is the single place where the `supervised_user` principal kind is
 * derived: a token claim can never grant it, so password login, social
 * sign-in, refresh and MFA completion all behave the same.
 *
 *  - adult:       age >= majority of the country policy, or NO birthday on file
 *                 for an admin-created, staff or legacy account (no
 *                 post-registration row, a completed one, panel access or a
 *                 staff global role).
 *  - profile_incomplete: NO birthday on a self-service account whose
 *                 post-registration is still open (a Google/Apple sign-up
 *                 before step 2). The age is unknown, so it gets a minimal
 *                 scope set until step 2 saves the birthday. An adult birthday
 *                 makes it a full adult right away (the app forces the rest of
 *                 the post-registration anyway); a minor one, a teen.
 *  - blocked:     a minor whose dependent profile is frozen/purged, or whose
 *                 supervised login was disabled.
 *  - supervised:  any other minor. `active` when a VERIFIED, non-test,
 *                 non-revoked, NON-custodian guardianship exists, otherwise
 *                 `pending_guardian` (custody and unverified links do not count).
 *
 * Rollback flag (FP3-35): while FAMILY_TEEN_LOGIN_ENABLED is off, an account
 * whose supervised login method is `handle` resolves as
 * blocked:`teen_login_disabled`, so its open sessions get 401 on the next
 * request and refresh is refused. Email teens are not touched. The method is
 * part of the cached state (same users lookup, no extra query); the flag is
 * applied on top of it on EVERY call, so a flip needs no epoch bump and is
 * undone the same way (sessions are cut lazily, never deleted).
 *
 * Failure policy (same as the acting-for resolver): a Redis error falls back to
 * the database; a database error is a 503 AUTH_REVOCATION_CHECK_UNAVAILABLE.
 * It never fails open.
 */
@Injectable()
export class SupervisedPrincipalResolver {
  private readonly logger = new Logger(SupervisedPrincipalResolver.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: SupervisedPrincipalCache,
    private readonly countryAgePolicy: CountryAgePolicyService,
    private readonly familyFlags: FamilyFeatureFlagsService,
  ) {}

  /**
   * Memoized per request: a local `@UseGuards(JwtAuthGuard)` re-runs
   * `JwtStrategy.validate` on the same request and must not repeat the lookup.
   */
  async resolveForRequest(
    req: object,
    userId: string,
  ): Promise<SupervisedState> {
    const holder = req as { [SUPERVISED_STATE_MEMO]?: SupervisedStateMemo };
    const memo = holder[SUPERVISED_STATE_MEMO];
    if (memo && memo.userId === userId) {
      return memo.state;
    }
    const state = await this.resolve(userId);
    holder[SUPERVISED_STATE_MEMO] = { userId, state };
    return state;
  }

  async resolve(userId: string): Promise<SupervisedState> {
    return this.applyTeenLoginFlag(await this.resolveCached(userId));
  }

  /**
   * FP3-35: the flag only governs HANDLE logins (the handle exists because of
   * the feature). An adult who still logs in with a handle is cut too: the
   * handle login is the uniform 401 while the flag is off, so leaving the
   * session open would be the only way in. Read per call (never memoized here).
   */
  private applyTeenLoginFlag(state: SupervisedState): SupervisedState {
    if (
      (state.state === 'supervised' || state.state === 'adult') &&
      state.login_method === 'handle' &&
      !this.familyFlags.isEnabled('teen_login')
    ) {
      return TEEN_LOGIN_DISABLED;
    }
    return state;
  }

  private async resolveCached(userId: string): Promise<SupervisedState> {
    let epoch: number | null;
    try {
      epoch = await this.cache.getEpoch(userId);
      if (epoch === null) {
        // No epoch stored: a cache miss. Mint one BEFORE the database read and
        // read no payload under it (a mutation in between bumps past it).
        epoch = await this.cache.initEpoch(userId);
      } else {
        const cached = await this.cache.getState(userId, epoch);
        if (cached) {
          return cached;
        }
      }
    } catch (error) {
      epoch = null;
      this.logCacheUnavailable(error);
    }

    const { state, timeZone } = await this.loadFromDatabase(userId);

    if (epoch !== null) {
      try {
        await this.cache.setState(userId, epoch, state, timeZone);
      } catch (error) {
        this.logCacheUnavailable(error);
      }
    }
    return state;
  }

  /**
   * True when the token's session still exists. A token minted without `sid`
   * (the MFA verify endpoint) falls back to "the user has at least one live
   * session": disable and reset delete ALL the user's sessions, so the proxy is
   * sound. Cached under the same epoch, so a disable/reset/password change
   * (which bump it) is seen on the very next request.
   */
  async isSessionActive(userId: string, sid: string | null): Promise<boolean> {
    const cacheKeySid = sid ?? '*';
    let epoch: number | null;
    try {
      epoch = await this.cache.getEpoch(userId);
      if (epoch === null) {
        epoch = await this.cache.initEpoch(userId);
      } else {
        const cached = await this.cache.getSession(userId, epoch, cacheKeySid);
        if (cached !== null) {
          return cached;
        }
      }
    } catch (error) {
      epoch = null;
      this.logCacheUnavailable(error);
    }

    let active: boolean;
    try {
      const session = await this.prisma.session.findFirst({
        where: {
          userId,
          expiresAt: { gt: new Date() },
          ...(sid ? { id: sid } : {}),
        },
        select: { id: true },
      });
      active = session !== null;
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'supervised_session_lookup_failed',
          sub: userId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      throw new AppServiceUnavailableException(
        ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
      );
    }

    if (epoch !== null) {
      try {
        await this.cache.setSession(userId, epoch, cacheKeySid, active);
      } catch (error) {
        this.logCacheUnavailable(error);
      }
    }
    return active;
  }

  private async loadFromDatabase(
    userId: string,
  ): Promise<ResolvedFromDatabase> {
    try {
      const user = await this.prisma.users.findUnique({
        where: { user_id: userId },
        select: {
          birthday: true,
          country_id: true,
          supervised_login: { select: { disabled_at: true, method: true } },
          dependent_profile: {
            select: { frozen_at: true, purged_at: true },
          },
          guardianships_as_dependent: {
            where: {
              consent_status: 'verified',
              is_test_data: false,
              is_custodian: false,
              revoked_at: null,
            },
            select: { guardianship_id: true },
            take: 1,
          },
          // Only consulted for a NULL birthday (unknown age).
          access_panel: true,
          users_pr: { select: { complete: true } },
          users_roles: {
            where: {
              active: true,
              roles: {
                active: true,
                role_category: 'GLOBAL',
                role_name: { not: 'user' },
              },
            },
            select: { user_role_id: true },
            take: 1,
          },
        },
      });

      if (!user) {
        return { state: ADULT, timeZone: null };
      }
      if (!user.birthday) {
        return {
          state: isOnboardingWithUnknownAge(user) ? PROFILE_INCOMPLETE : ADULT,
          timeZone: null,
        };
      }

      const loginMethod = loginMethodOf(user.supervised_login);
      const policy = await this.countryAgePolicy.getPolicy(user.country_id);
      if (ageToday(user.birthday, policy.timeZone) >= policy.ageOfMajority) {
        return {
          state: { ...ADULT, ...loginMethod },
          timeZone: policy.timeZone,
        };
      }

      const profile = user.dependent_profile;
      if (profile && (profile.frozen_at || profile.purged_at)) {
        return {
          state: { state: 'blocked', cause: 'frozen' },
          timeZone: policy.timeZone,
        };
      }
      if (user.supervised_login?.disabled_at) {
        return {
          state: { state: 'blocked', cause: 'login_disabled' },
          timeZone: policy.timeZone,
        };
      }

      const supervision: SupervisionStatus =
        user.guardianships_as_dependent.length > 0
          ? 'active'
          : 'pending_guardian';
      return {
        state: { state: 'supervised', supervision, ...loginMethod },
        timeZone: policy.timeZone,
      };
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      this.logger.error(
        JSON.stringify({
          event: 'supervised_principal_lookup_failed',
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      throw new AppServiceUnavailableException(
        ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
      );
    }
  }

  private logCacheUnavailable(error: unknown): void {
    this.logger.warn(
      JSON.stringify({
        event: 'supervised_principal_cache_unavailable',
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

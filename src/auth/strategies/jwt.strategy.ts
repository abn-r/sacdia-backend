import { Injectable, Logger } from '@nestjs/common';
import {
  AppException,
  AppServiceUnavailableException,
  AppUnauthorizedException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { TokenBlacklistService } from '../../common/services/token-blacklist.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  resolveAuthBlacklistDegradedMode,
  type AuthBlacklistDegradedMode,
} from '../../config/redis-degraded.config';
import {
  ACCESS_JWT_AUDIENCE,
  ACCESS_JWT_ISSUER,
  DEVICE_AUDIENCE,
  QR_MEMBER_AUDIENCE,
  isAccessJwtClaims,
  jwtAudienceIncludes,
} from '../../common/constants/jwt-audiences';
import { setAuditActingFor } from '../../audit-logs/audit-request-context';
import {
  actingForForbidden,
  actingForHeaderInvalid,
  supervisedAccessRevoked,
} from '../acting-for/acting-for.errors';
import type { ActingGrant } from '../acting-for/acting-for.cache';
import { ActingForResolver } from '../acting-for/acting-for.resolver';
import {
  scopesForSupervision,
  SupervisedPrincipalResolver,
} from '../supervised/supervised-principal.resolver';
import {
  ACTING_GRANT_MEMO,
  AGE_UNKNOWN_SCOPES,
  type AuthPrincipal,
  type SupervisionStatus,
} from '../acting-for/auth-principal';

/** Header a guardian sends to act for one of their dependents. */
export const ACTING_FOR_HEADER = 'x-acting-for';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ActingGrantMemo {
  guardianId: string;
  dependentId: string;
  grant: ActingGrant;
}

export interface JwtPayload {
  sub: string; // user_id
  /** Null when the subject has no email (dependent profiles). */
  email: string | null;
  /**
   * Access JWTs require iss=https://api.sacdia.app and aud=sacdia:access.
   * QR member tokens set aud=sacdia:qr-member and must not authenticate API routes.
   */
  iss?: string;
  aud?: string | string[];
  /**
   * Present and `true` when the user has TOTP enrolled but has not yet completed
   * the second factor after password login. Endpoints that require full auth
   * (aal2) should be blocked until this is cleared by POST /auth/mfa/verify.
   */
  mfa_pending?: boolean;
  /**
   * BA session DB row `id` (UUID). Embedded since 2026-04 to enable `is_current`
   * comparison in GET /auth/sessions without an extra DB round-trip.
   * Absent in tokens issued before this change or via MFA verify endpoint.
   */
  sid?: string;
  iat?: number;
  exp?: number;
}

/** At most one degraded-mode warning per window; the breaker logs the outage. */
const DEGRADED_LOG_INTERVAL_MS = 30_000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private readonly degradedMode: AuthBlacklistDegradedMode;
  private lastDegradedLogAt = 0;

  constructor(
    configService: ConfigService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    private readonly prisma: PrismaService,
    private readonly actingForResolver: ActingForResolver,
    private readonly supervisedResolver: SupervisedPrincipalResolver,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      passReqToCallback: true,
      secretOrKey: configService.getOrThrow<string>('BETTER_AUTH_SECRET'),
      algorithms: ['HS256'],
      issuer: ACCESS_JWT_ISSUER,
      audience: ACCESS_JWT_AUDIENCE,
    });

    this.degradedMode = resolveAuthBlacklistDegradedMode(
      configService.get('AUTH_BLACKLIST_DEGRADED_MODE'),
    );
    this.logger.log(
      `JWT verification via HS256 (BETTER_AUTH_SECRET); revocation-check degraded mode: ${this.degradedMode}`,
    );
  }

  async validate(req: Request, payload: JwtPayload): Promise<AuthPrincipal> {
    if (jwtAudienceIncludes(payload.aud, DEVICE_AUDIENCE)) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_jwt_device_audience_rejected',
          sub: payload.sub,
        }),
      );
      throw new AppUnauthorizedException(ErrorCode.GUARD_JWT_UNAUTHORIZED);
    }

    if (jwtAudienceIncludes(payload.aud, QR_MEMBER_AUDIENCE)) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_jwt_qr_audience_rejected',
          sub: payload.sub,
        }),
      );
      throw new AppUnauthorizedException(ErrorCode.GUARD_JWT_UNAUTHORIZED);
    }

    if (!isAccessJwtClaims(payload)) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_jwt_access_claims_rejected',
          sub: payload.sub,
        }),
      );
      throw new AppUnauthorizedException(ErrorCode.GUARD_JWT_UNAUTHORIZED);
    }

    const token = this.extractToken(req);

    let revocationCheckUnavailable = false;

    if (token) {
      const tokenStatus = await this.tokenBlacklistService.checkToken(token);
      if (tokenStatus === 'revoked') {
        this.logger.warn(
          JSON.stringify({
            event: 'auth_jwt_revoked_token',
            sub: payload.sub,
          }),
        );
        throw new AppUnauthorizedException(ErrorCode.GUARD_JWT_UNAUTHORIZED);
      }
      revocationCheckUnavailable = tokenStatus === 'unavailable';
    }

    // Skip the second lookup when the cache is already known to be down.
    if (!revocationCheckUnavailable && payload.sub && payload.iat) {
      const userStatus = await this.tokenBlacklistService.checkUserTokens(
        payload.sub,
        payload.iat,
      );
      if (userStatus === 'revoked') {
        this.logger.warn(
          JSON.stringify({
            event: 'auth_jwt_user_blacklisted',
            sub: payload.sub,
          }),
        );
        throw await this.userBlacklistedError(req, payload.sub);
      }
      revocationCheckUnavailable = userStatus === 'unavailable';
    }

    if (revocationCheckUnavailable) {
      await this.applyDegradedMode(payload);
    }

    const basePrincipal: AuthPrincipal = {
      sub: payload.sub,
      userId: payload.sub,
      user_id: payload.sub,
      email: payload.email ?? null,
      mfa_pending: payload.mfa_pending ?? false,
      sid: payload.sid ?? null,
      kind: 'user',
      actor_sub: payload.sub,
      acting_for: false,
      scopes: null,
    };

    // The principal kind is derived from SERVER state, never from a token
    // claim: a forged `kind` is simply ignored. Runs before X-Acting-For.
    const supervised = await this.supervisedResolver.resolveForRequest(
      req,
      payload.sub,
    );
    if (supervised.state === 'blocked') {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_jwt_supervised_blocked',
          sub: payload.sub,
          cause: supervised.cause,
        }),
      );
      throw supervisedAccessRevoked();
    }
    if (supervised.state === 'supervised') {
      return this.buildSupervisedPrincipal(
        req,
        payload,
        basePrincipal,
        supervised.supervision,
      );
    }

    if (supervised.state === 'profile_incomplete') {
      return this.buildAgeUnknownPrincipal(req, payload, basePrincipal);
    }

    const dependentId = this.readActingForHeader(req);
    if (dependentId === null) {
      return basePrincipal;
    }

    return this.buildActingPrincipal(req, payload, basePrincipal, dependentId);
  }

  /**
   * The 401 for a token caught by the user-level blacklist. The request is
   * rejected no matter what; only the REASON differs. A guardian disable (and a
   * reset) blacklists every token of the minor, and that check runs before the
   * supervised one, so without this the old teen token got the generic
   * GUARD_JWT_UNAUTHORIZED instead of AUTH_SUPERVISED_ACCESS_REVOKED, the code
   * the app uses to explain the cut. Adults keep the generic code, and a failed
   * state lookup falls back to it (never a 503, never a pass).
   */
  private async userBlacklistedError(
    req: Request,
    userId: string,
  ): Promise<AppException> {
    try {
      const state = await this.supervisedResolver.resolveForRequest(
        req,
        userId,
      );
      if (state.state === 'blocked' || state.state === 'supervised') {
        return supervisedAccessRevoked();
      }
    } catch {
      // Fall through to the generic code: the token is rejected regardless.
    }
    return new AppUnauthorizedException(ErrorCode.GUARD_JWT_UNAUTHORIZED);
  }

  /**
   * A supervised teen (account holder under the age of majority). Never a
   * guardian, so `X-Acting-For` is refused (uniform 403, before any grant
   * lookup). The token's session must still exist: disable, reset and password
   * change delete the sessions and bump the epoch, so the very next request is
   * a 401 even inside the 8h JWT.
   */
  private async buildSupervisedPrincipal(
    req: Request,
    payload: JwtPayload,
    basePrincipal: AuthPrincipal,
    supervision: SupervisionStatus,
  ): Promise<AuthPrincipal> {
    if (req.headers?.[ACTING_FOR_HEADER] !== undefined) {
      this.logActingDenied(payload.sub, payload.sub, 'supervised_token');
      throw actingForForbidden();
    }

    const sessionActive = await this.supervisedResolver.isSessionActive(
      payload.sub,
      payload.sid ?? null,
    );
    if (!sessionActive) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_jwt_supervised_session_missing',
          sub: payload.sub,
        }),
      );
      throw supervisedAccessRevoked();
    }

    setAuditActingFor({
      actorUserId: payload.sub,
      subjectUserId: payload.sub,
      kind: 'supervised_user',
    });

    return {
      ...basePrincipal,
      kind: 'supervised_user',
      scopes: scopesForSupervision(supervision),
      supervision,
    };
  }

  /**
   * NULL birthday while the self-service post-registration is open (a social
   * sign-up before step 2): the age is unknown, so the account only gets the
   * onboarding surface. It is the user's OWN account (no substitution, no
   * acting audit). It can never act for a dependent: an unknown age is not a
   * guardian, so `X-Acting-For` is the uniform 403 before any grant lookup.
   */
  private buildAgeUnknownPrincipal(
    req: Request,
    payload: JwtPayload,
    basePrincipal: AuthPrincipal,
  ): AuthPrincipal {
    if (req.headers?.[ACTING_FOR_HEADER] !== undefined) {
      this.logActingDenied(payload.sub, payload.sub, 'age_unknown_token');
      throw actingForForbidden();
    }
    return {
      ...basePrincipal,
      kind: 'age_unknown_user',
      scopes: AGE_UNKNOWN_SCOPES,
    };
  }

  /**
   * Reads `X-Acting-For`. Absent => null (behavior unchanged). Repeated or
   * non-UUID values => 400, so a malformed header never silently means "me".
   */
  private readActingForHeader(req: Request): string | null {
    const raw = req.headers?.[ACTING_FOR_HEADER];
    if (raw === undefined) {
      return null;
    }
    if (typeof raw !== 'string' || !UUID_PATTERN.test(raw)) {
      throw actingForHeaderInvalid();
    }
    return raw.toLowerCase();
  }

  /**
   * Substitutes the principal: `sub`/`userId` become the dependent, `actor_sub`
   * stays the guardian. Every refusal is the SAME 403 (nothing to enumerate);
   * the real cause only goes to the `acting_for_denied` log.
   */
  private async buildActingPrincipal(
    req: Request,
    payload: JwtPayload,
    basePrincipal: AuthPrincipal,
    dependentId: string,
  ): Promise<AuthPrincipal> {
    // An aal1 (password-only) token must not act for anyone, and acting for
    // yourself is meaningless: both are refused before touching the database.
    if (payload.mfa_pending) {
      this.logActingDenied(payload.sub, dependentId, 'mfa_pending');
      throw actingForForbidden();
    }
    if (dependentId === payload.sub.toLowerCase()) {
      this.logActingDenied(payload.sub, dependentId, 'header_equals_sub');
      throw actingForForbidden();
    }

    // A local @UseGuards(JwtAuthGuard) re-runs validate() on the same request:
    // reuse the first lookup instead of repeating it.
    const memoHolder = req as Request & {
      [ACTING_GRANT_MEMO]?: ActingGrantMemo;
    };
    const memo = memoHolder[ACTING_GRANT_MEMO];
    let grant: ActingGrant | undefined;
    if (
      memo &&
      memo.guardianId === payload.sub &&
      memo.dependentId === dependentId
    ) {
      grant = memo.grant;
    } else {
      const resolution = await this.actingForResolver.resolve(
        payload.sub,
        dependentId,
      );
      if (!resolution.granted) {
        this.logActingDenied(payload.sub, dependentId, resolution.cause);
        throw actingForForbidden();
      }
      grant = resolution.grant;
      memoHolder[ACTING_GRANT_MEMO] = {
        guardianId: payload.sub,
        dependentId,
        grant,
      };
    }

    setAuditActingFor({
      actorUserId: payload.sub,
      subjectUserId: dependentId,
      guardianshipId: grant.guardianshipId,
      kind: 'guardian_acting',
    });

    return {
      ...basePrincipal,
      sub: dependentId,
      userId: dependentId,
      user_id: dependentId,
      email: null,
      mfa_pending: false,
      kind: 'guardian_acting',
      actor_sub: payload.sub,
      acting_for: true,
      scopes: grant.scopes,
      guardianship_id: grant.guardianshipId,
      consent_status: grant.consentStatus,
    };
  }

  private logActingDenied(
    guardianId: string,
    dependentId: string,
    cause: string,
  ): void {
    this.logger.warn(
      JSON.stringify({
        event: 'acting_for_denied',
        guardian: guardianId,
        dependent: dependentId,
        cause,
      }),
    );
  }

  /**
   * The revocation cache (Redis) could not be consulted. Apply the configured
   * AUTH_BLACKLIST_DEGRADED_MODE:
   * - db-session: verify the Better Auth session row named by `sid` (every
   *   server-side revocation path deletes it). No `sid` => behave like reject.
   * - reject: fail closed with 503.
   * - allow: accept the token (availability over revocation) and warn.
   */
  private async applyDegradedMode(payload: JwtPayload): Promise<void> {
    this.logDegraded(payload);

    if (this.degradedMode === 'allow') return;

    if (this.degradedMode === 'db-session' && payload.sid) {
      await this.assertSessionActive(payload.sid, payload.sub);
      return;
    }

    throw new AppServiceUnavailableException(
      ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
    );
  }

  private async assertSessionActive(
    sessionId: string,
    userId: string,
  ): Promise<void> {
    let session: { id: string } | null;
    try {
      session = await this.prisma.session.findFirst({
        where: { id: sessionId, userId, expiresAt: { gt: new Date() } },
        select: { id: true },
      });
    } catch (error) {
      // Neither Redis nor the database can vouch for the token.
      this.logger.error(
        JSON.stringify({
          event: 'auth_jwt_session_lookup_failed',
          sub: userId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      throw new AppServiceUnavailableException(
        ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
      );
    }

    if (!session) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_jwt_session_missing_degraded',
          sub: userId,
        }),
      );
      throw new AppUnauthorizedException(ErrorCode.GUARD_JWT_UNAUTHORIZED);
    }
  }

  private logDegraded(payload: JwtPayload): void {
    const now = Date.now();
    if (now - this.lastDegradedLogAt < DEGRADED_LOG_INTERVAL_MS) return;
    this.lastDegradedLogAt = now;
    this.logger.warn(
      JSON.stringify({
        event: 'auth_jwt_revocation_check_unavailable',
        mode: this.degradedMode,
        hasSid: Boolean(payload.sid),
      }),
    );
  }

  private extractToken(req: Request): string | null {
    const authHeader = req.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    return authHeader.slice('Bearer '.length).trim();
  }
}

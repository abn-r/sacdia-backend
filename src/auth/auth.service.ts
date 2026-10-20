import {
  HttpStatus,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  BetterAuthService,
  type SessionRequestContext,
} from '../better-auth/better-auth.service';
import { isPresentedAccessJwtForUser } from './presented-access-jwt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto, loginIdentifierOf } from './dto/login.dto';
import { LoginFailureCounter } from './login-failure-counter';
import { SupervisedPrincipalResolver } from './supervised/supervised-principal.resolver';
import {
  fireEvent,
  resolveSupervisedLoginEvents,
  SUPERVISED_LOGIN_EVENTS,
  type SupervisedLoginEvents,
} from './supervised/supervised-login-events.port';
import { ResetPasswordRequestDto } from './dto/reset-password-request.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshSessionDto } from './dto/refresh-session.dto';
import { SetActiveClubContextDto } from './dto/set-active-club-context.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { buildAuthTokenResponse } from './utils/auth-token-response.util';
import { maskEmail } from '../common/utils/mask-email.util';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { EcclesiasticalYearService } from '../common/services/ecclesiastical-year.service';
import { ClubCycleReadinessService } from '../common/services/club-cycle-readiness.service';
import { TokenBlacklistService } from '../common/services/token-blacklist.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import { EmailService } from '../common/email/email.service';
import {
  AppBadRequestException,
  AppException,
  AppNotFoundException,
  AppUnauthorizedException,
  AppUnprocessableEntityException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { LegalService } from '../legal/legal.service';
import {
  ageToday,
  parseCalendarDate,
  toDateValue,
} from '../common/age/age.util';
import { CountryAgePolicyService } from '../common/age/country-age-policy.service';
import type { AuthPrincipal } from './acting-for/auth-principal';
import { FamilyFeatureFlagsService } from '../guardianships/family-feature-flags.service';
import { SupervisionStateService } from '../guardianships/supervision-state.service';

const LEGACY_SNAKE_CASE_REMOVED_AT = '2026-03-01';
const LEGACY_SNAKE_CASE_REMOVED_CODE = 'LEGACY_SNAKE_CASE_REMOVED';

const NON_EMAIL_VERIFICATION_PREFIXES = [
  'password-reset:',
  'totp:',
  'mfa-session:',
] as const;

type RefreshSessionContext = {
  userAgent?: string;
  /** Current access JWT from `Authorization: Bearer`. Optional. */
  accessToken?: string;
};

export type LogoutRequest = {
  accessToken?: string;
  refreshToken?: string;
  userAgent?: string;
};

type LogoutPath = 'session' | 'access_only' | 'none';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private static readonly PRIVATE_ASSET_URL_TTL_SECONDS = 300;

  // JWT access tokens are 8h (28800 s), matching BetterAuthModule/AuthModule.
  // Used as the blacklist TTL so revocation records outlive issued access tokens.
  private static readonly JWT_TTL_SECONDS = 28800;

  constructor(
    private prisma: PrismaService,
    private betterAuthService: BetterAuthService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly ecclesiasticalYear: EcclesiasticalYearService,
    private readonly clubCycleReadiness: ClubCycleReadinessService,
    private readonly tokenBlacklist: TokenBlacklistService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
    private readonly legalService: LegalService,
    private readonly countryAgePolicy: CountryAgePolicyService,
    private readonly familyFlags: FamilyFeatureFlagsService,
    private readonly supervisionState: SupervisionStateService,
    private readonly loginFailures: LoginFailureCounter,
    private readonly supervisedResolver: SupervisedPrincipalResolver,
    @Optional()
    @Inject(SUPERVISED_LOGIN_EVENTS)
    events?: Partial<SupervisedLoginEvents>,
  ) {
    this.events = resolveSupervisedLoginEvents(events);
  }

  private readonly events: SupervisedLoginEvents;

  /**
   * Blocks anyone below the minimum self-login age and returns the age facts
   * the register transaction must persist:
   *  - `supervised`: the person falls in the supervised range (minimum age <=
   *    age < majority); they get a `supervised_logins` row with the
   *    registration so the guardian-less clock starts.
   *  - `birthday`: the parsed calendar date (UTC midnight). It MUST be stored
   *    with the account: the principal resolver reads it from `users`, and
   *    without it a self-registered teen is treated as an adult until the
   *    birthday is saved through PATCH /users/:id.
   *  - `countryId`: the country whose policy decided the age, only when it
   *    exists (an unknown id was evaluated with the default policy, the same
   *    one a NULL country gets, so leaving it NULL keeps the decision).
   * Without a birthday nothing is known; the supervised row is then created
   * when the birthday is saved (UsersService).
   */
  private async assertRegistrationAge(dto: RegisterDto): Promise<{
    supervised: boolean;
    birthday: Date | null;
    countryId: number | null;
  }> {
    const countryId = await this.knownCountryId(dto.country_id);
    if (!dto.birthday) {
      return { supervised: false, birthday: null, countryId };
    }

    const birthday = parseCalendarDate(dto.birthday);
    if (!birthday) {
      // The DTO already validated the shape; an unparsable date never passes.
      throw new AppUnprocessableEntityException(
        ErrorCode.AUTH_REGISTRATION_AGE_BELOW_MINIMUM,
      );
    }

    const policy = await this.countryAgePolicy.getPolicy(dto.country_id);
    const age = ageToday(birthday, policy.timeZone);
    if (age < policy.minSelfLoginAge) {
      throw new AppUnprocessableEntityException(
        ErrorCode.AUTH_REGISTRATION_AGE_BELOW_MINIMUM,
      );
    }
    return { supervised: age < policy.ageOfMajority, birthday, countryId };
  }

  /** The register country, only when it exists (the column is a foreign key). */
  private async knownCountryId(
    countryId: number | undefined,
  ): Promise<number | null> {
    if (countryId === undefined || countryId === null) return null;
    const country = await this.prisma.countries.findUnique({
      where: { country_id: countryId },
      select: { country_id: true },
    });
    return country ? country.country_id : null;
  }

  async register(dto: RegisterDto, context?: SessionRequestContext) {
    // 0. Validate the accepted legal versions BEFORE any user is created: a
    //    mismatch must leave no users/account/session row behind.
    const accepted = {
      terms: dto.accepted_terms_version,
      privacy: dto.accepted_privacy_version,
    };
    this.legalService.assertCurrentVersions(accepted);

    // 0b. Age gate (FP-23): a person below the country's minimum self-login
    //     age cannot hold an account; their guardian registers them from
    //     "Mi familia". Runs BEFORE createUser so nothing is created. The
    //     birthday is optional here (API clients can omit it); the authoritative
    //     gate is UsersService.update (FP-24).
    const ageFacts = await this.assertRegistrationAge(dto);

    // 1. Create user in Better Auth (outside transaction — BA manages its own DB writes).
    //    BA creates the row in `users` (mapped via prismaAdapter: user_id, user_image, etc.)
    //    and creates a BA session token.
    const baResult = await this.betterAuthService.createUser(
      dto.email,
      dto.password,
      dto.name,
      context,
    );

    // 2. Complete SACDIA-specific post-registration state in a Prisma transaction.
    //    If this fails we roll back by revoking the BA session (soft cleanup).
    try {
      await this.prisma.$transaction(async (tx) => {
        // 2a. Persist last names (BA only stores name; SACDIA needs granular
        //     fields) and the age facts: the principal resolver reads the
        //     birthday from here, so a self-registered teen is supervised from
        //     the very first request instead of an adult until PATCH /users.
        await tx.users.update({
          where: { user_id: baResult.user.id },
          data: {
            paternal_last_name: dto.paternal_last_name,
            maternal_last_name: dto.maternal_last_name,
            ...(ageFacts.birthday ? { birthday: ageFacts.birthday } : {}),
            ...(ageFacts.countryId !== null
              ? { country_id: ageFacts.countryId }
              : {}),
          },
        });

        // 2b. Create users_pr with granular tracking
        await tx.users_pr.create({
          data: {
            user_id: baResult.user.id,
            complete: false,
            profile_picture_complete: false,
            personal_info_complete: false,
            club_selection_complete: false,
          },
        });

        // 2c. Assign global "user" role
        const userRole = await tx.roles.findFirst({
          where: {
            role_name: 'user',
            role_category: 'GLOBAL',
          },
        });

        if (!userRole) {
          throw new AppBadRequestException(ErrorCode.AUTH_USER_ROLE_NOT_FOUND);
        }

        await tx.users_roles.create({
          data: {
            user_id: baResult.user.id,
            role_id: userRole.role_id,
          },
        });

        // 2c-bis. A self-registered 13-17 starts supervised: the row also starts
        //         the 90-day guardian-less clock (pending_since = now).
        if (ageFacts.supervised) {
          await tx.supervised_logins.create({
            data: {
              user_id: baResult.user.id,
              method: 'email',
              origin: 'self_registered',
              password_set_by: 'self',
              pending_since: new Date(),
            },
          });
        }

        // 2d. Record Terms/Privacy acceptance (append-only evidence)
        await this.legalService.recordOnRegister(
          tx,
          baResult.user.id,
          accepted,
          context,
        );
      });
    } catch (dbError) {
      // Rollback: revoke BA session so the user isn't left in a half-created state.
      // NOTE: BA user record itself is NOT deleted here — the admin plugin is required
      // for user deletion (updatePasswordById notes the same constraint). This is
      // best-effort cleanup; a manual admin action may be needed if the session
      // revocation is insufficient.
      this.logger.error(
        'Database error during post-registration, revoking BA session',
        dbError,
      );
      await this.betterAuthService
        .signOut(baResult.session.token)
        .catch((e) =>
          this.logger.warn('Failed to revoke BA session during rollback', e),
        );
      throw dbError;
    }

    this.logger.log(`User registered successfully: ${baResult.user.id}`);

    // Auto-send verification email after successful registration.
    // Fire-and-forget: a failure here does NOT block registration.
    this.createAndLogVerificationToken(
      baResult.user.email,
      baResult.user.name,
    ).catch((e) =>
      this.logger.warn(
        `Failed to create verification token during registration for ${baResult.user.id}: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );

    // Build token response for auto-login (same structure as login())
    const expiresAtSeconds = Math.floor(
      baResult.session.expiresAt.getTime() / 1000,
    );

    return {
      success: true,
      userId: baResult.user.id,
      message: 'Usuario registrado exitosamente',
      emailVerificationPending: true,
      status: 'success',
      data: {
        ...buildAuthTokenResponse({
          accessToken: baResult.accessToken,
          refreshToken: baResult.session.token,
          expiresAt: expiresAtSeconds,
          tokenType: 'bearer',
        }),
        user: {
          id: baResult.user.id,
          email: baResult.user.email,
          name: baResult.user.name,
          paternal_last_name: dto.paternal_last_name,
          maternal_last_name: dto.maternal_last_name,
          avatar: null,
          roles: ['user'],
        },
        needsPostRegistration: true,
        postRegistrationStatus: {
          complete: false,
          profile_picture_complete: false,
          personal_info_complete: false,
          club_selection_complete: false,
        },
      },
    };
  }

  async login(dto: LoginDto, context?: SessionRequestContext) {
    const identifier = loginIdentifierOf(dto);
    // The identifier is sensitive (an email or a login handle): logs only get
    // the masked email, or just the kind of identifier for a handle.
    const loggedAs = identifier.includes('@')
      ? maskEmail(identifier)
      : '[handle]';
    const ip = context?.ipAddress;

    // 0. Progressive lockout, checked BEFORE the credentials. A lock applies to
    //    the correct password too and to identifiers that do not exist, with the
    //    same answer.
    const lock = await this.loginFailures.check(identifier, ip);
    if (lock.locked) {
      throw new AppException(
        ErrorCode.AUTH_LOGIN_LOCKED,
        HttpStatus.TOO_MANY_REQUESTS,
        { retry_after_seconds: lock.retryAfterSeconds },
      );
    }

    // 1. Authenticate with Better Auth
    let baResult: Awaited<
      ReturnType<typeof this.betterAuthService.signInWithIdentifier>
    >;
    try {
      baResult = await this.betterAuthService.signInWithIdentifier(
        identifier,
        dto.password,
        context,
      );
    } catch (error) {
      // 403 AUTH_ACCOUNT_FROZEN / AUTH_SUPERVISED_LOGIN_DISABLED: the password
      // was CORRECT, so this is not a guess. Say why, count nothing.
      if (
        error instanceof AppException &&
        error.getStatus() === HttpStatus.FORBIDDEN
      ) {
        throw error;
      }
      this.logger.warn(
        `Login failed for ${loggedAs}: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (error instanceof AppUnauthorizedException) {
        await this.recordLoginFailureBestEffort(identifier, ip);
      }
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }

    if (!baResult?.user || !baResult.session) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_login_missing_session',
          email: loggedAs,
        }),
      );
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }

    await this.loginFailures
      .recordSuccess(identifier)
      .catch((error: unknown) => {
        this.logger.warn(
          `Could not reset the login counter: ${error instanceof Error ? error.message : String(error)}`,
        );
      });

    // A password login of a supervised teen opens a NEW session: the verified
    // guardians are told (deduplicated, best effort; refresh never reaches here).
    const principal = await this.loginPrincipalOf(baResult.user.id);
    if (principal.kind === 'supervised_user') {
      void fireEvent(
        () => this.events.onTeenSessionStarted({ userId: baResult.user.id }),
        (error) =>
          this.logger.warn(
            `Teen session notice failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
      );
    }

    // 2. Load SACDIA user profile and verify post-registration state
    const user = await this.prisma.users.findUnique({
      where: { user_id: baResult.user.id },
      select: {
        user_id: true,
        email: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
        user_image: true,
        users_pr: {
          select: {
            complete: true,
            profile_picture_complete: true,
            personal_info_complete: true,
            club_selection_complete: true,
          },
        },
        users_roles: {
          where: { active: true },
          select: {
            roles: {
              select: {
                role_name: true,
                role_category: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }

    const needsPostRegistration = user.users_pr
      ? !user.users_pr.complete
      : true;

    // Extract roles as flat array of strings
    const roles = (user.users_roles ?? []).map((ur) => ur.roles.role_name);

    // BA session expiry as unix epoch seconds (expiresAt is a Date)
    const expiresAtSeconds = Math.floor(
      baResult.session.expiresAt.getTime() / 1000,
    );

    return {
      status: 'success',
      data: {
        ...buildAuthTokenResponse({
          // HS256 JWT signed by SACDIA (Option C) — short-lived (8h)
          accessToken: baResult.accessToken,
          // BA opaque session token — this IS the long-lived credential (7 days, sliding)
          // Clients must send this as `refreshToken` to POST /auth/refresh
          refreshToken: baResult.session.token,
          expiresAt: expiresAtSeconds,
          tokenType: 'bearer',
        }),
        user: {
          id: user.user_id,
          email: user.email,
          name: user.name,
          paternal_last_name: user.paternal_last_name,
          maternal_last_name: user.maternal_last_name,
          avatar: await this.resolvePrivateProfilePicture(user.user_image),
          roles,
          principal,
        },
        needsPostRegistration,
        postRegistrationStatus: user.users_pr ?? null,
      },
    };
  }

  /** A lockout counting problem must never turn into a 500 on the login path. */
  private async recordLoginFailureBestEffort(
    identifier: string,
    ip: string | undefined,
  ): Promise<void> {
    try {
      await this.loginFailures.recordFailure(identifier, ip);
    } catch (error) {
      this.logger.warn(
        `Could not record the login failure: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * The principal kind the login response advertises (the same server-side
   * decision the JWT strategy takes on every later request).
   */
  private async loginPrincipalOf(userId: string): Promise<{
    kind: 'user' | 'supervised_user' | 'age_unknown_user';
    supervision: 'pending_guardian' | 'active' | null;
  }> {
    const state = await this.supervisedResolver.resolve(userId);
    if (state.state === 'supervised') {
      return { kind: 'supervised_user', supervision: state.supervision };
    }
    if (state.state === 'profile_incomplete') {
      return { kind: 'age_unknown_user', supervision: null };
    }
    return { kind: 'user', supervision: null };
  }

  async refreshSession(
    dto: RefreshSessionDto,
    context?: RefreshSessionContext,
  ) {
    const rejectSnakeCase = this.shouldRejectSnakeCase();
    const usingLegacySnakeCase =
      !dto.refreshToken && Boolean(dto.refresh_token);
    const payloadFormat: 'camelCase' | 'snake_case' | 'none' = dto.refreshToken
      ? 'camelCase'
      : dto.refresh_token
        ? 'snake_case'
        : 'none';
    let refreshToken = dto.refreshToken;

    if (usingLegacySnakeCase) {
      if (rejectSnakeCase) {
        this.logger.warn(
          JSON.stringify({
            event: 'auth_refresh_legacy_rejected',
            removedAt: LEGACY_SNAKE_CASE_REMOVED_AT,
            payloadFormat,
            userAgent: context?.userAgent ?? 'unknown',
          }),
        );

        throw new AppBadRequestException(
          ErrorCode.AUTH_REFRESH_TOKEN_LEGACY_REMOVED,
          {
            code: LEGACY_SNAKE_CASE_REMOVED_CODE,
            removedAt: LEGACY_SNAKE_CASE_REMOVED_AT,
            use: 'refreshToken',
          },
        );
      }

      refreshToken = dto.refresh_token;
      this.logger.warn(
        JSON.stringify({
          event: 'auth_refresh_legacy_allowed',
          compatibilityMode: true,
          payloadFormat,
          userAgent: context?.userAgent ?? 'unknown',
        }),
      );
    }

    if (!refreshToken) {
      throw new AppBadRequestException(ErrorCode.AUTH_REFRESH_TOKEN_REQUIRED);
    }

    // The "refresh token" sent by clients IS the BA opaque session token.
    // BA does not have a separate refresh token — the session slides on each getSession call.
    let baResult: Awaited<
      ReturnType<typeof this.betterAuthService.refreshSession>
    >;
    try {
      baResult = await this.betterAuthService.refreshSession(refreshToken);
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_refresh_failed',
          reason: error instanceof Error ? error.message : String(error),
          payloadFormat,
          userAgent: context?.userAgent ?? 'unknown',
        }),
      );
      throw new AppUnauthorizedException(ErrorCode.AUTH_REFRESH_TOKEN_INVALID);
    }

    if (!baResult?.session) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_refresh_failed',
          reason: 'session is null',
          payloadFormat,
          userAgent: context?.userAgent ?? 'unknown',
        }),
      );
      throw new AppUnauthorizedException(ErrorCode.AUTH_REFRESH_TOKEN_INVALID);
    }

    this.logger.log(
      JSON.stringify({
        event: 'auth_refresh_success',
        usedLegacyInput: usingLegacySnakeCase,
        payloadFormat,
      }),
    );

    await this.revokePresentedAccessTokenOnRefresh({
      presented: this.normalizeToken(context?.accessToken),
      userId: baResult.user.id,
      replacement: baResult.accessToken,
      userAgent: context?.userAgent ?? 'unknown',
    });

    const expiresAtSeconds = Math.floor(
      baResult.session.expiresAt.getTime() / 1000,
    );

    return {
      status: 'success',
      data: buildAuthTokenResponse({
        accessToken: baResult.accessToken,
        // Return the same opaque session token — it is still valid and slides
        refreshToken: baResult.session.token,
        expiresAt: expiresAtSeconds,
        tokenType: 'bearer',
      }),
    };
  }

  async logout(input: LogoutRequest = {}) {
    const refreshToken = this.normalizeToken(input.refreshToken);
    const accessToken = this.normalizeToken(input.accessToken);
    const userAgent = input.userAgent ?? 'unknown';

    // In the Option C model:
    // - accessToken = SACDIA HS256 JWT (BA doesn't know about it)
    // - refreshToken = BA opaque session token (this is what BA can revoke)
    //
    // Strategy:
    //   If refreshToken present → revoke BA session (best effort).
    //   If only accessToken present → nothing to revoke on BA side; return success.
    //   The JWT will expire naturally within 8h.

    let path: LogoutPath = 'none';
    let revocationAttempted = false;
    let revocationSucceeded = false;
    let reason: string | undefined;

    if (refreshToken) {
      path = 'session';
      revocationAttempted = true;
      try {
        await this.betterAuthService.signOut(refreshToken);
        revocationSucceeded = true;
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          JSON.stringify({
            event: 'auth_logout_revoke_failed',
            path,
            reason,
            userAgent,
          }),
        );
      }
    } else if (accessToken) {
      // Access token is a SACDIA JWT — BA has no record of it.
      // Best effort: mark as access-only logout (token expires in ≤8h naturally).
      path = 'access_only';
      revocationAttempted = false;
      reason = 'no_session_token_provided';
      this.logger.warn(
        JSON.stringify({
          event: 'auth_logout_access_only',
          note: 'No BA session token provided; JWT will expire naturally',
          userAgent,
        }),
      );
    }

    // Blacklist the SACDIA JWT access token so it is rejected immediately
    // by JwtStrategy even if the client reuses it before the 8h natural expiry.
    if (accessToken) {
      try {
        await this.tokenBlacklist.blacklistToken(
          accessToken,
          AuthService.JWT_TTL_SECONDS,
        );
      } catch (error) {
        this.logger.warn(
          JSON.stringify({
            event: 'auth_logout_blacklist_failed',
            reason: error instanceof Error ? error.message : String(error),
            userAgent,
          }),
        );
      }
    }

    this.logger.log(
      JSON.stringify({
        event: 'auth_logout_best_effort',
        path,
        revocationAttempted,
        revocationSucceeded,
        reason: reason ?? null,
        userAgent,
      }),
    );

    return {
      success: true,
      message: 'Sesión cerrada (best effort)',
      revocationAttempted,
      revocationSucceeded,
      path,
    };
  }

  async requestPasswordReset(dto: ResetPasswordRequestDto) {
    // A login handle has no email to write to: the guardian resets handle
    // passwords. Same neutral answer as an unknown email, nothing queued, no
    // lookup, and the handle is never logged.
    if (!dto.email.includes('@')) {
      this.logger.log('Password reset requested for a handle: no email queued');
      return {
        success: true,
        message: 'Correo de recuperación enviado',
      };
    }

    const redirectTo = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/reset-password`
      : undefined;

    try {
      await this.betterAuthService.resetPasswordForEmail(dto.email, redirectTo);
    } catch (error) {
      // ServiceUnavailableException means email transport is disabled — propagate as-is
      // so the HTTP layer returns 503 with the original message.
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      this.logger.error(
        `Password reset request error: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
      throw new AppBadRequestException(ErrorCode.AUTH_PASSWORD_RESET_FAILED);
    }

    this.logger.log(`Password reset requested for: ${maskEmail(dto.email)}`);

    return {
      success: true,
      message: 'Correo de recuperación enviado',
    };
  }

  /**
   * Confirms password recovery with the emailed token.
   * Does not issue a session or JWT. Existing sessions and access JWTs are revoked.
   */
  async confirmPasswordReset(dto: ResetPasswordDto) {
    try {
      const { userId } = await this.betterAuthService.resetPasswordWithToken(
        dto.token,
        dto.password,
      );
      await this.prisma.session.deleteMany({ where: { userId } });
      await this.blacklistUserTokensBestEffort(userId, 'password_reset');
      this.logger.log(
        `Password reset confirmed; sessions revoked for ${userId}`,
      );
      // A supervised teen's emailed reset tells the verified guardians. The
      // adapter does nothing for adults and for children without guardians.
      void fireEvent(
        () => this.events.onPasswordReset({ dependentUserId: userId }),
        (error) =>
          this.logger.warn(
            `Password reset notice failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
      );
      return {
        success: true,
        message: 'Contraseña actualizada. Inicie sesión de nuevo',
      };
    } catch (error) {
      if (
        error instanceof AppBadRequestException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      this.logger.error(
        `Password reset confirm error: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
      throw new AppBadRequestException(ErrorCode.AUTH_PASSWORD_RESET_FAILED);
    }
  }

  /**
   * Updates the password for the currently authenticated user (self-service).
   *
   * For admin-scoped password updates (setting another user's password without
   * their current password), see AdminAuthService.setUserPassword() and
   * POST /api/v1/admin/users/:userId/password.
   */
  async updateOwnPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    options: { supervised?: boolean } = {},
  ): Promise<void> {
    // A WRONG current password throws here: no notice, nothing changes.
    await this.betterAuthService.updateOwnPassword(
      userId,
      currentPassword,
      newPassword,
    );
    await this.prisma.session.deleteMany({ where: { userId } });
    await this.blacklistUserTokensBestEffort(userId, 'password_change');
    this.logger.log(`Self-service password updated for user: ${userId}`);

    if (options.supervised) {
      // The teen chose this password: the guardian no longer set it. Best
      // effort, after the change is already committed.
      await this.prisma.supervised_logins
        .updateMany({
          where: { user_id: userId },
          data: { password_set_by: 'self' },
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `Could not record password_set_by for ${userId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      void fireEvent(
        () => this.events.onTeenPasswordChanged({ userId }),
        (error) =>
          this.logger.warn(
            `Teen password notice failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
      );
    }
  }

  /**
   * Runs AFTER the password mutation and the session deletion have been
   * committed, so a cache (Redis) failure must not turn a completed password
   * change into a 500 / AUTH_PASSWORD_RESET_FAILED, nor invite a retry with a
   * now-consumed token. Existing access JWTs stay valid until the session
   * check (AUTH_BLACKLIST_DEGRADED_MODE=db-session rejects them: the session
   * rows are already gone) or, at worst, until JWT_TTL_SECONDS elapse.
   * Same precedent as SocialSignInService.blacklistPriorTokens.
   */
  private async blacklistUserTokensBestEffort(
    userId: string,
    flow: 'password_reset' | 'password_change',
  ): Promise<void> {
    try {
      await this.tokenBlacklist.blacklistAllUserTokens(
        userId,
        AuthService.JWT_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'auth_password_blacklist_failed',
          flow,
          userId,
          reason: error instanceof Error ? error.message : String(error),
          note: `Sessions were deleted but access JWTs could not be blacklisted; they may stay valid until the DB session check rejects them or up to ${AuthService.JWT_TTL_SECONDS}s`,
        }),
      );
    }
  }

  async getProfile(
    userId: string,
    principal?: Pick<
      AuthPrincipal,
      | 'acting_for'
      | 'actor_sub'
      | 'guardianship_id'
      | 'consent_status'
      | 'scopes'
      | 'kind'
      | 'supervision'
    >,
  ) {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);
    const acting = principal?.acting_for === true;
    const supervisionStatus =
      principal?.kind === 'supervised_user' ? principal.supervision : undefined;
    const ageUnknown = principal?.kind === 'age_unknown_user';
    const [signedUserImage, legal, family, supervision, analyticsAnonymous] =
      await Promise.all([
        this.resolvePrivateProfilePicture(resolved.profile.user_image),
        // Outside the authorization cache: acceptance must reflect the DB right away.
        this.legalService.getStatus(userId),
        // Hidden while acting (a dependent has no family of its own to show),
        // for supervised teens and for an unknown age (neither is a guardian).
        acting || supervisionStatus || ageUnknown
          ? Promise.resolve(null)
          : this.loadFamilySummary(userId),
        supervisionStatus
          ? this.supervisionState.describe(userId, supervisionStatus)
          : Promise.resolve(null),
        this.isAnalyticsAnonymous(
          resolved.profile.birthday,
          resolved.profile.country_id,
        ),
      ]);

    return {
      status: 'success',
      data: {
        ...resolved.profile,
        user_image: signedUserImage,
        roles: resolved.legacy.roles,
        permissions: resolved.legacy.permissions,
        post_register_complete: resolved.post_register_complete,
        club: resolved.legacy.club,
        club_context: resolved.legacy.club_context,
        authorization: resolved.authorization,
        legal,
        acting_for: acting
          ? {
              actor_user_id: principal.actor_sub,
              dependent_user_id: userId,
              guardianship_id: principal.guardianship_id ?? null,
              consent_status: principal.consent_status ?? null,
              scopes: principal.scopes ?? [],
            }
          : null,
        family,
        // Phase 3a. The app routes by `mode` and decides analytics BEFORE
        // identifying anyone: an absent or unknown field means anonymous.
        principal: {
          kind: principal?.kind ?? 'user',
          scopes: principal?.scopes ?? null,
          supervision,
        },
        // profile_incomplete: unknown age (NULL birthday, post-registration
        // open). The app finishes the post-registration before anything else.
        mode: ageUnknown
          ? 'profile_incomplete'
          : !supervisionStatus
            ? 'adult'
            : supervisionStatus === 'active'
              ? 'teen_supervised'
              : 'teen_pending',
        family_features: this.familyFlags.getAll(),
        analytics_anonymous: analyticsAnonymous,
      },
    };
  }

  /**
   * True for anyone under the age of majority and for an unknown age (NULL
   * birthday): the app never identifies them in PostHog or Sentry. Fails closed.
   */
  private async isAnalyticsAnonymous(
    birthday: Date | string | null,
    countryId: number | null,
  ): Promise<boolean> {
    // The profile can come from the authorization cache; tolerate a string and
    // treat an unreadable value like an unknown age.
    const born = toDateValue(birthday);
    if (!born) return true;
    const policy = await this.countryAgePolicy.getPolicy(countryId);
    return ageToday(born, policy.timeZone) < policy.ageOfMajority;
  }

  /**
   * Guardian summary for GET /auth/me. Mirrors the active-dependent rule used
   * by the dependent limit: non-custodian, non-test, pending|verified, and the
   * dependent is not frozen or purged.
   */
  private async loadFamilySummary(
    userId: string,
  ): Promise<{ is_guardian: boolean; dependents_count: number }> {
    const dependentsCount = await this.prisma.guardianships.count({
      where: {
        guardian_user_id: userId,
        is_custodian: false,
        is_test_data: false,
        consent_status: { in: ['pending', 'verified'] },
        dependent: {
          dependent_profile: { is: { frozen_at: null, purged_at: null } },
        },
      },
    });

    return {
      is_guardian: dependentsCount > 0,
      dependents_count: dependentsCount,
    };
  }

  async setActiveClubContext(userId: string, dto: SetActiveClubContextDto) {
    // Resolve current year first — propagates CLASS_ACTIVE_YEAR_NOT_FOUND if
    // no active year exists (prevents activating any assignment without a year).
    const currentYear = await this.ecclesiasticalYear.getCurrentYear();

    const assignment = await this.prisma.club_role_assignments.findFirst({
      where: {
        assignment_id: dto.assignment_id,
        user_id: userId,
      },
      select: {
        assignment_id: true,
        ecclesiastical_year_id: true,
        status: true,
        roles: { select: { role_name: true } },
        club_sections: {
          select: {
            club_section_id: true,
            club_types: { select: { name: true } },
            clubs: { select: { club_id: true, name: true } },
          },
        },
      },
    });

    if (!assignment) {
      throw new AppBadRequestException(ErrorCode.AUTH_ASSIGNMENT_NOT_FOUND, {
        assignmentId: dto.assignment_id,
      });
    }

    // Only status:'active' assignments in the current ecclesiastical year may
    // become the active context. Designated (next year) and past-year
    // assignments are visible in grants.club_assignments but cannot be
    // activated as the operative club context.
    if (
      assignment.status !== 'active' ||
      assignment.ecclesiastical_year_id !== currentYear.year_id
    ) {
      throw new AppBadRequestException(
        ErrorCode.AUTH_ASSIGNMENT_YEAR_MISMATCH,
        { assignmentId: dto.assignment_id },
      );
    }

    const clubId = assignment.club_sections?.clubs?.club_id;
    if (clubId != null) {
      await this.clubCycleReadiness.assertReady(clubId, currentYear.year_id);
    }

    await this.prisma.users_pr.upsert({
      where: { user_id: userId },
      update: { active_club_assignment_id: dto.assignment_id },
      create: {
        user_id: userId,
        active_club_assignment_id: dto.assignment_id,
      },
    });

    // Invalidate the cached authorization context so the next call to
    // resolveUserAuthorization re-reads from DB and picks up the new
    // active_club_assignment_id we just persisted.
    await this.authorizationContext.invalidateUserAuthorizationCache(userId);

    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);

    return {
      status: 'success',
      data: {
        active_assignment_id:
          resolved.authorization.active_assignment.assignment_id,
        club: resolved.legacy.club,
        active: resolved.legacy.club_context.active,
        authorization: resolved.authorization,
      },
    };
  }

  async getCompletionStatus(userId: string) {
    const userPr = await this.prisma.users_pr.findUnique({
      where: { user_id: userId },
      select: {
        complete: true,
        profile_picture_complete: true,
        personal_info_complete: true,
        club_selection_complete: true,
        date_completed: true,
      },
    });

    if (!userPr) {
      throw new AppBadRequestException(
        ErrorCode.AUTH_POST_REGISTRATION_NOT_STARTED,
      );
    }

    let nextStep: string | null = null;
    if (!userPr.profile_picture_complete) {
      nextStep = 'profilePicture';
    } else if (!userPr.personal_info_complete) {
      nextStep = 'personalInfo';
    } else if (!userPr.club_selection_complete) {
      nextStep = 'clubSelection';
    }

    return {
      status: 'success',
      data: {
        complete: userPr.complete,
        steps: {
          profilePicture: userPr.profile_picture_complete,
          personalInfo: userPr.personal_info_complete,
          clubSelection: userPr.club_selection_complete,
        },
        nextStep,
        dateCompleted: userPr.date_completed,
      },
    };
  }

  /**
   * Sends a verification email to the authenticated user.
   *
   * Creates a token in the `verification` table (expires in 24h) and logs it.
   * In production, replace the logger.log with an SMTP/SendGrid call.
   */
  async sendVerificationEmail(userId: string) {
    const dbUser = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: { email: true, email_verified: true },
    });

    if (!dbUser) {
      throw new AppNotFoundException(ErrorCode.AUTH_USER_NOT_FOUND, { userId });
    }

    if (dbUser.email_verified) {
      return {
        success: true,
        message: 'El email ya está verificado',
        alreadyVerified: true,
      };
    }

    // Dependent profiles have no email: there is nothing to verify.
    if (!dbUser.email) {
      return {
        success: true,
        message: 'La cuenta no tiene correo electrónico',
        skipped: true,
      };
    }

    await this.createAndLogVerificationToken(dbUser.email);

    return {
      success: true,
      message: 'Email de verificación enviado',
    };
  }

  /**
   * Confirms email ownership using a verification token.
   *
   * Validates the token against the `verification` table.
   * If valid and not expired: sets `email_verified = true` and deletes the token.
   */
  async confirmEmailVerification(dto: VerifyEmailDto) {
    const verification = await this.prisma.verification.findFirst({
      where: { value: dto.token },
    });

    if (!verification) {
      throw new AppBadRequestException(
        ErrorCode.AUTH_EMAIL_VERIFICATION_TOKEN_INVALID,
      );
    }

    if (
      NON_EMAIL_VERIFICATION_PREFIXES.some((prefix) =>
        verification.identifier.startsWith(prefix),
      )
    ) {
      throw new AppBadRequestException(
        ErrorCode.AUTH_EMAIL_VERIFICATION_TOKEN_INVALID,
      );
    }

    if (verification.expiresAt < new Date()) {
      // Clean up expired token
      await this.prisma.verification.delete({
        where: { id: verification.id },
      });
      throw new AppBadRequestException(
        ErrorCode.AUTH_EMAIL_VERIFICATION_TOKEN_EXPIRED,
      );
    }

    // Mark user as verified and delete the token in a transaction
    await this.prisma.$transaction([
      this.prisma.users.update({
        where: { email: verification.identifier },
        data: { email_verified: true },
      }),
      this.prisma.verification.delete({
        where: { id: verification.id },
      }),
    ]);

    this.logger.log(
      `Email verified for: ${maskEmail(verification.identifier)}`,
    );

    return {
      success: true,
      message: 'Email verificado exitosamente',
    };
  }

  /**
   * Creates a 24h verification token in the `verification` table and enqueues
   * a verification email via the emails BullMQ queue.
   *
   * SECURITY: The raw token is NEVER logged — it is a credential. The token is
   * embedded in a deep link passed to EmailService (not logged by EmailService either).
   *
   * EMAIL_ENABLED gate: enforced at the EmailProcessor level. This method always
   * enqueues — if EMAIL_ENABLED=false, the processor silently drops the job.
   * The token is still persisted so it can be verified if the user receives the
   * email through other means (e.g., resend flow).
   */
  private async createAndLogVerificationToken(
    email: string | null,
    userName?: string,
  ): Promise<void> {
    // Dependent profiles have no email: nothing to verify, nothing to log.
    if (!email) {
      return;
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    await this.prisma.verification.create({
      data: {
        id: randomUUID(),
        identifier: email,
        value: token,
        expiresAt,
      },
    });

    // Build deep link — token is embedded in URL, never logged separately.
    // The mobile app handles sacdia://verify-email?token=<token> internally
    // and calls POST /api/v1/auth/verify-email/confirm with the token in the body.
    const verificationUrl = `sacdia://verify-email?token=${token}`;

    // Enqueue email — fire-and-forget from the processor's perspective.
    // The caller wraps this entire method in .catch() already.
    await this.emailService.sendEmailVerification({
      email,
      verificationUrl,
      userName,
    });

    this.logger.log(
      `Verification email enqueued for ${maskEmail(email)} (expires ${expiresAt.toISOString()})`,
    );
  }

  /**
   * Best-effort rotation: if the client presented its current access JWT and
   * that JWT belongs to this refresh user, blacklist it. Missing / foreign /
   * QR / garbage tokens are ignored so refresh still works for older clients.
   */
  private async revokePresentedAccessTokenOnRefresh(input: {
    presented?: string;
    userId: string;
    replacement: string;
    userAgent: string;
  }): Promise<void> {
    if (!input.presented || input.presented === input.replacement) {
      return;
    }

    const secret = this.config.getOrThrow<string>('BETTER_AUTH_SECRET');
    if (!isPresentedAccessJwtForUser(input.presented, input.userId, secret)) {
      this.logger.debug(
        JSON.stringify({
          event: 'auth_refresh_access_not_revoked',
          reason: 'not_same_user_access_jwt',
          userAgent: input.userAgent,
        }),
      );
      return;
    }

    try {
      await this.tokenBlacklist.blacklistToken(
        input.presented,
        AuthService.JWT_TTL_SECONDS,
      );
      this.logger.log(
        JSON.stringify({
          event: 'auth_refresh_access_revoked',
          userAgent: input.userAgent,
        }),
      );
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_refresh_blacklist_failed',
          reason: error instanceof Error ? error.message : String(error),
          userAgent: input.userAgent,
        }),
      );
    }
  }

  private normalizeToken(token?: string | null): string | undefined {
    const normalized = token?.trim();
    return normalized ? normalized : undefined;
  }

  private async resolvePrivateProfilePicture(
    userImage: string | null | undefined,
  ): Promise<string | null> {
    if (!userImage) return null;

    try {
      return await this.fileStorage.getSignedDownloadUrl(
        StorageBucketAlias.USER_PROFILES,
        userImage,
        {
          expiresInSeconds: AuthService.PRIVATE_ASSET_URL_TTL_SECONDS,
        },
      );
    } catch (error) {
      this.logger.warn(
        'Failed to generate signed URL for profile picture. Returning original value.',
        error,
      );
      return userImage;
    }
  }

  private shouldRejectSnakeCase(): boolean {
    return process.env.AUTH_REJECT_SNAKE_CASE?.toLowerCase() !== 'false';
  }
}

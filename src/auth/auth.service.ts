import {
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BetterAuthService } from '../better-auth/better-auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordRequestDto } from './dto/reset-password-request.dto';
import { RefreshSessionDto } from './dto/refresh-session.dto';
import { SetActiveClubContextDto } from './dto/set-active-club-context.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { buildAuthTokenResponse } from './utils/auth-token-response.util';
import { maskEmail } from '../common/utils/mask-email.util';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
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
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ClubAssignmentEffectivityPolicy } from '../common/authorization/club-assignment-effectivity.policy';
import { LocalFieldTimezoneResolver } from '../common/authorization/local-field-timezone.resolver';
import { TemporalContextFactory } from '../common/clock/temporal-context.factory';

const LEGACY_SNAKE_CASE_REMOVED_AT = '2026-03-01';
const LEGACY_SNAKE_CASE_REMOVED_CODE = 'LEGACY_SNAKE_CASE_REMOVED';

type RefreshSessionContext = {
  userAgent?: string;
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
    private readonly tokenBlacklist: TokenBlacklistService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
    private readonly emailService: EmailService,
    private readonly temporalContextFactory: TemporalContextFactory,
    private readonly localFieldTimezoneResolver: LocalFieldTimezoneResolver,
    private readonly assignmentEffectivityPolicy: ClubAssignmentEffectivityPolicy,
  ) {}

  async register(dto: RegisterDto) {
    // 1. Create user in Better Auth (outside transaction — BA manages its own DB writes).
    //    BA creates the row in `users` (mapped via prismaAdapter: user_id, user_image, etc.)
    //    and creates a BA session token.
    const baResult = await this.betterAuthService.createUser(
      dto.email,
      dto.password,
      dto.name,
    );

    // 2. Complete SACDIA-specific post-registration state in a Prisma transaction.
    //    If this fails we roll back by revoking the BA session (soft cleanup).
    try {
      await this.prisma.$transaction(async (tx) => {
        // 2a. Persist last names (BA only stores name; SACDIA needs granular fields)
        await tx.users.update({
          where: { user_id: baResult.user.id },
          data: {
            paternal_last_name: dto.paternal_last_name,
            maternal_last_name: dto.maternal_last_name,
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

  async login(dto: LoginDto) {
    const maskedEmail = maskEmail(dto.email);

    // 1. Authenticate with Better Auth
    let baResult: Awaited<
      ReturnType<typeof this.betterAuthService.signInWithPassword>
    >;
    try {
      baResult = await this.betterAuthService.signInWithPassword(
        dto.email,
        dto.password,
      );
    } catch (error) {
      this.logger.warn(
        `Login failed for ${maskedEmail}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }

    if (!baResult?.user || !baResult.session) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_login_missing_session',
          email: maskedEmail,
        }),
      );
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS);
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
        },
        needsPostRegistration,
        postRegistrationStatus: user.users_pr ?? null,
      },
    };
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
  ): Promise<void> {
    await this.betterAuthService.updateOwnPassword(
      userId,
      currentPassword,
      newPassword,
    );
    await this.prisma.session.deleteMany({ where: { userId } });
    await this.tokenBlacklist.blacklistAllUserTokens(
      userId,
      AuthService.JWT_TTL_SECONDS,
    );
    this.logger.log(`Self-service password updated for user: ${userId}`);
  }

  async getProfile(userId: string) {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);
    const signedUserImage = await this.resolvePrivateProfilePicture(
      resolved.profile.user_image,
    );

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
      },
    };
  }

  async setActiveClubContext(userId: string, dto: SetActiveClubContextDto) {
    // Inventory preload only. Temporal authority uses
    // ClubAssignmentEffectivityPolicy.isEffective (resource timezone).
    const assignment = await this.prisma.club_role_assignments.findFirst({
      where: {
        assignment_id: dto.assignment_id,
        user_id: userId,
        active: true,
        status: 'active',
      },
      select: {
        assignment_id: true,
        active: true,
        status: true,
        start_date: true,
        end_date: true,
        expires_at: true,
        roles: { select: { role_name: true } },
        club_sections: {
          select: {
            club_section_id: true,
            club_types: { select: { name: true } },
            clubs: {
              select: {
                club_id: true,
                name: true,
                local_fields: {
                  select: { local_field_id: true, timezone: true },
                },
              },
            },
          },
        },
      },
    });

    if (!assignment || !this.isClubAssignmentCurrentlyEffective(assignment)) {
      throw new AppBadRequestException(ErrorCode.AUTH_ASSIGNMENT_NOT_FOUND, {
        assignmentId: dto.assignment_id,
      });
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
    email: string,
    userName?: string,
  ): Promise<void> {
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
   * Authority gate for club assignments. Uses ClubAssignmentEffectivityPolicy
   * with TemporalContext from the assignment's local-field timezone.
   * Fail-closed when timezone cannot be classified.
   */
  private isClubAssignmentCurrentlyEffective(assignment: {
    active?: boolean | null;
    status: string | null;
    start_date: Date | null;
    end_date: Date | null;
    expires_at: Date | null;
    club_sections: {
      clubs: {
        local_fields: {
          local_field_id: number;
          timezone: string | null;
        } | null;
      } | null;
    } | null;
  }): boolean {
    if (assignment.active === false || assignment.status !== 'active') {
      return false;
    }
    if (!assignment.start_date) {
      return false;
    }

    const localField = assignment.club_sections?.clubs?.local_fields;
    if (!localField) {
      throw new AppException(
        ErrorCode.LOCAL_FIELD_TIMEZONE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        { reason: 'MISSING' },
      );
    }

    const timezone = this.localFieldTimezoneResolver.assertTimezone(
      localField.timezone,
    );
    const temporalContext = this.temporalContextFactory.forLocalField({
      local_field_id: localField.local_field_id,
      timezone,
    });

    return this.assignmentEffectivityPolicy.isEffective(
      {
        active: assignment.active ?? true,
        status: assignment.status,
        start_date: assignment.start_date,
        end_date: assignment.end_date,
        expires_at: assignment.expires_at,
      },
      temporalContext,
    );
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

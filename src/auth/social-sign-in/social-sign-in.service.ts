import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  BetterAuthService,
  type SessionRequestContext,
} from '../../better-auth/better-auth.service';
import { AppUnauthorizedException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../../common/services/file-storage.service';
import type { FileStorageService } from '../../common/services/file-storage.service';
import { TokenBlacklistService } from '../../common/services/token-blacklist.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  fireEvent,
  resolveSupervisedLoginEvents,
  SUPERVISED_LOGIN_EVENTS,
  type SupervisedLoginEvents,
} from '../supervised/supervised-login-events.port';
import { SupervisedPrincipalResolver } from '../supervised/supervised-principal.resolver';
import { ActingForCache } from '../acting-for/acting-for.cache';
import { AppleTokenClient } from './apple-token.client';
import type { SocialTokenSignInDto } from './dto/social-token-sign-in.dto';
import { SocialAccountResolver } from './social-account.resolver';
import {
  APPLE_ID_TOKEN_VERIFIER,
  GOOGLE_ID_TOKEN_VERIFIER,
  truncateSub,
  type IdTokenVerifier,
  type SocialProvider,
  type VerifiedIdentity,
} from './social-sign-in.types';

/**
 * Shape of the old `POST /auth/oauth/callback` plus the token fields
 * `POST /auth/login` returns (`refreshToken`, `expiresAt`, `tokenType`), so the
 * app parses both responses with the same code. `sessionToken` and
 * `refreshToken` carry the same opaque session token.
 */
export interface SocialSignInResult {
  accessToken: string;
  sessionToken: string;
  refreshToken: string;
  /** Unix seconds, like /auth/login. */
  expiresAt: number;
  tokenType: 'bearer';
  user: {
    id: string;
    email: string;
    name: string | null;
    paternal_last_name: string | null;
    maternal_last_name: string | null;
    avatar: string | null;
    connectedProviders: string[];
  };
  needsPostRegistration: boolean;
}

/** Access JWT lifetime. Mirrors `AuthService.JWT_TTL_SECONDS` (private there). */
const JWT_TTL_SECONDS = 28800;

/** `users.email` is VarChar(100). */
const EMAIL_MAX = 100;

@Injectable()
export class SocialSignInService {
  private readonly logger = new Logger(SocialSignInService.name);
  private static readonly PRIVATE_ASSET_URL_TTL_SECONDS = 300;
  private readonly verifiers: Record<SocialProvider, IdTokenVerifier>;

  constructor(
    @Inject(GOOGLE_ID_TOKEN_VERIFIER) google: IdTokenVerifier,
    @Inject(APPLE_ID_TOKEN_VERIFIER) apple: IdTokenVerifier,
    private readonly resolver: SocialAccountResolver,
    private readonly appleTokens: AppleTokenClient,
    private readonly betterAuth: BetterAuthService,
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
    private readonly tokenBlacklist: TokenBlacklistService,
    private readonly supervisedResolver: SupervisedPrincipalResolver,
    private readonly actingForCache: ActingForCache,
    @Optional()
    @Inject(SUPERVISED_LOGIN_EVENTS)
    events?: Partial<SupervisedLoginEvents>,
  ) {
    this.verifiers = { google, apple };
    this.events = resolveSupervisedLoginEvents(events);
  }

  private readonly events: SupervisedLoginEvents;

  async signIn(
    provider: SocialProvider,
    dto: SocialTokenSignInDto,
    context?: SessionRequestContext,
  ): Promise<SocialSignInResult> {
    const verified = await this.verifiers[provider].verify(
      dto.idToken,
      dto.nonce,
    );
    if (!verified.email || !verified.emailVerified) {
      this.logger.warn(
        `${provider} sign-in rejected — unverified or missing email (sub ${truncateSub(verified.sub)})`,
      );
      throw new AppUnauthorizedException(ErrorCode.AUTH_OAUTH_EMAIL_UNVERIFIED);
    }

    // users.email is VarChar(100); a longer address would fail the insert with
    // a 500. No real mailbox is that long, so treat it as a bad token.
    if (verified.email.length > EMAIL_MAX) {
      this.logger.warn(
        `${provider} sign-in rejected — email longer than ${EMAIL_MAX} chars (sub ${truncateSub(verified.sub)})`,
      );
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_TOKEN);
    }

    const identity: VerifiedIdentity =
      provider === 'apple' && dto.fullName
        ? {
            ...verified,
            givenName: dto.fullName.givenName,
            familyName: dto.fullName.familyName,
          }
        : verified;

    const { userId, created, linked, revokedPriorAccess } =
      await this.resolver.resolve(identity);

    if (provider === 'apple' && dto.authorizationCode) {
      await this.storeAppleRefreshToken(identity.sub, dto.authorizationCode);
    }

    if (!created) {
      // The provisioning creates the post-registration row when it is missing
      // (an admin-created or legacy account signing in with Google/Apple), and
      // the principal kind reads it (unknown-age restriction). Re-resolve it.
      // A brand-new account has no cached principal yet.
      await this.actingForCache.bump(userId);
    }

    if (revokedPriorAccess) {
      // The resolver deleted the previous holder's sessions; their access JWTs
      // stay valid until expiry unless the user is blacklisted. Do it before
      // signing so the new JWT (iat >= blacklist time) is not caught by it.
      await this.blacklistPriorTokens(userId);
    }

    // Same rule as password login: with TOTP enrolled the JWT is mfa_pending
    // until POST /auth/mfa/verify upgrades it.
    const { enabled: mfaEnabled } =
      await this.betterAuth.hasTotpEnabled(userId);
    const session = await this.betterAuth.createSession(userId, context);
    const [user, userPr, accounts] = await Promise.all([
      this.prisma.users.findUnique({ where: { user_id: userId } }),
      this.prisma.users_pr.findUnique({ where: { user_id: userId } }),
      this.prisma.account.findMany({
        where: { userId },
        select: { providerId: true },
      }),
    ]);
    const email = user?.email ?? identity.email!;
    const accessToken = this.betterAuth.signJwt(
      { id: userId, email },
      mfaEnabled,
      session.id,
    );

    this.logger.log(
      `${provider} sign-in for user ${userId} (created=${created} linked=${linked})`,
    );

    await this.notifyGuardiansOfSupervisedSession(userId);

    return {
      accessToken,
      sessionToken: session.token,
      refreshToken: session.token,
      expiresAt: Math.floor(session.expiresAt.getTime() / 1000),
      tokenType: 'bearer',
      user: {
        id: userId,
        email,
        name: user?.name ?? null,
        paternal_last_name: user?.paternal_last_name ?? null,
        maternal_last_name: user?.maternal_last_name ?? null,
        avatar: await this.signedAvatar(user?.user_image),
        connectedProviders: accounts
          .map((a) => a.providerId)
          .filter((p) => p !== 'credential'),
      },
      needsPostRegistration: !userPr?.complete,
    };
  }

  /**
   * The resolver already deleted the previous holder's sessions in a committed
   * transaction, so a retry of the request would take the returning-user path
   * and never blacklist again. Retry once here; if the cache is still down,
   * log and carry on: the damage is bounded by the remaining JWT lifetime.
   */
  /**
   * A social sign-in of a supervised teen opens a new session: the verified
   * guardians are told (deduplicated). Best effort, only for supervised teens.
   */
  private async notifyGuardiansOfSupervisedSession(
    userId: string,
  ): Promise<void> {
    try {
      const state = await this.supervisedResolver.resolve(userId);
      if (state.state !== 'supervised') return;
      void fireEvent(
        () => this.events.onTeenSessionStarted({ userId }),
        (error) =>
          this.logger.warn(
            `Teen session notice failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
      );
    } catch (error) {
      this.logger.warn(
        `Could not classify the social sign-in principal: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async blacklistPriorTokens(userId: string): Promise<void> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this.tokenBlacklist.blacklistAllUserTokens(
          userId,
          JWT_TTL_SECONDS,
        );
        return;
      } catch (error) {
        if (attempt === 2) {
          this.logger.error(
            `Could not blacklist prior access JWTs for user ${userId} after revoking an unverified account — they stay valid up to ${JWT_TTL_SECONDS}s`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    }
  }

  /**
   * Best effort: a failure here must not block sign-in. Without the refresh
   * token, account deletion skips the Apple revoke (logged there).
   */
  private async storeAppleRefreshToken(
    sub: string,
    code: string,
  ): Promise<void> {
    try {
      const { refreshToken, sub: codeSub } =
        await this.appleTokens.exchangeCode(code);
      if (codeSub !== sub) {
        // The code must belong to the identity that just signed in; otherwise
        // we would attach someone else's refresh token to this account.
        this.logger.warn(
          `Apple code exchange skipped — code subject does not match the id token (sub ${truncateSub(sub)})`,
        );
        return;
      }
      if (!refreshToken) {
        this.logger.warn(
          `Apple code exchange returned no refresh token (sub ${truncateSub(sub)})`,
        );
        return;
      }
      await this.prisma.account.update({
        where: {
          providerId_accountId: { providerId: 'apple', accountId: sub },
        },
        data: { refreshToken },
      });
    } catch (error) {
      this.logger.warn(
        `Apple code exchange failed (sub ${truncateSub(sub)}) — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async signedAvatar(
    value: string | null | undefined,
  ): Promise<string | null> {
    if (!value) return null;
    try {
      return await this.fileStorage.getSignedDownloadUrl(
        StorageBucketAlias.USER_PROFILES,
        value,
        { expiresInSeconds: SocialSignInService.PRIVATE_ASSET_URL_TTL_SECONDS },
      );
    } catch (error) {
      this.logger.warn(
        'Failed to sign the profile picture URL; returning the stored value',
        error,
      );
      return value;
    }
  }
}

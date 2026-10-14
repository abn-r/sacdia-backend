import { Inject, Injectable, Logger } from '@nestjs/common';
import { BetterAuthService } from '../../better-auth/better-auth.service';
import { AppUnauthorizedException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../../common/services/file-storage.service';
import type { FileStorageService } from '../../common/services/file-storage.service';
import { PrismaService } from '../../prisma/prisma.service';
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
  ) {
    this.verifiers = { google, apple };
  }

  async signIn(
    provider: SocialProvider,
    dto: SocialTokenSignInDto,
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

    const identity: VerifiedIdentity =
      provider === 'apple' && dto.fullName
        ? {
            ...verified,
            givenName: dto.fullName.givenName,
            familyName: dto.fullName.familyName,
          }
        : verified;

    const { userId, created, linked } = await this.resolver.resolve(identity);

    if (provider === 'apple' && dto.authorizationCode) {
      await this.storeAppleRefreshToken(identity.sub, dto.authorizationCode);
    }

    const session = await this.betterAuth.createSession(userId);
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
      false,
      session.id,
    );

    this.logger.log(
      `${provider} sign-in for user ${userId} (created=${created} linked=${linked})`,
    );

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
   * Best effort: a failure here must not block sign-in. Without the refresh
   * token, account deletion skips the Apple revoke (logged there).
   */
  private async storeAppleRefreshToken(
    sub: string,
    code: string,
  ): Promise<void> {
    try {
      const { refreshToken } = await this.appleTokens.exchangeCode(code);
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

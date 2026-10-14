import { Injectable, Logger } from '@nestjs/common';
import { AppBadRequestException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Connected OAuth providers (`accounts` table).
 *
 * Sign-in is handled by SocialSignInService. This service only reads and
 * removes provider links for an authenticated user.
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  /** Providers supported for connect/disconnect operations. */
  private static readonly VALID_PROVIDERS = ['google', 'apple'] as const;

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Connected providers — accounts table (BA-managed)
  // ---------------------------------------------------------------------------

  /**
   * Returns the list of OAuth providers connected to a user.
   *
   * Queries the `accounts` table WHERE userId = userId and returns the
   * providerId array. The `accounts` table is the canonical source of
   * truth — populated by BA when the user authenticates via a social
   * provider.
   */
  async getConnectedProviders(userId: string): Promise<string[]> {
    const accounts = await this.prisma.account.findMany({
      where: { userId },
      select: { providerId: true },
    });

    // Filter out the 'credential' provider (email+password) — not an OAuth provider
    return accounts.map((a) => a.providerId).filter((p) => p !== 'credential');
  }

  /**
   * Disconnects an OAuth provider from a user.
   *
   * Deletes the row from the `accounts` table WHERE userId AND providerId.
   * This properly removes the OAuth link — not just a flag update.
   * If the user has no other auth method (no password account), we refuse
   * to prevent account lockout.
   */
  async disconnectProvider(userId: string, provider: string) {
    const validProviders = OAuthService.VALID_PROVIDERS as readonly string[];
    if (!validProviders.includes(provider)) {
      throw new AppBadRequestException(ErrorCode.AUTH_OAUTH_PROVIDER_INVALID, {
        provider,
        valid: OAuthService.VALID_PROVIDERS.join(', '),
      });
    }

    // Safety check: ensure the user retains at least one authentication method
    const allAccounts = await this.prisma.account.findMany({
      where: { userId },
      select: { providerId: true },
    });

    const hasPasswordAccount = allAccounts.some(
      (a) => a.providerId === 'credential',
    );
    const hasOtherOAuth =
      allAccounts.filter(
        (a) => a.providerId !== 'credential' && a.providerId !== provider,
      ).length > 0;

    if (!hasPasswordAccount && !hasOtherOAuth) {
      throw new AppBadRequestException(ErrorCode.AUTH_OAUTH_ONLY_AUTH_METHOD);
    }

    const deleted = await this.prisma.account.deleteMany({
      where: { userId, providerId: provider },
    });

    if (deleted.count === 0) {
      throw new AppBadRequestException(
        ErrorCode.AUTH_OAUTH_PROVIDER_NOT_CONNECTED,
        { provider },
      );
    }

    this.logger.log(`Provider ${provider} disconnected for user: ${userId}`);

    return {
      success: true,
      message: 'Provider desconectado exitosamente',
    };
  }
}

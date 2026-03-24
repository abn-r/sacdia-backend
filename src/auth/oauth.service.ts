import {
  Injectable,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BetterAuthService } from '../better-auth/better-auth.service';
import { OAuthCallbackDto } from './dto/oauth-callback.dto';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';

/**
 * OAuthService — Better Auth edition (W3-008 Part 3)
 *
 * ## Design: Option A hybrid
 *
 * Better Auth owns the OAuth code exchange.  Its HTTP handler at
 * `GET /api/auth/callback/{provider}` is browser-facing: it receives
 * `code` + `state` from the provider, verifies against the stored state,
 * creates/updates the `users` and `accounts` rows, and issues an opaque
 * session token via a Set-Cookie header.
 *
 * Our role in the OAuth flow:
 *   1. **Initiate** — return the provider authorization URL via `getOAuthUrl`.
 *   2. **Finalise** — client sends us the opaque BA session token after BA has
 *      processed the callback; we look up the session, provision the SACDIA
 *      user row if needed, and sign our HS256 JWT.
 *
 * Connected-provider data lives in the `accounts` table (BA-managed).
 * The old boolean flags `google_connected`, `apple_connected`, `fb_connected`
 * are removed from the schema and from this service.
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private static readonly PRIVATE_ASSET_URL_TTL_SECONDS = 300;

  /** Providers supported for connect/disconnect operations. */
  private static readonly VALID_PROVIDERS = ['google', 'apple'] as const;
  private static readonly DEFAULT_REDIRECT_URL = 'https://sacdia.app/auth/callback';

  constructor(
    private readonly prisma: PrismaService,
    private readonly betterAuth: BetterAuthService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  // ---------------------------------------------------------------------------
  // OAuth initiation
  // ---------------------------------------------------------------------------

  /**
   * Returns the Google OAuth authorization URL.
   *
   * BEFORE: supabase.admin.auth.signInWithOAuth({ provider: 'google', ... })
   * AFTER:  betterAuth.getOAuthUrl('google', redirectTo)
   *
   * The client must redirect the user's browser to the returned `url`.
   * BA will handle the code exchange at its callback route and then redirect
   * the browser to `redirectTo` (our mobile deep-link or admin URL).
   */
  async initiateGoogleSignIn(redirectUrl?: string) {
    const callbackUrl = redirectUrl ?? OAuthService.DEFAULT_REDIRECT_URL;
    this.logger.log(`Initiating Google OAuth — callbackUrl: ${callbackUrl}`);

    const { url } = await this.betterAuth.getOAuthUrl('google', callbackUrl);
    return { url };
  }

  /**
   * Returns the Apple OAuth authorization URL.
   *
   * BEFORE: supabase.admin.auth.signInWithOAuth({ provider: 'apple', ... })
   * AFTER:  betterAuth.getOAuthUrl('apple', redirectTo)
   */
  async initiateAppleSignIn(redirectUrl?: string) {
    const callbackUrl = redirectUrl ?? OAuthService.DEFAULT_REDIRECT_URL;
    this.logger.log(`Initiating Apple OAuth — callbackUrl: ${callbackUrl}`);

    const { url } = await this.betterAuth.getOAuthUrl('apple', callbackUrl);
    return { url };
  }

  // ---------------------------------------------------------------------------
  // OAuth callback finalisation
  // ---------------------------------------------------------------------------

  /**
   * Finalises the OAuth flow after Better Auth has processed the provider callback.
   *
   * ## Flow
   * 1. Client receives a BA session token (from BA's Set-Cookie or URL fragment)
   *    after the browser hits `GET /api/auth/callback/{provider}`.
   * 2. Client POSTs that session token here.
   * 3. We call `refreshSession` to validate the token and get the BA user.
   * 4. We ensure the SACDIA `users` row exists (auto-provision on first login).
   * 5. We sign and return our HS256 JWT.
   *
   * BEFORE: received Supabase `access_token`, called supabase.admin.auth.getUser(),
   *         updated `google_connected`/`apple_connected` boolean flags.
   * AFTER:  receives BA opaque session token, validates via BetterAuthService,
   *         reads connected providers from the `accounts` table.
   *
   * NOTE: `createUserFromOAuth` is intentionally kept for SACDIA-specific
   * provisioning (users_pr, users_roles) that BA does not handle.
   * BA already created the `users` row via its Prisma adapter; we only add
   * the SACDIA-specific rows that BA knows nothing about.
   */
  async handleCallback(dto: OAuthCallbackDto) {
    // 1. Validate the BA session token and get the user.
    // refreshSession calls getSessionFromToken internally — it will throw
    // UnauthorizedException if the token is invalid or expired.
    const { user: baUser, session: baSession, accessToken } =
      await this.betterAuth.refreshSession(dto.session_token);

    // 2. Ensure SACDIA-specific rows exist (users_pr, users_roles)
    await this.ensureSacdiaUserProvisioned(baUser.id, baUser.email, baUser.name, baUser.image);

    // 3. Load the full SACDIA user row for the response
    const dbUser = await this.prisma.users.findUnique({
      where: { user_id: baUser.id },
    });

    // 4. Determine post-registration state
    const userPr = await this.prisma.users_pr.findUnique({
      where: { user_id: baUser.id },
    });

    // 5. Resolve avatar (may be a private R2 path)
    const avatar = await this.resolvePrivateProfilePicture(dbUser?.user_image);

    // 6. Get connected providers from accounts table
    const connectedProviders = await this.getConnectedProviders(baUser.id);

    return {
      accessToken,
      sessionToken: baSession.token,
      user: {
        id: baUser.id,
        email: baUser.email,
        name: dbUser?.name ?? baUser.name,
        paternal_last_name: dbUser?.paternal_last_name ?? null,
        maternal_last_name: dbUser?.maternal_last_name ?? null,
        avatar,
        connectedProviders,
      },
      needsPostRegistration: !userPr?.complete,
    };
  }

  // ---------------------------------------------------------------------------
  // Connected providers — accounts table (BA-managed)
  // ---------------------------------------------------------------------------

  /**
   * Returns the list of OAuth providers connected to a user.
   *
   * BEFORE: read `google_connected`, `apple_connected`, `fb_connected` boolean
   *         columns from the `users` table.
   * AFTER:  query `accounts` table WHERE userId = userId, return providerId array.
   *
   * The `accounts` table is the canonical source of truth — populated by BA
   * when the user authenticates via a social provider.
   */
  async getConnectedProviders(userId: string): Promise<string[]> {
    const accounts = await this.prisma.account.findMany({
      where: { userId },
      select: { providerId: true },
    });

    // Filter out the 'credential' provider (email+password) — not an OAuth provider
    return accounts
      .map((a) => a.providerId)
      .filter((p) => p !== 'credential');
  }

  /**
   * Disconnects an OAuth provider from a user.
   *
   * BEFORE: set `google_connected = false` / `apple_connected = false` in `users`.
   * AFTER:  delete the row from the `accounts` table WHERE userId AND providerId.
   *
   * This properly removes the OAuth link — not just a flag update.
   * If the user has no other auth method (no password account), we refuse
   * to prevent account lockout.
   */
  async disconnectProvider(userId: string, provider: string) {
    const validProviders = OAuthService.VALID_PROVIDERS as readonly string[];
    if (!validProviders.includes(provider)) {
      throw new BadRequestException(
        `Provider inválido. Usa: ${OAuthService.VALID_PROVIDERS.join(', ')}`,
      );
    }

    // Safety check: ensure the user retains at least one authentication method
    const allAccounts = await this.prisma.account.findMany({
      where: { userId },
      select: { providerId: true },
    });

    const hasPasswordAccount = allAccounts.some((a) => a.providerId === 'credential');
    const hasOtherOAuth = allAccounts
      .filter((a) => a.providerId !== 'credential' && a.providerId !== provider)
      .length > 0;

    if (!hasPasswordAccount && !hasOtherOAuth) {
      throw new BadRequestException(
        'No podés desconectar el único método de autenticación. ' +
          'Configurá una contraseña primero.',
      );
    }

    const deleted = await this.prisma.account.deleteMany({
      where: { userId, providerId: provider },
    });

    if (deleted.count === 0) {
      throw new BadRequestException(
        `El provider '${provider}' no está conectado a esta cuenta.`,
      );
    }

    this.logger.log(`Provider ${provider} disconnected for user: ${userId}`);

    return {
      success: true,
      message: 'Provider desconectado exitosamente',
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Ensures SACDIA-specific rows exist for an OAuth user.
   *
   * BA's Prisma adapter creates the `users` row automatically when an OAuth
   * user logs in for the first time.  However, SACDIA requires additional rows
   * that BA knows nothing about: `users_pr` (post-registration state) and
   * `users_roles` (default role assignment).
   *
   * This method is idempotent — safe to call on every login.
   *
   * BEFORE: `createUserFromOAuth()` — called only when the user didn't exist.
   * AFTER:  Called on every OAuth callback, creates missing rows if needed.
   */
  private async ensureSacdiaUserProvisioned(
    userId: string,
    email: string,
    name: string,
    image?: string | null,
  ) {
    await this.prisma.$transaction(async (tx) => {
      // BA already created the `users` row via its Prisma adapter.
      // Confirm it exists (defensive check).
      const user = await tx.users.findUnique({
        where: { user_id: userId },
      });

      if (!user) {
        // This should not happen — BA's Prisma adapter creates the row.
        // If it does, create it as a fallback.
        this.logger.warn(
          `BA did not create users row for ${userId} — creating manually`,
        );
        await tx.users.create({
          data: {
            user_id: userId,
            email,
            name: name || email.split('@')[0],
            user_image: image ?? null,
          },
        });
      } else if (image && image !== user.user_image) {
        // BA's Prisma adapter does NOT reliably write user_image on OAuth user
        // creation (field mapping only applies to READs, not WRITEs — see
        // better-auth.config.ts). Sync the OAuth profile photo on every login
        // so the column is always up-to-date, even when the user updates their
        // Google/Apple profile picture.
        this.logger.log(
          `Syncing OAuth profile image for user: ${userId}`,
        );
        await tx.users.update({
          where: { user_id: userId },
          data: { user_image: image },
        });
      }

      // Ensure users_pr row exists
      const existingPr = await tx.users_pr.findUnique({
        where: { user_id: userId },
      });

      if (!existingPr) {
        this.logger.log(`Creating users_pr for OAuth user: ${userId}`);
        await tx.users_pr.create({
          data: {
            user_id: userId,
            complete: false,
            profile_picture_complete: false,
            personal_info_complete: false,
            club_selection_complete: false,
          },
        });
      }

      // Ensure default role assignment exists
      const existingRole = await tx.users_roles.findFirst({
        where: { user_id: userId },
      });

      if (!existingRole) {
        this.logger.log(`Assigning default role for OAuth user: ${userId}`);
        const userRole = await tx.roles.findFirst({
          where: {
            role_name: 'user',
            role_category: 'GLOBAL',
          },
        });

        if (!userRole) {
          this.logger.error('Default "user" role not found in DB');
          // Do not throw — role assignment is not critical enough to fail login
          return;
        }

        await tx.users_roles.create({
          data: {
            user_id: userId,
            role_id: userRole.role_id,
          },
        });
      }
    });
  }

  private async resolvePrivateProfilePicture(
    value: string | null | undefined,
  ): Promise<string | null> {
    if (!value) return null;

    try {
      return await this.fileStorage.getSignedDownloadUrl(
        StorageBucketAlias.USER_PROFILES,
        value,
        {
          expiresInSeconds: OAuthService.PRIVATE_ASSET_URL_TTL_SECONDS,
        },
      );
    } catch (error) {
      this.logger.warn(
        'Failed to generate signed URL for OAuth profile picture. Returning original value.',
        error,
      );
      return value;
    }
  }
}

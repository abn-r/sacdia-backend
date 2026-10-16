import { Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import { Inject } from '@nestjs/common';
import { EmailService } from '../common/email/email.service';
import { HttpStatus } from '@nestjs/common';
import {
  AppBadRequestException,
  AppException,
  AppNotFoundException,
  AppUnauthorizedException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { TokenBlacklistService } from '../common/services/token-blacklist.service';
import { totpIdentifier } from '../better-auth/better-auth.service';
import { GuardianshipLifecycleService } from '../guardianships/guardianship-lifecycle.service';
import { AppleTokenClient } from './social-sign-in/apple-token.client';
import {
  APPLE_ID_TOKEN_VERIFIER,
  GOOGLE_ID_TOKEN_VERIFIER,
  type IdTokenVerifier,
  type SocialProvider,
} from './social-sign-in/social-sign-in.types';

/**
 * Access JWT lifetime. Mirrors `AuthService.JWT_TTL_SECONDS` (private there);
 * a blacklist entry only has to outlive the longest-lived token.
 */
const JWT_TTL_SECONDS = 28800;

export type DeleteAccountReauth =
  | { password: string }
  | { provider: SocialProvider; idToken: string; nonce: string };

export interface DeleteAccountOptions {
  /**
   * The user saw what happens to each minor in their care (see
   * GET /guardianships/me/deletion-impact) and accepts it. Required when
   * dependents exist.
   */
  acknowledgeDependents?: boolean;
}

/**
 * Handles the full account deletion lifecycle for self-service requests
 * from the mobile app Settings > Danger Zone.
 *
 * Required by Apple App Store guideline 5.1.1(v).
 *
 * Flow:
 *   1. Re-authenticate: current password, or a fresh provider id token for a
 *      linked account; revoke the Apple refresh token when present
 *   1c. Guardians: if the user has dependents and did not acknowledge them,
 *      409 AUTH_DELETE_DEPENDENTS_ACK_REQUIRED and NOTHING changes
 *   2. In a single DB transaction:
 *      0. Detach the user as guardian ('guardian_account_closed'): each minor
 *         goes to another guardian, to club custody, or is frozen for 90 days.
 *         A failure here rolls back the whole deletion.
 *      a. Revoke all BA sessions (DELETE FROM sessions WHERE user_id = ?)
 *      b. Soft-delete user (active = false)
 *      c. Anonymize PII fields to comply with GDPR/data minimization
 *      d. Deactivate all FCM tokens to prevent ghost notifications
 *      e. Delete all notification preferences (cascade handled by FK)
 *      f. Delete the TOTP secret and backup codes (verification row)
 *      g. Log deletion in account_deletion_log
 *   2b. Blacklist every access JWT of the user (best effort)
 *   3. Delete profile picture from R2 (fire-and-forget — outside transaction)
 *   4. Structured audit log
 *
 * GDPR note: Email is anonymized to `deleted-{user_id}@sacdia.deleted`
 * to preserve uniqueness constraint while removing identifiable data.
 * Hard-delete of relational data (honors, classes, etc.) is intentionally
 * NOT done here — that requires a separate retention policy decision
 * agreed with legal/data controller. Only PII on the users row is wiped.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  private readonly verifiers: Record<SocialProvider, IdTokenVerifier>;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
    private readonly emailService: EmailService,
    @Inject(GOOGLE_ID_TOKEN_VERIFIER) google: IdTokenVerifier,
    @Inject(APPLE_ID_TOKEN_VERIFIER) apple: IdTokenVerifier,
    private readonly appleTokens: AppleTokenClient,
    private readonly tokenBlacklist: TokenBlacklistService,
    private readonly guardianshipLifecycle: GuardianshipLifecycleService,
  ) {
    this.verifiers = { google, apple };
  }

  /**
   * Delete the account for the given userId after re-authenticating.
   *
   * @param userId - The user_id of the authenticated caller (from JWT sub)
   * @param reauth - Current password, or a fresh provider id token + nonce
   * @param ipAddress - Caller IP for audit log (optional)
   */
  async deleteAccount(
    userId: string,
    reauth: DeleteAccountReauth,
    ipAddress?: string,
    options: DeleteAccountOptions = {},
  ): Promise<void> {
    // -------------------------------------------------------------------------
    // 1. Load user and linked accounts, re-authenticate
    // -------------------------------------------------------------------------
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: {
        user_id: true,
        email: true,
        active: true,
        user_image: true,
      },
    });

    if (!user) {
      throw new AppNotFoundException(ErrorCode.AUTH_ACCOUNT_NOT_FOUND, {
        userId,
      });
    }

    if (!user.active) {
      throw new AppBadRequestException(ErrorCode.AUTH_ACCOUNT_ALREADY_DELETED, {
        userId,
      });
    }

    const accounts = await this.prisma.account.findMany({
      where: { userId },
      select: {
        providerId: true,
        accountId: true,
        password: true,
        refreshToken: true,
      },
    });

    if ('password' in reauth) {
      const credential = accounts.find((a) => a.providerId === 'credential');
      if (!credential?.password) {
        // Social-only account: the client must re-auth with the provider.
        throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_PASSWORD);
      }
      const isPasswordValid = await bcrypt.compare(
        reauth.password,
        credential.password,
      );
      if (!isPasswordValid) {
        throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_PASSWORD);
      }
    } else {
      const identity = await this.verifiers[reauth.provider].verify(
        reauth.idToken,
        reauth.nonce,
      );
      const linked = accounts.some(
        (a) => a.providerId === reauth.provider && a.accountId === identity.sub,
      );
      if (!linked) {
        this.logger.warn(
          `Account deletion re-auth rejected for ${userId} — ${reauth.provider} token belongs to another subject`,
        );
        throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_TOKEN);
      }
    }

    // -------------------------------------------------------------------------
    // 1c. Guardians must acknowledge their dependents BEFORE anything is
    //     revoked or deleted (Apple revoke included). The count is only for
    //     logs and the dev-only `details`; clients read the minors and their
    //     outcomes from GET /guardianships/me/deletion-impact.
    // -------------------------------------------------------------------------
    if (options.acknowledgeDependents !== true) {
      const impact = await this.guardianshipLifecycle.deletionImpact(userId);
      if (impact.dependents.length > 0) {
        throw new AppException(
          ErrorCode.AUTH_DELETE_DEPENDENTS_ACK_REQUIRED,
          HttpStatus.CONFLICT,
          undefined,
          { dependents_count: impact.dependents.length },
        );
      }
    }

    // -------------------------------------------------------------------------
    // 1b. Revoke Sign in with Apple (App Store 5.1.1(v)). Best effort: a
    //     failure is logged and the deletion continues.
    // -------------------------------------------------------------------------
    const apple = accounts.find((a) => a.providerId === 'apple');
    if (apple?.refreshToken) {
      try {
        await this.appleTokens.revoke(apple.refreshToken);
      } catch (error) {
        this.logger.warn(
          `Apple token revoke failed for ${userId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else if (apple) {
      this.logger.warn(
        `Apple account for ${userId} has no refresh token — skipping revoke`,
      );
    }

    // -------------------------------------------------------------------------
    // 2. Transactional soft-delete + PII anonymization
    // -------------------------------------------------------------------------
    // Capture original email BEFORE anonymization — needed for the confirmation email.
    const originalEmail = user.email;
    const anonymizedEmail = `deleted-${userId}@sacdia.deleted`;
    const now = new Date();

    const detached = await this.prisma.$transaction(async (tx) => {
      // 2-pre. The guardian leaves every minor in its care in the SAME
      //        transaction: if any outcome cannot be applied the account stays.
      const detachedDependents =
        await this.guardianshipLifecycle.detachGuardian(
          tx,
          userId,
          'guardian_account_closed',
        );

      // 2a. Revoke all BA sessions
      await tx.session.deleteMany({ where: { userId } });

      // 2b. Deactivate all FCM tokens
      await tx.user_fcm_tokens.updateMany({
        where: { user_id: userId },
        data: { active: false },
      });

      // 2c. Soft-delete + PII anonymization on users row
      await tx.users.update({
        where: { user_id: userId },
        data: {
          active: false,
          email: anonymizedEmail,
          name: null,
          paternal_last_name: null,
          maternal_last_name: null,
          birthday: null,
          blood: null,
          user_image: null,
          gender: null,
          baptism_date: null,
          country_id: null,
          union_id: null,
          local_field_id: null,
        },
      });

      // 2c-bis. Remove the TOTP secret and hashed backup codes
      await tx.verification.deleteMany({
        where: { identifier: totpIdentifier(userId) },
      });

      // 2d. Remove credential account password hash (hard-delete account row)
      await tx.account.deleteMany({ where: { userId } });

      // 2d-bis. Erase the IP and device kept with each legal acceptance; the
      //         acceptance itself (document, version, date) stays on the
      //         anonymized user as consent history.
      await tx.legal_acceptances.updateMany({
        where: { user_id: userId },
        data: { ip_address: null, user_agent: null },
      });

      // 2e. Audit log in account_deletion_log
      await tx.account_deletion_log.create({
        data: {
          user_id: userId,
          requested_at: now,
          ip_address: ipAddress ?? null,
          completed_at: now,
        },
      });

      return detachedDependents;
    });

    // The deletion committed: moved/frozen dependents lose the guardian's
    // acting access on their next request, and club directors hear about
    // custody. Never throws.
    await this.guardianshipLifecycle.afterCommit(detached);

    // -------------------------------------------------------------------------
    // 2b. End every access JWT. JwtStrategy does not check users.active, so
    //     without this they stay valid until they expire. The account is
    //     already gone: a blacklist failure must not fail the request. No new
    //     token can follow, so tokens issued in this same second go too.
    // -------------------------------------------------------------------------
    try {
      await this.tokenBlacklist.blacklistAllUserTokens(
        userId,
        JWT_TTL_SECONDS,
        { includeCurrentSecond: true },
      );
    } catch (error) {
      this.logger.error(
        `Could not blacklist access JWTs for deleted user ${userId} — they stay valid up to ${JWT_TTL_SECONDS}s: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // -------------------------------------------------------------------------
    // 3. Delete profile picture from R2 (fire-and-forget, outside transaction)
    //    user_image was captured before the transaction nulled it
    // -------------------------------------------------------------------------
    if (user.user_image) {
      this.deleteProfilePictureFromR2(user.user_image).catch((err) => {
        this.logger.warn(
          `Failed to delete profile picture from R2 for deleted user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }

    // -------------------------------------------------------------------------
    // 3b. Deletion confirmation email (fire-and-forget)
    //     Sent to the ORIGINAL email captured before anonymization.
    //     EMAIL_ENABLED gate is enforced at processor level.
    // -------------------------------------------------------------------------
    if (originalEmail) {
      this.emailService
        .sendAccountDeletionConfirmed({ email: originalEmail })
        .catch((err: Error) => {
          this.logger.warn(
            `Failed to enqueue account deletion email for deleted user ${userId}: ${err.message}`,
          );
        });
    }

    // -------------------------------------------------------------------------
    // 4. Structured audit log
    // -------------------------------------------------------------------------
    this.logger.warn(
      JSON.stringify({
        event: 'account_deleted',
        user_id: userId,
        ip: ipAddress ?? 'unknown',
        timestamp: now.toISOString(),
      }),
    );
  }

  private async deleteProfilePictureFromR2(userImage: string): Promise<void> {
    const key = this.fileStorage.extractKeyFromPublicUrl(
      StorageBucketAlias.USER_PROFILES,
      userImage,
    );
    const keyToDelete = key ?? userImage;

    await this.fileStorage.deleteMany(StorageBucketAlias.USER_PROFILES, [
      keyToDelete,
    ]);
  }
}

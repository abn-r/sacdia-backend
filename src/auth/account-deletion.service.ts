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
import {
  AppBadRequestException,
  AppNotFoundException,
  AppUnauthorizedException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

/**
 * Handles the full account deletion lifecycle for self-service requests
 * from the mobile app Settings > Danger Zone.
 *
 * Required by Apple App Store guideline 5.1.1(v).
 *
 * Flow:
 *   1. Re-authenticate: verify current password against credential account
 *   2. In a single DB transaction:
 *      a. Revoke all BA sessions (DELETE FROM sessions WHERE user_id = ?)
 *      b. Soft-delete user (active = false)
 *      c. Anonymize PII fields to comply with GDPR/data minimization
 *      d. Deactivate all FCM tokens to prevent ghost notifications
 *      e. Delete all notification preferences (cascade handled by FK)
 *      f. Log deletion in account_deletion_log
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

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Delete the account for the given userId after re-authenticating with password.
   *
   * @param userId - The user_id of the authenticated caller (from JWT sub)
   * @param password - Current password provided in request body for re-auth
   * @param ipAddress - Caller IP for audit log (optional)
   */
  async deleteAccount(
    userId: string,
    password: string,
    ipAddress?: string,
  ): Promise<void> {
    // -------------------------------------------------------------------------
    // 1. Load user and credential account
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

    // Re-authenticate: require credential account with a valid password
    const credentialAccount = await this.prisma.account.findFirst({
      where: { userId, providerId: 'credential' },
      select: { password: true },
    });

    if (!credentialAccount || !credentialAccount.password) {
      // User signed up via OAuth only — no password set.
      // For OAuth-only users, skip password re-auth (they can't supply one).
      // The JWT guard already verified identity; this is acceptable for GDPR compliance.
      this.logger.warn(
        `Account deletion requested for OAuth-only user ${userId} — skipping password re-auth`,
      );
    } else {
      const isPasswordValid = await bcrypt.compare(
        password,
        credentialAccount.password,
      );
      if (!isPasswordValid) {
        throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_PASSWORD);
      }
    }

    // -------------------------------------------------------------------------
    // 2. Transactional soft-delete + PII anonymization
    // -------------------------------------------------------------------------
    // Capture original email BEFORE anonymization — needed for the confirmation email.
    const originalEmail = user.email;
    const anonymizedEmail = `deleted-${userId}@sacdia.deleted`;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
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

      // 2d. Remove credential account password hash (hard-delete account row)
      await tx.account.deleteMany({ where: { userId } });

      // 2e. Audit log in account_deletion_log
      await tx.account_deletion_log.create({
        data: {
          user_id: userId,
          requested_at: now,
          ip_address: ipAddress ?? null,
          completed_at: now,
        },
      });
    });

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

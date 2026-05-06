import { Injectable, Logger } from '@nestjs/common';
import {
  AppBadRequestException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { BetterAuthService } from '../better-auth/better-auth.service';

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface AdminSessionDto {
  sessionId: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AdminSessionListDto {
  userId: string;
  totalSessions: number;
  sessions: AdminSessionDto[];
}

export interface AdminMfaStatusDto {
  userId: string;
  mfaEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * AdminAuthService — Admin-scoped session and MFA management.
 *
 * This service operates on OTHER users' sessions and MFA — not the caller's own.
 * All operations require admin/super-admin role (enforced at controller level).
 *
 * Session data is read/written directly from the Prisma `session` table.
 * MFA (TOTP) data lives in the `verification` table via BetterAuthService.
 * Password updates go through BetterAuthService.updatePasswordById() which
 * writes directly to the `account` table — no BA admin plugin required.
 *
 * NOTE: The Better Auth admin() plugin is NOT needed here. The entire auth
 * stack bypasses BA for CRUD operations and operates directly on Prisma.
 * See better-auth.config.ts and better-auth.service.ts for context.
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  // TOTP identifier format matches BetterAuthService.totpIdentifier()
  private readonly TOTP_IDENTIFIER_PREFIX = 'totp:';

  constructor(
    private readonly prisma: PrismaService,
    private readonly betterAuthService: BetterAuthService,
  ) {}

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  /**
   * Lists all active (non-expired) sessions for a target user.
   *
   * @param targetUserId - UUID of the user whose sessions to list.
   */
  async listUserSessions(targetUserId: string): Promise<AdminSessionListDto> {
    await this.assertUserExists(targetUserId);

    const sessions = await this.prisma.session.findMany({
      where: {
        userId: targetUserId,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        createdAt: true,
        expiresAt: true,
        ipAddress: true,
        userAgent: true,
      },
    });

    const mapped: AdminSessionDto[] = sessions.map((s) => ({
      sessionId: s.id,
      userId: s.userId,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      ipAddress: s.ipAddress ?? null,
      userAgent: s.userAgent ?? null,
    }));

    this.logger.log(
      `Admin listed ${mapped.length} sessions for user ${targetUserId}`,
    );

    return {
      userId: targetUserId,
      totalSessions: mapped.length,
      sessions: mapped,
    };
  }

  /**
   * Revokes a specific session for a target user.
   *
   * @param targetUserId - UUID of the user who owns the session.
   * @param sessionId    - ID of the session to revoke.
   */
  async revokeUserSession(
    targetUserId: string,
    sessionId: string,
  ): Promise<void> {
    await this.assertUserExists(targetUserId);

    // Verify the session belongs to this user before deletion
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId: targetUserId },
      select: { id: true },
    });

    if (!session) {
      throw new AppNotFoundException(ErrorCode.ADMIN_SESSION_NOT_FOUND, {
        sessionId,
        userId: targetUserId,
      });
    }

    await this.prisma.session.delete({ where: { id: sessionId } });

    this.logger.log(
      `Admin revoked session ${sessionId} for user ${targetUserId}`,
    );
  }

  /**
   * Revokes ALL sessions for a target user (force logout from all devices).
   *
   * @param targetUserId - UUID of the user whose sessions to revoke.
   * @returns Number of sessions revoked.
   */
  async revokeAllUserSessions(targetUserId: string): Promise<number> {
    await this.assertUserExists(targetUserId);

    const result = await this.prisma.session.deleteMany({
      where: { userId: targetUserId },
    });

    this.logger.log(
      `Admin revoked ${result.count} sessions for user ${targetUserId}`,
    );

    return result.count;
  }

  // ---------------------------------------------------------------------------
  // MFA management
  // ---------------------------------------------------------------------------

  /**
   * Returns the MFA (TOTP) enrollment status for a target user.
   *
   * @param targetUserId - UUID of the user to check.
   */
  async getUserMfaStatus(targetUserId: string): Promise<AdminMfaStatusDto> {
    await this.assertUserExists(targetUserId);

    const { enabled } =
      await this.betterAuthService.hasTotpEnabled(targetUserId);

    this.logger.log(
      `Admin checked MFA status for user ${targetUserId}: ${enabled}`,
    );

    return { userId: targetUserId, mfaEnabled: enabled };
  }

  /**
   * Disables (resets) MFA for a target user without requiring their password.
   *
   * This is an admin override — no password confirmation needed.
   * It deletes the TOTP record from the verification table.
   *
   * @param targetUserId - UUID of the user whose MFA to reset.
   */
  async resetUserMfa(targetUserId: string): Promise<void> {
    await this.assertUserExists(targetUserId);

    const { enabled } =
      await this.betterAuthService.hasTotpEnabled(targetUserId);

    if (!enabled) {
      throw new AppBadRequestException(ErrorCode.ADMIN_USER_MFA_NOT_ENABLED, {
        userId: targetUserId,
      });
    }

    // Delete directly — admin override, no password check
    const identifier = `${this.TOTP_IDENTIFIER_PREFIX}${targetUserId}`;
    await this.prisma.verification.deleteMany({ where: { identifier } });

    this.logger.log(`Admin reset MFA for user ${targetUserId}`);
  }

  // ---------------------------------------------------------------------------
  // Password management
  // ---------------------------------------------------------------------------

  /**
   * Updates the password for a target user without requiring their current password.
   *
   * Delegates to BetterAuthService.updatePasswordById() which writes directly
   * to the `account` table using bcrypt — no BA admin plugin required.
   *
   * @param targetUserId - UUID of the user whose password to update.
   * @param newPassword  - The new plain-text password (hashed inside service).
   */
  async setUserPassword(
    targetUserId: string,
    newPassword: string,
  ): Promise<void> {
    await this.assertUserExists(targetUserId);

    await this.betterAuthService.updatePasswordById(targetUserId, newPassword);

    this.logger.log(`Admin updated password for user ${targetUserId}`);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: { user_id: true },
    });

    if (!user) {
      throw new AppNotFoundException(ErrorCode.ADMIN_USER_NOT_FOUND, {
        userId,
      });
    }
  }
}

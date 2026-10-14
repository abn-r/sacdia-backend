import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppConflictException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../prisma/prisma.service';
import type { VerifiedIdentity } from './social-sign-in.types';

export interface ResolvedSocialAccount {
  userId: string;
  /** A users row was created in this call. */
  created: boolean;
  /** The provider was attached to an existing email account in this call. */
  linked: boolean;
  /**
   * The existing account never verified its email, so its sessions and every
   * credential/provider link were deleted. The caller must also invalidate the
   * JWTs already issued to that previous holder.
   */
  revokedPriorAccess: boolean;
}

/** `users.name` and `users.paternal_last_name` are VarChar(50). */
const NAME_MAX = 50;

/**
 * Maps a verified provider identity to a SACDIA user.
 *
 * Identity is `(provider, sub)` in `accounts` — never the email. Email is only
 * used to attach a provider to an existing account the first time (D3). An
 * existing local account that never verified its email loses its password on
 * link: the provider proved the address, the password owner never did.
 *
 * Everything runs in one transaction so a failure leaves no half-linked user.
 */
@Injectable()
export class SocialAccountResolver {
  private readonly logger = new Logger(SocialAccountResolver.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolve(identity: VerifiedIdentity): Promise<ResolvedSocialAccount> {
    return this.prisma.$transaction(async (tx) => {
      const result = await this.findOrCreate(tx, identity);
      await this.provisionSacdiaRows(tx, result.userId);
      return result;
    });
  }

  private async findOrCreate(
    tx: Prisma.TransactionClient,
    identity: VerifiedIdentity,
  ): Promise<ResolvedSocialAccount> {
    const { provider, sub } = identity;

    // 1. Returning user
    const account = await tx.account.findUnique({
      where: { providerId_accountId: { providerId: provider, accountId: sub } },
      select: { userId: true },
    });
    if (account) {
      await this.fillPictureIfEmpty(tx, account.userId, identity.picture);
      return {
        userId: account.userId,
        created: false,
        linked: false,
        revokedPriorAccess: false,
      };
    }

    // 2. Same email already registered → link
    const email = identity.email!; // SocialSignInService rejects null before resolving
    const existing = await tx.users.findUnique({
      where: { email },
      select: { user_id: true, email_verified: true, user_image: true },
    });
    if (existing) {
      const revokedPriorAccess = !existing.email_verified;
      if (revokedPriorAccess) {
        // D3: the unverified holder never proved the address. Whoever registered
        // it keeps nothing: no sessions, no password, no other provider links.
        await tx.session.deleteMany({ where: { userId: existing.user_id } });
        await tx.account.deleteMany({ where: { userId: existing.user_id } });
      } else {
        // A verified account keeps its links. A second identity from the same
        // provider (different sub) is never attached silently.
        const sameProvider = await tx.account.findFirst({
          where: { userId: existing.user_id, providerId: provider },
          select: { id: true },
        });
        if (sameProvider) {
          this.logger.warn(
            `${provider} sign-in refused — user ${existing.user_id} already linked to another ${provider} identity`,
          );
          throw new AppConflictException(
            ErrorCode.AUTH_OAUTH_PROVIDER_ALREADY_LINKED,
          );
        }
      }
      await tx.account.create({
        data: {
          id: randomUUID(),
          accountId: sub,
          providerId: provider,
          userId: existing.user_id,
        },
      });
      if (revokedPriorAccess) {
        await tx.users.update({
          where: { user_id: existing.user_id },
          data: {
            email_verified: true,
            ...(identity.picture && !existing.user_image
              ? { user_image: identity.picture }
              : {}),
          },
        });
        this.logger.warn(
          `Linked ${provider} to unverified account ${existing.user_id} — prior sessions and accounts removed`,
        );
      } else {
        await this.fillPictureIfEmpty(
          tx,
          existing.user_id,
          identity.picture,
          existing.user_image,
        );
      }
      this.logger.log(
        `Linked ${provider} to existing user ${existing.user_id}`,
      );
      return {
        userId: existing.user_id,
        created: false,
        linked: true,
        revokedPriorAccess,
      };
    }

    // 3. New user
    const userId = randomUUID();
    await tx.users.create({
      data: {
        user_id: userId,
        email,
        name: (identity.givenName ?? email.split('@')[0]).slice(0, NAME_MAX),
        paternal_last_name: identity.familyName?.slice(0, NAME_MAX) ?? null,
        email_verified: true,
        user_image: identity.picture ?? null,
      },
    });
    await tx.account.create({
      data: { id: randomUUID(), accountId: sub, providerId: provider, userId },
    });
    this.logger.log(`Created user ${userId} from ${provider}`);
    return { userId, created: true, linked: false, revokedPriorAccess: false };
  }

  /**
   * Seeds `user_image` from the provider photo only while the user has none.
   * Never overwrites: post-registration stores the user's own upload (an R2
   * key) in the same column, and that choice must survive the next sign-in.
   */
  private async fillPictureIfEmpty(
    tx: Prisma.TransactionClient,
    userId: string,
    picture: string | undefined,
    current?: string | null,
  ): Promise<void> {
    if (!picture) return;
    if (current === undefined) {
      const user = await tx.users.findUnique({
        where: { user_id: userId },
        select: { user_image: true },
      });
      current = user?.user_image ?? null;
    }
    if (current) return;
    await tx.users.update({
      where: { user_id: userId },
      data: { user_image: picture },
    });
  }

  /**
   * SACDIA rows the auth tables know nothing about: post-registration state
   * and the default global role. Idempotent. (Moved from
   * OAuthService.ensureSacdiaUserProvisioned.)
   */
  private async provisionSacdiaRows(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    const pr = await tx.users_pr.findUnique({ where: { user_id: userId } });
    if (!pr) {
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

    const role = await tx.users_roles.findFirst({ where: { user_id: userId } });
    if (role) return;
    const userRole = await tx.roles.findFirst({
      where: { role_name: 'user', role_category: 'GLOBAL' },
    });
    if (!userRole) {
      // Not fatal for login; the role seed is missing and must be fixed separately.
      this.logger.error('Default "user" role not found in DB');
      return;
    }
    await tx.users_roles.create({
      data: { user_id: userId, role_id: userRole.role_id },
    });
  }
}

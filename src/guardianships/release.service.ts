import { Injectable, Logger } from '@nestjs/common';
import { ActingForCache } from '../auth/acting-for/acting-for.cache';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthService } from '../auth/auth.service';
import { AppConflictException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueViolation } from './login-handle.util';
import { ReleaseCompletionService } from './release-completion.service';

export interface SetReleaseEmailResult {
  /** The release is complete (terms accepted AND email on file). */
  completed: boolean;
  /** A majority-release freeze was lifted by this call (ruling R1). */
  thawed: boolean;
}

/**
 * The released adult adds the email they did not have (a teen with a handle
 * login). Ruling R5: an UNVERIFIED email is enough to complete the release; a
 * verification mail goes out as usual. Ruling R1/R6: it also works while
 * frozen, and acceptance + email thaws.
 *
 * Nobody else can do this: the former guardian has no principal over a
 * released person (grants are revoked at release).
 */
@Injectable()
export class ReleaseService {
  private readonly logger = new Logger(ReleaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly completion: ReleaseCompletionService,
    private readonly audit: AuditLogsService,
    private readonly actingForCache: ActingForCache,
    private readonly auth: AuthService,
  ) {}

  async setEmail(
    userId: string,
    email: string,
  ): Promise<SetReleaseEmailResult> {
    let result: SetReleaseEmailResult;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const user = await tx.users.findUnique({
          where: { user_id: userId },
          select: { email: true },
        });
        if (user?.email) {
          throw new AppConflictException(
            ErrorCode.FAMILY_RELEASE_EMAIL_ALREADY_SET,
          );
        }
        const taken = await tx.users.findFirst({
          where: { email, NOT: { user_id: userId } },
          select: { user_id: true },
        });
        if (taken) {
          // Generic on purpose: never reveal who owns the address.
          throw new AppConflictException(
            ErrorCode.FAMILY_RELEASE_EMAIL_UNAVAILABLE,
          );
        }

        await tx.users.update({
          where: { user_id: userId },
          data: { email, email_verified: false },
        });
        const completion = await this.completion.tryComplete(tx, userId);
        // The address itself never goes to the audit trail.
        await this.audit.recordEventOrThrow(
          {
            entity_type: 'dependent_profile',
            entity_id: userId,
            action: 'family.release.email_set',
            actor_user_id: userId,
            target_user_id: userId,
            actor_kind: 'released_user',
            changes: { completed: completion.completed },
          },
          tx,
        );
        return completion;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppConflictException(
          ErrorCode.FAMILY_RELEASE_EMAIL_UNAVAILABLE,
        );
      }
      throw error;
    }

    await this.actingForCache.bump(userId);
    try {
      await this.auth.sendVerificationEmail(userId);
    } catch (error) {
      // The email is saved; the person can ask for the mail again.
      this.logger.warn(
        `release verification email failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return result;
  }
}

import { Injectable } from '@nestjs/common';
import type { Prisma, users_pr } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Lazy initialisation of the `users_pr` row (post-registration state).
 *
 * The row is created eagerly by register / social sign-in / dependent
 * creation, but legacy users, seeds and admin-created accounts never got one.
 * Every post-registration entry point calls {@link ensure} so a user without a
 * row simply starts with the same "nothing completed" defaults register uses.
 */
@Injectable()
export class PostRegistrationRowService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the user's `users_pr` row, creating it (all flags false) when it
   * does not exist. Returns `null` when there is nobody to initialise: the user
   * does not exist or is deactivated / soft-deleted (`users.active = false`).
   * Callers decide which error code that maps to.
   *
   * Idempotent and race-safe, also inside a transaction: the insert is
   * `INSERT ... ON CONFLICT DO NOTHING` (`createMany` + `skipDuplicates`), so a
   * concurrent initialiser never raises a unique violation. A caught P2002
   * would NOT be enough inside `$transaction`: PostgreSQL aborts the whole
   * transaction on the failed statement. `users_pr.user_id` is `@unique`, which
   * is what the conflict target relies on.
   */
  async ensure(
    userId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<users_pr | null> {
    const existing = await db.users_pr.findUnique({
      where: { user_id: userId },
    });
    if (existing) {
      return existing;
    }

    // Checked first: inserting for a missing user would raise an FK violation
    // (P2003), which also aborts a surrounding transaction.
    const user = await db.users.findUnique({
      where: { user_id: userId },
      select: { active: true },
    });
    if (!user?.active) {
      return null;
    }

    await db.users_pr.createMany({
      data: [
        {
          user_id: userId,
          complete: false,
          profile_picture_complete: false,
          personal_info_complete: false,
          club_selection_complete: false,
        },
      ],
      skipDuplicates: true,
    });

    return db.users_pr.findUnique({ where: { user_id: userId } });
  }
}

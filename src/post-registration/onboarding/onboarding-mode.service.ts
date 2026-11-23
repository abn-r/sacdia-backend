import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActingForCache } from '../../auth/acting-for/acting-for.cache';
import {
  computeOnboardingMode,
  type OnboardingMode,
} from '../../common/authorization/onboarding-mode';
import {
  AuthorizationContextService,
  type ResolvedAuthorizationProfile,
} from '../../common/services/authorization-context.service';

/**
 * Wraps the pure `computeOnboardingMode` with the two things it must not do:
 * reading the (cached) authorization profile and writing `users_pr.complete`.
 */
@Injectable()
export class OnboardingModeService {
  private readonly logger = new Logger(OnboardingModeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly actingForCache: ActingForCache,
  ) {}

  /** The mode of a user, from the fully resolved (cache-backed) profile. */
  async resolveMode(userId: string): Promise<OnboardingMode> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);
    return this.modeOf(resolved);
  }

  /** For callers that already hold the fully resolved profile. */
  modeOf(fullyResolved: ResolvedAuthorizationProfile): OnboardingMode {
    return computeOnboardingMode(fullyResolved);
  }

  /**
   * Idempotent, race-safe completion of a `club_exempt` registration: when both
   * steps are done and `complete` is still false, flip it. The conditional
   * `updateMany` makes concurrent callers harmless: only one sees `count: 1`.
   * It never revokes `complete` and never touches `club` or `panel_only`
   * users. Returns true when THIS call flipped `complete`.
   *
   * Best effort: a failure is logged and reported as "not flipped"; the next
   * status read, login or step completion heals it.
   */
  async reconcile(userId: string, mode: OnboardingMode): Promise<boolean> {
    if (mode !== 'club_exempt') {
      return false;
    }

    try {
      const { count } = await this.prisma.users_pr.updateMany({
        where: {
          user_id: userId,
          complete: false,
          profile_picture_complete: true,
          personal_info_complete: true,
        },
        data: { complete: true, date_completed: new Date() },
      });
      if (count === 0) {
        return false;
      }

      // `post_register_complete` sits inside the cached profile, and the
      // principal kind reads `users_pr.complete` (unknown-age restriction).
      await this.authorizationContext.invalidateUserAuthorizationCache(userId);
      await this.actingForCache.bump(userId);
      this.logger.log(
        `Post-registration reconciled to COMPLETE for club-exempt user ${userId}`,
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Could not reconcile post-registration for ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}

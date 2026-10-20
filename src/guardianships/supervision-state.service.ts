import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_USER_GUARDIAN, displayName } from './guardianship-queries';
import {
  PENDING_TEEN_FREEZE_DAYS,
  type LinkCodePurpose,
} from './guardianships.constants';

export interface SupervisionGuardianView {
  display_name: string;
  relationship_type_name: string | null;
}

export interface SupervisionView {
  status: 'pending_guardian' | 'active';
  /** Start of the guardian-less clock; null once a guardian is linked. */
  pending_since: string | null;
  /** Linked guardians (pending or verified). Names only: NO contact data. */
  guardians: SupervisionGuardianView[];
  /** Static transparency: what the teen is told guardians can see. */
  summary_visible_to_guardians: true;
  /** Whole days left before the 90-day removal; null when the clock is stopped. */
  days_left: number | null;
}

const DAY_MS = 86_400_000;

/**
 * What a supervised teen is told about their own supervision (GET /auth/me
 * `principal.supervision` and GET /users/me/supervision). It never carries a
 * guardian's contact data, handle, or anything beyond a display name and the
 * relationship.
 */
@Injectable()
export class SupervisionStateService {
  constructor(private readonly prisma: PrismaService) {}

  async describe(
    userId: string,
    status: 'pending_guardian' | 'active',
    now: Date = new Date(),
  ): Promise<SupervisionView> {
    const [login, guardianships] = await Promise.all([
      this.prisma.supervised_logins.findUnique({
        where: { user_id: userId },
        select: { pending_since: true },
      }),
      this.prisma.guardianships.findMany({
        where: { dependent_user_id: userId, ...ACTIVE_USER_GUARDIAN },
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        select: {
          guardian: {
            select: { name: true, paternal_last_name: true },
          },
          relationship_type: { select: { name: true } },
        },
      }),
    ]);

    const guardians = guardianships.map((row) => ({
      display_name: displayName(row.guardian),
      relationship_type_name: row.relationship_type?.name ?? null,
    }));

    // A linked guardian (even a pending one) stops the clock.
    const pendingSince =
      guardians.length > 0 || !login?.pending_since
        ? null
        : login.pending_since;

    return {
      status,
      pending_since: pendingSince ? pendingSince.toISOString() : null,
      guardians,
      summary_visible_to_guardians: true,
      days_left:
        status === 'pending_guardian' && pendingSince
          ? Math.max(
              0,
              PENDING_TEEN_FREEZE_DAYS -
                Math.floor((now.getTime() - pendingSince.getTime()) / DAY_MS),
            )
          : null,
    };
  }

  /** The teen's open (unconsumed, unrevoked, unexpired) link code, if any. */
  async openLinkCode(
    userId: string,
    now: Date = new Date(),
  ): Promise<{ expires_at: string } | null> {
    const purpose: LinkCodePurpose = 'teen_guardian_link';
    const row = await this.prisma.guardianship_link_codes.findFirst({
      where: {
        dependent_user_id: userId,
        purpose,
        consumed_at: null,
        revoked_at: null,
        expires_at: { gt: now },
      },
      orderBy: { created_at: 'desc' },
      select: { expires_at: true },
    });
    return row ? { expires_at: row.expires_at.toISOString() } : null;
  }
}

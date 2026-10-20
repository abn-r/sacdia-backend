import { Injectable } from '@nestjs/common';
import {
  CountryAgePolicyService,
  type CountryAgePolicy,
} from '../common/age/country-age-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  SUPERVISED_STATE_USER_SELECT,
  deriveSupervisedState,
} from '../auth/supervised/supervised-principal.resolver';
import { principalSeesClubData } from '../auth/acting-for/auth-principal';

/**
 * Who may RECEIVE club data (a club broadcast, a section-role fan-out, a
 * realtime club invalidation, an activity reminder). It is the notification
 * counterpart of `principalSeesClubData()`: a user the API would show no club
 * data to must not get a push or an inbox row about the club either (FP3-03 /
 * FP3-07, ruling "option A", also with an active assignment from before the
 * Phase 3 deploy).
 *
 * Denied:
 *  - a minor account holder (by the country age policy) with no verified,
 *    non-test, non-custodian guardianship (`supervised_user` /
 *    `pending_guardian`);
 *  - an account with NO birthday whose post-registration is still open and that
 *    is not staff (`age_unknown_user`).
 *
 * The decision is NOT re-implemented here: it is the supervised principal
 * resolver's own `deriveSupervisedState` over the same facts
 * (`SUPERVISED_STATE_USER_SELECT`), mapped through `principalSeesClubData`.
 *
 * A dependent WITHOUT an account (a plain child managed by its guardian) is
 * never denied: its notices reach it through the guardian fan-out
 * (`DependentPushRouterService`), which is the guardian's channel and not the
 * child's own session.
 *
 * ONE users query per call (plus one cached policy lookup per distinct
 * country), whatever the number of recipients. A database error propagates:
 * the filter never fails open.
 */
@Injectable()
export class ClubDataRecipientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countryAgePolicy: CountryAgePolicyService,
  ) {}

  /** `userIds` without the recipients that must not receive club data. Order kept. */
  async filterClubDataRecipients(
    userIds: readonly string[],
  ): Promise<string[]> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return [];

    const denied = await this.findDeniedUserIds(unique);
    if (denied.size === 0) return unique;
    return unique.filter((id) => !denied.has(id));
  }

  private async findDeniedUserIds(userIds: string[]): Promise<Set<string>> {
    const rows = await this.prisma.users.findMany({
      where: { user_id: { in: userIds } },
      select: {
        user_id: true,
        ...SUPERVISED_STATE_USER_SELECT,
        // An account holder runs its own session; a plain dependent has none.
        account: { select: { id: true }, take: 1 },
      },
    });

    const countryIds = [
      ...new Set(
        rows
          .filter((row) => row.birthday !== null)
          .map((row) => row.country_id),
      ),
    ];
    const policies = new Map<number | null, CountryAgePolicy>();
    for (const countryId of countryIds) {
      policies.set(countryId, await this.countryAgePolicy.getPolicy(countryId));
    }

    const denied = new Set<string>();
    for (const row of rows) {
      const { state } = deriveSupervisedState(
        row,
        row.birthday ? (policies.get(row.country_id) ?? null) : null,
      );

      if (state.state === 'profile_incomplete') {
        denied.add(row.user_id);
        continue;
      }
      if (state.state !== 'supervised') continue;

      const holdsAccount = row.account.length > 0 || !!row.supervised_login;
      if (
        holdsAccount &&
        !principalSeesClubData({
          kind: 'supervised_user',
          supervision: state.supervision,
        })
      ) {
        denied.add(row.user_id);
      }
    }
    return denied;
  }
}

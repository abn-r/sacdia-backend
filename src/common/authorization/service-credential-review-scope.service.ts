import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { activeMembershipInScopeWhere } from './actor-section-scope';
import {
  type ReviewChannel,
  ReviewerScopeService,
} from './reviewer-scope.service';
import { GlobalRole } from './roles';
import { SERVICE_CREDENTIAL_PERMISSION } from '../../service-credentials/service-credentials.constants';

export type { ReviewChannel } from './reviewer-scope.service';

const MATCH_NOTHING: Prisma.service_credentialsWhereInput = {
  credential_id: { in: [] },
};

/**
 * Who a reviewer of counselor credentials may see.
 *
 * Scope = the credential owner holds an active club assignment (any role,
 * current ecclesiastical year) in a club section the reviewer covers:
 *  - admin / super-admin: everyone, no assignment needed;
 *  - Local Field (director-lf, assistant-lf): clubs of their local field;
 *  - coordinators: sections of their active coordinator assignments;
 *  - pastor: clubs of the districts they are assigned to
 *    (`district_investiture_pastors`) while they are an eligible pastor.
 * Union and division roles are NOT a channel here. The channels come from the
 * shared `ReviewerScopeService`; the membership predicate is
 * `activeMembershipInScopeWhere` (the one the role-request and consent reviews
 * use); this service adds no assignment predicate of its own.
 */
@Injectable()
export class ServiceCredentialReviewScopeService extends ReviewerScopeService {
  /** Channels in priority order: admin, Local Field, coordinator, pastor. */
  resolveChannels(actorId: string): Promise<ReviewChannel[]> {
    return this.resolveReviewerChannels(
      actorId,
      SERVICE_CREDENTIAL_PERMISSION,
      {
        everywhere: [GlobalRole.SUPER_ADMIN, GlobalRole.ADMIN],
      },
    );
  }

  /** `service_credentials` filter: the owner is inside the combined scope. */
  async ownerInScopeWhere(
    channels: ReviewChannel[],
  ): Promise<Prisma.service_credentialsWhereInput> {
    const scope = this.combinedScope(channels);
    if (!scope) return MATCH_NOTHING;
    if (scope.all) return {};
    const yearId = await this.currentYearId();
    return {
      owner: {
        club_role_assignments: {
          some: {
            ...activeMembershipInScopeWhere(scope),
            ...(yearId === null ? {} : { ecclesiastical_year_id: yearId }),
          },
        },
      },
    };
  }

  /** Assignment filter used to name the club a person is reviewed through. */
  async membershipWhere(
    channels: ReviewChannel[],
  ): Promise<Prisma.club_role_assignmentsWhereInput | null> {
    const scope = this.combinedScope(channels);
    if (!scope) return null;
    const yearId = await this.currentYearId();
    return {
      ...activeMembershipInScopeWhere(scope),
      ...(yearId === null ? {} : { ecclesiastical_year_id: yearId }),
    };
  }

  /**
   * The role through which the actor reaches `ownerId`, or null when the
   * person is out of scope. Admin / super-admin reach everyone.
   */
  async findReviewerRole(
    channels: ReviewChannel[],
    ownerId: string,
  ): Promise<string | null> {
    const yearId = await this.currentYearId();
    for (const channel of channels) {
      if (channel.scope.all) return channel.role;
      const count = await this.prisma.club_role_assignments.count({
        where: {
          user_id: ownerId,
          ...activeMembershipInScopeWhere(channel.scope),
          ...(yearId === null ? {} : { ecclesiastical_year_id: yearId }),
        },
      });
      if (count > 0) return channel.role;
    }
    return null;
  }
}

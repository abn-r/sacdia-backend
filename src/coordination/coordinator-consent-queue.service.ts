import { Injectable } from '@nestjs/common';
import { coordinatorRolePermissions } from '../common/authorization/coordinator-section-scope';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { MembershipRequestsService } from '../membership-requests/membership-requests.service';
import { CoordinationService } from './coordination.service';

/** The permission a coordinator ROLE must carry to read the queue. */
const CONSENT_VERIFY_PERMISSION = 'consent:verify';

export type GlobalRoleGrant = {
  role_name: string;
  permissions: readonly string[];
};

export type ConsentQueuePage = { limit: number; offset: number };

/**
 * GET /coordination/me/consent-pending: every consent form waiting for the
 * caller across the sections their coordinator assignments cover.
 *
 * Authority (decision #11648 / #11660): only a coordinator ROLE carrying
 * consent:verify opens it, and only the active assignments say where. A
 * consent:verify from anywhere else (a club role, an admin role, a direct
 * grant) does not: those reviewers use the per-section list.
 *  - no coordinator role with consent:verify -> 403 GUARD_PERMISSION_DENIED;
 *  - no covered section today (no active assignment, or only inactive
 *    territory) -> 403 GUARD_CLUB_SCOPE_REQUIRED, as the per-section routes
 *    answer outside the assignments.
 * Coverage is the /coordination/me/scope expansion (active territory only).
 * What is listed is the per-section verify-only view (opción B, #11654),
 * through MembershipRequestsService, never a second copy of the rule.
 */
@Injectable()
export class CoordinatorConsentQueueService {
  constructor(
    private readonly coordination: CoordinationService,
    private readonly membershipRequests: MembershipRequestsService,
  ) {}

  async listForCoordinator(
    userId: string,
    globalRoles: ReadonlyArray<GlobalRoleGrant> | undefined,
    page: ConsentQueuePage,
  ) {
    if (
      !globalRoles ||
      !coordinatorRolePermissions(globalRoles).has(CONSENT_VERIFY_PERMISSION)
    ) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }

    const scope = await this.coordination.resolveCoordinatorScope(userId);
    if (scope.sections.length === 0) {
      throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
    }

    const labels = new Map(
      scope.sections.map((section) => [
        section.club_section_id,
        {
          club_name: section.club_name,
          club_type_name: section.club_type_name,
          district_name: section.district_name,
        },
      ]),
    );
    const labelOf = (clubSectionId: number | null) =>
      (clubSectionId !== null ? labels.get(clubSectionId) : undefined) ?? {
        club_name: null,
        club_type_name: null,
        district_name: null,
      };

    const queue = await this.membershipRequests.listVerifyWorkAcrossSections(
      scope.sections.map((section) => section.club_section_id),
      userId,
      page,
    );

    return {
      items: queue.items.map((item) => ({
        ...item,
        ...labelOf(item.club_section_id),
      })),
      total: queue.total,
      limit: page.limit,
      offset: page.offset,
      by_section: queue.by_section.map((entry) => ({
        club_section_id: entry.club_section_id,
        ...labelOf(entry.club_section_id),
        pending_consent_count: entry.pending_consent_count,
      })),
    };
  }
}

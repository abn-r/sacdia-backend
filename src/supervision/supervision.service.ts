import { Injectable } from '@nestjs/common';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import {
  computeCapabilities,
  computeTerritory,
  type CapabilityKey,
  type TerritoryLevel,
} from '../common/authorization/capabilities';
import { ClubEnrollmentReviewService } from '../club-enrollments/club-enrollment-review.service';
import { AnnualFoldersService } from '../annual-folders/annual-folders.service';
import { RequestsService } from '../requests/requests.service';
import { CamporeeLateApprovalsService } from '../camporees/camporee-late-approvals.service';

export type SupervisionPendingCounts = {
  club_enrollments: number | null;
  annual_folders: number | null;
  union_camporee_registrations: number | null;
  transfers: number | null;
  role_assignments: number | null;
};

export type SupervisionPendingCountsResult = {
  territory_level: TerritoryLevel;
  counts: SupervisionPendingCounts;
};

const EMPTY_COUNTS: SupervisionPendingCounts = {
  club_enrollments: null,
  annual_folders: null,
  union_camporee_registrations: null,
  transfers: null,
  role_assignments: null,
};

/**
 * Aggregates the pending-work counters of the supervision hub. A counter is
 * computed only when the actor holds the capability of its function; otherwise
 * it is `null`. Nothing is cached: counts must drop right after a decision.
 */
@Injectable()
export class SupervisionService {
  constructor(
    private readonly authorizationContext: AuthorizationContextService,
    private readonly enrollmentReview: ClubEnrollmentReviewService,
    private readonly annualFolders: AnnualFoldersService,
    private readonly requests: RequestsService,
    private readonly lateApprovals: CamporeeLateApprovalsService,
  ) {}

  async getPendingCounts(
    userId: string,
  ): Promise<SupervisionPendingCountsResult> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);
    const territoryLevel = computeTerritory(resolved).level;

    // Unconfigured territory is an explicit state, not an error.
    if (territoryLevel === 'unconfigured') {
      return { territory_level: territoryLevel, counts: { ...EMPTY_COUNTS } };
    }

    const held = new Set<CapabilityKey>(computeCapabilities(resolved));
    const when = <T>(key: CapabilityKey, count: () => Promise<T>) =>
      held.has(key) ? count() : Promise.resolve(null);

    const [clubEnrollments, annualFolders, camporee, reviewable] =
      await Promise.all([
        when('club_enrollments.validate', () =>
          this.enrollmentReview.countPending(userId),
        ),
        when('folders.evaluate', () =>
          this.annualFolders.countEvaluationQueue(userId),
        ),
        when('union_camporees.approve_registrations', () =>
          this.lateApprovals.countUnionPending(resolved.authorization),
        ),
        when('requests.review_territory', () =>
          this.requests.countReviewable(userId),
        ),
      ]);

    return {
      territory_level: territoryLevel,
      counts: {
        club_enrollments: clubEnrollments,
        annual_folders: annualFolders,
        union_camporee_registrations: camporee,
        transfers: reviewable?.transfers ?? null,
        role_assignments: reviewable?.role_assignments ?? null,
      },
    };
  }
}

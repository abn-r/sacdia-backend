import type { PrismaService } from '../../../prisma/prisma.service';
import type { TemporalContextFactory } from '../../clock/temporal-context.factory';
import type { AuthorizationContextService } from '../../services/authorization-context.service';
import type { InstitutionalHierarchyService } from '../../services/institutional-hierarchy.service';
import type { ClubAssignmentEffectivityPolicy } from '../club-assignment-effectivity.policy';
import type { MemberTerritoryScopeService } from '../member-territory-scope.service';
import { LegacyPolicy, type LegacyScopeDispatcher } from './legacy.policy';
import { ResourcePolicyRegistry } from './policy-registry';
import { ActiveAssignmentPolicy } from './simple/active-assignment.policy';
import { GlobalPolicy } from './simple/global.policy';
import { UserPolicy } from './simple/user.policy';

export type PolicyDeps = {
  prisma: PrismaService;
  authorizationContext: AuthorizationContextService;
  hierarchy: InstitutionalHierarchyService;
  effectivity: ClubAssignmentEffectivityPolicy;
  temporal: TemporalContextFactory;
  memberScope?: MemberTerritoryScopeService;
};

/**
 * Batch 1: only the three simple types have real policies. The rest delegate
 * to the guard's legacy switch through `legacy` until they are migrated.
 */
export function buildResourcePolicyRegistry(
  // Unused until the migrated policies need their collaborators.
  _deps: PolicyDeps,
  legacy: LegacyScopeDispatcher,
): ResourcePolicyRegistry {
  return new ResourcePolicyRegistry({
    global: new GlobalPolicy(),
    user: new UserPolicy(),
    active_assignment: new ActiveAssignmentPolicy(),
    club: new LegacyPolicy('club', legacy),
    club_section: new LegacyPolicy('club_section', legacy),
    camporee: new LegacyPolicy('camporee', legacy),
    union_camporee: new LegacyPolicy('union_camporee', legacy),
    camporee_event: new LegacyPolicy('camporee_event', legacy),
    camporee_venue: new LegacyPolicy('camporee_venue', legacy),
    camporee_payment: new LegacyPolicy('camporee_payment', legacy),
    activity: new LegacyPolicy('activity', legacy),
    activity_series: new LegacyPolicy('activity_series', legacy),
    finance: new LegacyPolicy('finance', legacy),
    inventory_instance: new LegacyPolicy('inventory_instance', legacy),
    inventory_item: new LegacyPolicy('inventory_item', legacy),
    club_assignment: new LegacyPolicy('club_assignment', legacy),
    class_counselor_assignment: new LegacyPolicy(
      'class_counselor_assignment',
      legacy,
    ),
    investiture_enrollment: new LegacyPolicy('investiture_enrollment', legacy),
    monthly_report: new LegacyPolicy('monthly_report', legacy),
    insurance_member: new LegacyPolicy('insurance_member', legacy),
    insurance_record: new LegacyPolicy('insurance_record', legacy),
  });
}

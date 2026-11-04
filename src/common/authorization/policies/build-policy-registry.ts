import type { PrismaService } from '../../../prisma/prisma.service';
import type { TemporalContextFactory } from '../../clock/temporal-context.factory';
import type { AuthorizationContextService } from '../../services/authorization-context.service';
import type { InstitutionalHierarchyService } from '../../services/institutional-hierarchy.service';
import type { ClubAssignmentEffectivityPolicy } from '../club-assignment-effectivity.policy';
import type { MemberTerritoryScopeService } from '../member-territory-scope.service';
import { ResourcePolicyRegistry } from './policy-registry';
import { CamporeeEventPolicy } from './camporee/camporee-event.policy';
import { CamporeePaymentPolicy } from './camporee/camporee-payment.policy';
import { CamporeeVenuePolicy } from './camporee/camporee-venue.policy';
import { CamporeePolicy } from './camporee/camporee.policy';
import { UnionCamporeePolicy } from './camporee/union-camporee.policy';
import { ActivityPolicy } from './club/activity.policy';
import { ActivitySeriesPolicy } from './club/activity-series.policy';
import { ClassCounselorAssignmentPolicy } from './club/class-counselor-assignment.policy';
import { ClubAssignmentPolicy } from './club/club-assignment.policy';
import { ClubSectionPolicy } from './club/club-section.policy';
import { ClubPolicy } from './club/club.policy';
import { FinancePolicy } from './club/finance.policy';
import { InsuranceMemberPolicy } from './club/insurance-member.policy';
import { InsuranceRecordPolicy } from './club/insurance-record.policy';
import { InventoryInstancePolicy } from './club/inventory-instance.policy';
import { InventoryItemPolicy } from './club/inventory-item.policy';
import { InvestitureEnrollmentPolicy } from './club/investiture-enrollment.policy';
import { MonthlyReportPolicy } from './club/monthly-report.policy';
import {
  AssignmentEffectivity,
  InstanceScopeValidator,
} from './scope/instance-scope';
import {
  CamporeeScopeLoader,
  TerritoryScopeValidator,
} from './scope/territory-scope';
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

/** One real policy per resource type; the registry type enforces it. */
export function buildResourcePolicyRegistry(
  deps: PolicyDeps,
): ResourcePolicyRegistry {
  const { prisma } = deps;
  const scopes = new InstanceScopeValidator(prisma, deps.authorizationContext);
  const territory = new TerritoryScopeValidator(
    deps.authorizationContext,
    prisma,
    deps.hierarchy,
  );
  const loader = new CamporeeScopeLoader(prisma, deps.hierarchy);
  const effectivity = new AssignmentEffectivity(
    deps.effectivity,
    deps.temporal,
  );

  return new ResourcePolicyRegistry({
    global: new GlobalPolicy(),
    user: new UserPolicy(),
    active_assignment: new ActiveAssignmentPolicy(),
    club: new ClubPolicy(deps.authorizationContext),
    club_section: new ClubSectionPolicy(prisma, scopes),
    camporee: new CamporeePolicy(territory, loader),
    union_camporee: new UnionCamporeePolicy(territory, loader),
    camporee_event: new CamporeeEventPolicy(prisma, territory, loader),
    camporee_venue: new CamporeeVenuePolicy(prisma, deps.hierarchy, territory),
    camporee_payment: new CamporeePaymentPolicy(prisma, territory, loader),
    activity: new ActivityPolicy(prisma, scopes),
    activity_series: new ActivitySeriesPolicy(prisma, scopes),
    finance: new FinancePolicy(prisma, scopes),
    inventory_instance: new InventoryInstancePolicy(prisma, scopes),
    inventory_item: new InventoryItemPolicy(prisma, scopes),
    club_assignment: new ClubAssignmentPolicy(prisma, scopes),
    class_counselor_assignment: new ClassCounselorAssignmentPolicy(
      prisma,
      scopes,
    ),
    investiture_enrollment: new InvestitureEnrollmentPolicy(
      prisma,
      scopes,
      effectivity,
    ),
    monthly_report: new MonthlyReportPolicy(prisma, scopes),
    insurance_member: new InsuranceMemberPolicy(prisma, scopes, effectivity),
    insurance_record: new InsuranceRecordPolicy(prisma, scopes, effectivity),
  });
}

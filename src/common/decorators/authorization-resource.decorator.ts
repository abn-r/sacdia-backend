import { SetMetadata } from '@nestjs/common';

export const AUTHORIZATION_RESOURCE_KEY = 'authorization_resource';

export type AuthorizationResourceType =
  | 'global'
  | 'active_assignment'
  | 'club'
  | 'club_section'
  | 'camporee'
  | 'union_camporee'
  | 'camporee_event'
  | 'camporee_venue'
  | 'activity'
  | 'activity_series'
  | 'finance'
  | 'inventory_instance'
  | 'inventory_item'
  | 'club_assignment'
  | 'class_counselor_assignment'
  | 'investiture_enrollment'
  | 'monthly_report'
  | 'insurance_member'
  | 'insurance_record'
  | 'user';

export type AuthorizationResourceValueSource = 'param' | 'query' | 'body';

export type AuthorizationTenantBindingKind =
  | 'club'
  | 'club_section'
  | 'local_field'
  | 'union'
  | 'camporee'
  | 'union_camporee';

/**
 * Binds a tenant identifier carried by the request (param, query or body) to
 * the actor's assignment / territory scope. Enforced by `PermissionsGuard`
 * after the resource-type check, for every resource type. A missing value is
 * rejected unless `optional` is set.
 */
export type AuthorizationTenantBinding = {
  kind: AuthorizationTenantBindingKind;
  source: AuthorizationResourceValueSource;
  field: string;
  optional?: boolean;
};

export type AuthorizationResourceMetadata = {
  type: AuthorizationResourceType;
  idParam?: string;
  clubIdParam?: string;
  ownerParam?: string;
  instanceTypeSource?: AuthorizationResourceValueSource;
  instanceTypeField?: string;
  /**
   * Opt-in, per route; honored for `club_section`, `club_assignment` and
   * `monthly_report` resources only. A GLOBAL coordinator / zone-coordinator /
   * general-coordinator passes the section scope check when a coordinator
   * ROLE carries the route's required permission(s) and the canonical
   * coordinator scope (coordinator_assignments) covers the resolved section.
   * Never set it on routes that manage the club (approve, finances, report
   * drafting/submission...): coordinators review, they do not run clubs.
   */
  coordinatorSections?: boolean;
  bind?: AuthorizationTenantBinding[];
};

export function AuthorizationResource(
  resource: AuthorizationResourceMetadata,
): ClassDecorator & MethodDecorator {
  return SetMetadata(AUTHORIZATION_RESOURCE_KEY, resource);
}

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
  | 'finance'
  | 'inventory_instance'
  | 'inventory_item'
  | 'club_assignment'
  | 'investiture_enrollment'
  | 'monthly_report'
  | 'insurance_member'
  | 'insurance_record'
  | 'user';

export type AuthorizationResourceValueSource = 'param' | 'query' | 'body';

export type AuthorizationResourceMetadata = {
  type: AuthorizationResourceType;
  idParam?: string;
  clubIdParam?: string;
  ownerParam?: string;
  instanceTypeSource?: AuthorizationResourceValueSource;
  instanceTypeField?: string;
};

export function AuthorizationResource(
  resource: AuthorizationResourceMetadata,
): ClassDecorator & MethodDecorator {
  return SetMetadata(AUTHORIZATION_RESOURCE_KEY, resource);
}

import { SetMetadata } from '@nestjs/common';

export const AUTHORIZATION_RESOURCE_KEY = 'authorization_resource';

export type AuthorizationResourceType =
  | 'global'
  | 'active_assignment'
  | 'club'
  | 'camporee'
  | 'activity'
  | 'finance'
  | 'inventory_instance'
  | 'inventory_item'
  | 'club_assignment'
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

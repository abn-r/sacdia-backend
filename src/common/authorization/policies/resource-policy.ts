import type {
  AuthorizationResourceMetadata,
  AuthorizationResourceType,
} from '../../decorators/authorization-resource.decorator';
import type { PermissionRequirement } from '../../decorators/permissions.decorator';
import type { ResolvedAuthorizationProfile } from '../../services/authorization-context.service';

export type PolicyContext = {
  userId: string;
  request: any;
  resolved: ResolvedAuthorizationProfile;
  requirement: PermissionRequirement;
  resource: AuthorizationResourceMetadata;
};

/**
 * Scope check for one `AuthorizationResourceType`. `true` allows; denials
 * throw the same App*Exception (400/403/404) the guard raised before.
 */
export interface ResourcePolicy<
  T extends AuthorizationResourceType = AuthorizationResourceType,
> {
  readonly type: T;
  resolve(ctx: PolicyContext): Promise<boolean>;
}

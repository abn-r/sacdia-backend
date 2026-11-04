import type { AuthorizationResourceType } from '../../decorators/authorization-resource.decorator';
import type { ResourcePolicy } from './resource-policy';

/** Mapped type: adding a resource type without a policy fails to compile. */
export type ResourcePolicyTable = Readonly<{
  [K in AuthorizationResourceType]: ResourcePolicy<K>;
}>;

export class ResourcePolicyRegistry {
  constructor(private readonly table: ResourcePolicyTable) {}

  get<K extends AuthorizationResourceType>(
    type: K,
  ): ResourcePolicy<K> | undefined {
    return this.table[type];
  }
}

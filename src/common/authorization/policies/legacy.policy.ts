import type { AuthorizationResourceType } from '../../decorators/authorization-resource.decorator';
import type { PolicyContext, ResourcePolicy } from './resource-policy';

/** Delegates to the guard's pre-registry switch until the type is migrated. */
export type LegacyScopeDispatcher = (ctx: PolicyContext) => Promise<boolean>;

export class LegacyPolicy<
  T extends AuthorizationResourceType,
> implements ResourcePolicy<T> {
  constructor(
    readonly type: T,
    private readonly dispatch: LegacyScopeDispatcher,
  ) {}

  resolve(ctx: PolicyContext): Promise<boolean> {
    return this.dispatch(ctx);
  }
}

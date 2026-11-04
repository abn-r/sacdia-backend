import type { ResourcePolicy } from '../resource-policy';

/** Carries no resource of its own; tenant ids must be declared via `bind`. */
export class UserPolicy implements ResourcePolicy<'user'> {
  readonly type = 'user' as const;

  resolve(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

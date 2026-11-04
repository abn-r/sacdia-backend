import type { ResourcePolicy } from '../resource-policy';

/** Carries no resource of its own; tenant ids must be declared via `bind`. */
export class GlobalPolicy implements ResourcePolicy<'global'> {
  readonly type = 'global' as const;

  resolve(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

import type { ResourcePolicy } from '../resource-policy';

/** Carries no resource of its own; tenant ids must be declared via `bind`. */
export class ActiveAssignmentPolicy implements ResourcePolicy<'active_assignment'> {
  readonly type = 'active_assignment' as const;

  resolve(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

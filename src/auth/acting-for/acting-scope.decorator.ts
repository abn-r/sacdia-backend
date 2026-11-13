import { SetMetadata } from '@nestjs/common';
import type { ActingForScope } from './auth-principal';

export const ACTING_SCOPE_KEY = 'acting_scope';

/**
 * Declares the capability a route needs to be reachable by a guardian acting
 * for a dependent (or, in Phase 3, a linked device). Routes WITHOUT it are
 * denied while acting (deny by default). The handler wins over the class.
 *
 * Phase 4: an ARRAY is any-of (the principal needs ONE of the listed scopes).
 * Keep the pre-existing scope FIRST: tooling that needs a single "primary"
 * scope reads the first element.
 */
export const ActingScope = (
  scope: ActingForScope | readonly ActingForScope[],
) => SetMetadata(ACTING_SCOPE_KEY, scope);

/** Normalizes the decorator value (scalar or any-of array) to an array. */
export function actingScopesOf(
  value: ActingForScope | readonly ActingForScope[] | undefined,
): readonly ActingForScope[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

import { SetMetadata } from '@nestjs/common';
import type { ActingForScope } from './auth-principal';

export const ACTING_SCOPE_KEY = 'acting_scope';

/**
 * Declares the capability a route needs to be reachable by a guardian acting
 * for a dependent (or, in Phase 3, a linked device). Routes WITHOUT it are
 * denied while acting (deny by default). The handler wins over the class.
 */
export const ActingScope = (scope: ActingForScope) =>
  SetMetadata(ACTING_SCOPE_KEY, scope);

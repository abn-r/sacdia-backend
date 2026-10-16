import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { actingForScopeDenied } from './acting-for.errors';
import { ACTING_SCOPE_KEY } from './acting-scope.decorator';
import type { ActingForScope, AuthPrincipal } from './auth-principal';

type PrincipalScopes = Partial<Pick<AuthPrincipal, 'kind' | 'scopes'>>;

/** The scope declared on the route (handler wins over class), if any. */
export function readActingScope(
  reflector: Reflector,
  context: ExecutionContext,
): ActingForScope | undefined {
  return reflector.getAllAndOverride<ActingForScope | undefined>(
    ACTING_SCOPE_KEY,
    [context.getHandler(), context.getClass()],
  );
}

/** A plain user (or an anonymous request) is never restricted by scopes. */
function isUnrestricted(
  principal: PrincipalScopes | null | undefined,
): boolean {
  return (
    !principal || principal.kind === undefined || principal.kind === 'user'
  );
}

/** Non-throwing variant, used by the optional guard to downgrade to anonymous. */
export function isActingScopeAllowed(
  reflector: Reflector,
  context: ExecutionContext,
  principal: PrincipalScopes | null | undefined,
): boolean {
  if (isUnrestricted(principal)) {
    return true;
  }
  const required = readActingScope(reflector, context);
  return required !== undefined && !!principal?.scopes?.includes(required);
}

/**
 * Throws 403 ACTING_FOR_SCOPE_DENIED when a substituted principal reaches a
 * route that declares no scope or a scope the principal does not hold.
 */
export function assertActingScope(
  reflector: Reflector,
  context: ExecutionContext,
  principal: PrincipalScopes | null | undefined,
): void {
  if (isActingScopeAllowed(reflector, context, principal)) {
    return;
  }
  throw actingForScopeDenied(readActingScope(reflector, context) ?? null);
}

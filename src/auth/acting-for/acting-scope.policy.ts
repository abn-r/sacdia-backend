import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import {
  actingForScopeDenied,
  principalScopeDenied,
} from './acting-for.errors';
import { ACTING_SCOPE_KEY } from './acting-scope.decorator';
import type { ActingForScope, AuthPrincipal } from './auth-principal';

type PrincipalScopes = Partial<
  Pick<AuthPrincipal, 'kind' | 'scopes' | 'supervision'>
>;

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
 * Throws 403 when a restricted principal reaches a route that declares no scope
 * or a scope the principal does not hold:
 *  - guardian_acting  -> ACTING_FOR_SCOPE_DENIED {required_scope} (the app's
 *    acting interceptor depends on this code);
 *  - supervised_user / linked_device / age_unknown_user -> PRINCIPAL_SCOPE_DENIED
 *    {required_scope, kind, supervision?}, which never triggers the acting exit.
 */
export function assertActingScope(
  reflector: Reflector,
  context: ExecutionContext,
  principal: PrincipalScopes | null | undefined,
): void {
  if (isActingScopeAllowed(reflector, context, principal)) {
    return;
  }
  const required = readActingScope(reflector, context) ?? null;
  if (
    principal?.kind === 'supervised_user' ||
    principal?.kind === 'linked_device' ||
    principal?.kind === 'age_unknown_user'
  ) {
    throw principalScopeDenied(required, principal.kind, principal.supervision);
  }
  throw actingForScopeDenied(required);
}

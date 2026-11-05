import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthorizationContextService } from '../services/authorization-context.service';
import { GlobalRolesGuard } from './global-roles.guard';

/**
 * Runs the REAL `GlobalRolesGuard` (real Reflector, real alias table) against a
 * controller handler for an actor holding exactly `roles`. Resolves `true` when
 * the guard lets the actor through and the thrown error's `code` otherwise.
 */
export async function runGlobalRolesGuard(
  controllerClass: new (...args: never[]) => unknown,
  handler: (...args: never[]) => unknown,
  roles: string[],
): Promise<true | string> {
  const held = new Set(roles);
  const authorizationContext = {
    isSuperAdmin: async () => held.has('super-admin'),
    hasAnyGlobalRole: async (_userId: string, accepted: readonly string[]) =>
      accepted.some((role) => held.has(role)),
  };
  const guard = new GlobalRolesGuard(
    new Reflector(),
    authorizationContext as unknown as AuthorizationContextService,
  );
  const context = {
    getHandler: () => handler,
    getClass: () => controllerClass,
    switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'user-1' } }) }),
  } as unknown as ExecutionContext;
  try {
    return await guard.canActivate(context);
  } catch (error) {
    return (error as { code?: string }).code ?? 'UNKNOWN';
  }
}

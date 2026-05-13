import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationContextService } from '../services/authorization-context.service';
import { AppForbiddenException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import {
  GLOBAL_ROLES_KEY,
  type GlobalRoleType,
} from '../decorators/global-roles.decorator';

// All field-level admin roles (lf/union/dia, director/assistant) share an
// identical permission set via JOIN-copy from `assistant-lf` in
// prisma/seeds/role-permissions.seed.sql. They are therefore treated as
// mutually equivalent at the guard level — consistent with the existing
// admin/assistant-admin symmetric pairing.
const FIELD_ADMIN_ROLES: GlobalRoleType[] = [
  'director-lf',
  'assistant-lf',
  'director-union',
  'assistant-union',
  'director-dia',
  'assistant-dia',
];

const GLOBAL_ROLE_ALIASES: Record<GlobalRoleType, GlobalRoleType[]> = {
  'super-admin': ['super-admin'],
  admin: ['admin', 'assistant-admin'],
  'assistant-admin': ['assistant-admin', 'admin'],
  coordinator: ['coordinator'],
  pastor: ['pastor'],
  user: ['user'],
  'director-lf': FIELD_ADMIN_ROLES,
  'assistant-lf': FIELD_ADMIN_ROLES,
  'director-union': FIELD_ADMIN_ROLES,
  'assistant-union': FIELD_ADMIN_ROLES,
  'director-dia': FIELD_ADMIN_ROLES,
  'assistant-dia': FIELD_ADMIN_ROLES,
};

@Injectable()
export class GlobalRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<GlobalRoleType[]>(
      GLOBAL_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Si no se requieren roles específicos, permitir
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.sub) {
      throw new AppForbiddenException(ErrorCode.GUARD_USER_NOT_AUTHENTICATED);
    }

    // super-admin bypasses all role-based restrictions (god mode)
    if (await this.authorizationContext.isSuperAdmin(user.sub)) {
      return true;
    }

    // Verificar si el usuario tiene alguno de los roles requeridos
    const acceptedRoles = Array.from(
      new Set(
        requiredRoles.flatMap(
          (requiredRole) => GLOBAL_ROLE_ALIASES[requiredRole] ?? [requiredRole],
        ),
      ),
    );
    const hasRole = await this.authorizationContext.hasAnyGlobalRole(
      user.sub,
      acceptedRoles,
    );

    if (!hasRole) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }

    return true;
  }
}

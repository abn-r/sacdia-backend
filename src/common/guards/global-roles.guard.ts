import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationContextService } from '../services/authorization-context.service';
import { AppForbiddenException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import {
  EXACT_GLOBAL_ROLES_KEY,
  GLOBAL_ROLES_KEY,
  type GlobalRoleType,
} from '../decorators/global-roles.decorator';
import { FIELD_ADMIN_ROLES, GLOBAL_ROLE_ALIASES } from './global-role-aliases';

export { FIELD_ADMIN_ROLES, GLOBAL_ROLE_ALIASES };

@Injectable()
export class GlobalRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const exactRoles = this.reflector.getAllAndOverride<GlobalRoleType[]>(
      EXACT_GLOBAL_ROLES_KEY,
      targets,
    );
    const requiredRoles =
      exactRoles ??
      this.reflector.getAllAndOverride<GlobalRoleType[]>(
        GLOBAL_ROLES_KEY,
        targets,
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
    // @ExactGlobalRoles: no alias expansion. @GlobalRoles: expand aliases.
    const acceptedRoles = exactRoles
      ? Array.from(new Set(exactRoles))
      : Array.from(
          new Set(
            requiredRoles.flatMap(
              (requiredRole) =>
                GLOBAL_ROLE_ALIASES[requiredRole] ?? [requiredRole],
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

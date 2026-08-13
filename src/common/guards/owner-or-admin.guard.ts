import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { AuthorizationContextService } from '../services/authorization-context.service';
import { AppForbiddenException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

const OWNER_OR_ADMIN_ROLES = [
  'admin',
  'assistant-admin',
  'super-admin',
] as const;

/**
 * Guard que permite acceso si:
 * 1. El usuario es el propietario del recurso (userId en params coincide con el usuario autenticado)
 * 2. El usuario tiene un rol global administrativo (admin, assistant-admin, super-admin)
 *
 * El rol `coordinator` no es atajo administrativo: su autoridad vive en
 * `coordinator_assignments` (`club_section_ids`), no en este bypass.
 */
@Injectable()
export class OwnerOrAdminGuard implements CanActivate {
  constructor(
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.sub) {
      throw new AppForbiddenException(ErrorCode.GUARD_USER_NOT_AUTHENTICATED);
    }

    // Obtener userId de los parámetros de la ruta
    const resourceUserId = request.params?.userId;

    if (!resourceUserId) {
      throw new AppForbiddenException(ErrorCode.GUARD_USER_ID_PARAM_MISSING);
    }

    // Caso 1: El usuario es el propietario
    if (user.sub === resourceUserId) {
      return true;
    }

    // Caso 2: El usuario tiene rol administrativo global
    const isAdmin = await this.authorizationContext.hasAnyGlobalRole(
      user.sub,
      [...OWNER_OR_ADMIN_ROLES],
    );

    if (isAdmin) {
      return true;
    }

    throw new AppForbiddenException(ErrorCode.GUARD_OWNER_OR_ADMIN_REQUIRED);
  }
}

import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationContextService } from '../services/authorization-context.service';
import { AppForbiddenException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

export const CLUB_ROLES_KEY = 'club_roles';

export type ClubRoleType =
  | 'director'
  | 'deputy_director'
  | 'secretary'
  | 'treasurer'
  | 'counselor'
  | 'instructor'
  | 'captain'
  | 'member';

const CLUB_ROLE_ALIASES: Record<string, string> = {
  subdirector: 'deputy_director',
  secretario: 'secretary',
  tesorero: 'treasurer',
  consejero: 'counselor',
};

function normalizeClubRoleName(roleName: string): string {
  const normalized = roleName.toLowerCase();
  return CLUB_ROLE_ALIASES[normalized] ?? normalized;
}

@Injectable()
export class ClubRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<ClubRoleType[]>(
      CLUB_ROLES_KEY,
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

    // Obtener el clubId del request (params o body)
    const clubId = this.extractClubId(request);

    if (!clubId) {
      throw new AppForbiddenException(ErrorCode.GUARD_CLUB_ID_REQUIRED);
    }

    if (await this.authorizationContext.canManageClub(user.sub, clubId)) {
      return true;
    }

    const resolved = await this.authorizationContext.resolveUserAuthorization(
      user.sub,
    );
    const activeClubScope = resolved.authorization.effective.scope.club;

    if (!activeClubScope || activeClubScope.club.club_id !== clubId) {
      throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
    }

    const hasRole = requiredRoles
      .map((requiredRole) => normalizeClubRoleName(requiredRole))
      .includes(normalizeClubRoleName(activeClubScope.role_name));

    if (!hasRole) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }

    return true;
  }
  private extractClubId(request: any): number | null {
    // Intentar obtener de params
    if (request.params?.clubId) {
      return parseInt(request.params.clubId, 10);
    }

    // Intentar obtener de body
    if (request.body?.club_id) {
      return parseInt(request.body.club_id, 10);
    }

    // Intentar obtener de query
    if (request.query?.clubId) {
      return parseInt(request.query.clubId, 10);
    }

    return null;
  }
}

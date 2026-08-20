import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationContextService } from '../services/authorization-context.service';
import { AppForbiddenException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AUTHORIZATION_RESOURCE_KEY,
  type AuthorizationResourceMetadata,
} from '../decorators/authorization-resource.decorator';

export const CLUB_ROLES_KEY = 'club_roles';

export type ClubRoleType =
  | 'director'
  | 'deputy-director'
  | 'secretary'
  | 'secretary-treasurer'
  | 'treasurer'
  | 'counselor'
  | 'instructor'
  | 'captain'
  | 'member';

const CLUB_ROLE_ALIASES: Record<string, string> = {
  subdirector: 'deputy-director',
  'sub-director': 'deputy-director',
  sub_director: 'deputy-director',
  secretario: 'secretary',
  tesorero: 'treasurer',
  consejero: 'counselor',
  'secretario-tesorero': 'secretary-treasurer',
  secretario_tesorero: 'secretary-treasurer',
  secretary_treasurer: 'secretary-treasurer',
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
    private readonly prisma: PrismaService,
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

    // Obtener el clubId del request. Si el endpoint declara un recurso
    // `investiture_enrollment`, se deriva desde DB por enrollmentId y NO desde
    // body.club_id/query.clubId del caller (defensa IDOR/BOLA).
    const resource =
      this.reflector.getAllAndOverride<AuthorizationResourceMetadata>(
        AUTHORIZATION_RESOURCE_KEY,
        [context.getHandler(), context.getClass()],
      );
    const clubId = await this.extractClubId(request, resource);

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
  private async extractClubId(
    request: any,
    resource?: AuthorizationResourceMetadata,
  ): Promise<number | null> {
    if (resource?.type === 'investiture_enrollment') {
      return this.resolveInvestitureEnrollmentClubId(request, resource);
    }

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

  private async resolveInvestitureEnrollmentClubId(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<number | null> {
    const rawEnrollmentId =
      request.params?.[resource.idParam ?? 'enrollmentId'];
    const enrollmentId = Number.parseInt(String(rawEnrollmentId), 10);

    if (!Number.isFinite(enrollmentId)) {
      return null;
    }

    const enrollment = await this.prisma.enrollments.findFirst({
      where: { enrollment_id: enrollmentId, active: true },
      select: {
        user_id: true,
        ecclesiastical_year_id: true,
        classes: { select: { club_type_id: true } },
      },
    });

    if (!enrollment) {
      return null;
    }

    const assignment = await this.prisma.club_role_assignments.findFirst({
      where: {
        user_id: enrollment.user_id,
        active: true,
        status: 'active',
        ecclesiastical_year_id: enrollment.ecclesiastical_year_id,
        club_sections: {
          club_type_id: enrollment.classes.club_type_id,
        },
      },
      select: {
        club_sections: { select: { main_club_id: true } },
      },
    });

    return assignment?.club_sections?.main_club_id ?? null;
  }
}

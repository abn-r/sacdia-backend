import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationContextService } from '../services/authorization-context.service';
import { AppException, AppForbiddenException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AUTHORIZATION_RESOURCE_KEY,
  type AuthorizationResourceMetadata,
} from '../decorators/authorization-resource.decorator';
import { ClubAssignmentEffectivityPolicy } from '../authorization/club-assignment-effectivity.policy';
import { LocalFieldTimezoneResolver } from '../authorization/local-field-timezone.resolver';
import { TemporalContextFactory } from '../clock/temporal-context.factory';

export const CLUB_ROLES_KEY = 'club_roles';

export type ClubRoleType =
  | 'director'
  | 'deputy-director'
  | 'secretary'
  | 'treasurer'
  | 'counselor'
  | 'instructor'
  | 'captain'
  | 'member';

const CLUB_ROLE_ALIASES: Record<string, string> = {
  subdirector: 'deputy-director',
  secretario: 'secretary',
  tesorero: 'treasurer',
  consejero: 'counselor',
};

const ASSIGNMENT_EFFECTIVITY_SELECT = {
  active: true,
  status: true,
  start_date: true,
  end_date: true,
  expires_at: true,
  club_sections: {
    select: {
      main_club_id: true,
      clubs: {
        select: {
          local_fields: {
            select: { local_field_id: true, timezone: true },
          },
        },
      },
    },
  },
} as const;

type GuardAssignmentRecord = {
  active: boolean | null;
  status: string | null;
  start_date: Date | null;
  end_date: Date | null;
  expires_at: Date | null;
  club_sections: {
    main_club_id: number | null;
    clubs: {
      local_fields: {
        local_field_id: number;
        timezone: string | null;
      } | null;
    } | null;
  } | null;
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
    private readonly temporalContextFactory: TemporalContextFactory,
    private readonly localFieldTimezoneResolver: LocalFieldTimezoneResolver,
    private readonly assignmentEffectivityPolicy: ClubAssignmentEffectivityPolicy,
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

    // Inventory preload only. Temporal authority uses
    // ClubAssignmentEffectivityPolicy.isEffective (resource timezone).
    const candidates = await this.prisma.club_role_assignments.findMany({
      where: {
        user_id: enrollment.user_id,
        active: true,
        ecclesiastical_year_id: enrollment.ecclesiastical_year_id,
        club_sections: {
          club_type_id: enrollment.classes.club_type_id,
        },
      },
      select: ASSIGNMENT_EFFECTIVITY_SELECT,
    });

    const assignment = candidates.find((candidate) =>
      this.isClubAssignmentCurrentlyEffective(candidate),
    );

    return assignment?.club_sections?.main_club_id ?? null;
  }

  private isClubAssignmentCurrentlyEffective(
    assignment: GuardAssignmentRecord,
  ): boolean {
    if (assignment.active === false || assignment.status !== 'active') {
      return false;
    }
    if (!assignment.start_date) {
      return false;
    }

    const localField = assignment.club_sections?.clubs?.local_fields;
    if (!localField) {
      throw new AppException(
        ErrorCode.LOCAL_FIELD_TIMEZONE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        { reason: 'MISSING' },
      );
    }

    const timezone = this.localFieldTimezoneResolver.assertTimezone(
      localField.timezone,
    );
    const temporalContext = this.temporalContextFactory.forLocalField({
      local_field_id: localField.local_field_id,
      timezone,
    });

    return this.assignmentEffectivityPolicy.isEffective(
      {
        active: assignment.active ?? true,
        status: assignment.status,
        start_date: assignment.start_date,
        end_date: assignment.end_date,
        expires_at: assignment.expires_at,
      },
      temporalContext,
    );
  }
}

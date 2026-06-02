import type { Prisma } from '@prisma/client';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { ResolvedAuthorizationProfile } from '../common/services/authorization-context.service';

const ALL_REPORTS_ROLES = new Set([
  'super-admin',
  'admin',
  'director-dia',
  'assistant-dia',
]);

const UNION_REPORTS_ROLES = new Set(['director-union', 'assistant-union']);

const LOCAL_FIELD_REPORTS_ROLES = new Set([
  'assistant-admin',
  'coordinator',
  'director-lf',
  'assistant-lf',
]);

export type ReportVisibilityFilters = {
  divisionId?: number;
  unionId?: number;
  localFieldId?: number;
};

export type ReportVisibilityScope =
  | {
      access: 'all';
      divisionId?: number;
      unionId?: number;
      localFieldId?: number;
    }
  | {
      access: 'union';
      unionId: number;
      localFieldId?: number;
    }
  | {
      access: 'local_field';
      localFieldId: number;
    }
  | {
      access: 'club_section';
      clubSectionId: number;
    };

export function resolveReportVisibilityScope(
  resolved: ResolvedAuthorizationProfile,
  filters: ReportVisibilityFilters,
): ReportVisibilityScope {
  const roleNames = new Set(
    resolved.authorization.grants.global_roles.map((grant) =>
      grant.role_name.toLowerCase(),
    ),
  );

  if (hasAnyRole(roleNames, ALL_REPORTS_ROLES)) {
    return {
      access: 'all',
      ...(filters.divisionId !== undefined && {
        divisionId: filters.divisionId,
      }),
      ...(filters.unionId !== undefined && { unionId: filters.unionId }),
      ...(filters.localFieldId !== undefined && {
        localFieldId: filters.localFieldId,
      }),
    };
  }

  if (hasAnyRole(roleNames, UNION_REPORTS_ROLES)) {
    const unionId = resolved.authorization.effective.scope.global.union?.id;

    if (typeof unionId !== 'number') {
      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }

    return {
      access: 'union',
      unionId,
      ...(filters.localFieldId !== undefined && {
        localFieldId: filters.localFieldId,
      }),
    };
  }

  if (hasAnyRole(roleNames, LOCAL_FIELD_REPORTS_ROLES)) {
    const localFieldId =
      resolved.authorization.effective.scope.global.local_field?.id;

    if (typeof localFieldId !== 'number') {
      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }

    return { access: 'local_field', localFieldId };
  }

  const activeAssignmentId =
    resolved.authorization.active_assignment.assignment_id;
  const activeGrant = resolved.authorization.grants.club_assignments.find(
    (assignment) => assignment.assignment_id === activeAssignmentId,
  );
  const clubSectionId = activeGrant?.section.club_section_id;

  if (typeof clubSectionId === 'number') {
    return { access: 'club_section', clubSectionId };
  }

  throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
}

export function buildReportClubWhere(
  scope: ReportVisibilityScope,
): Prisma.clubsWhereInput {
  if (scope.access === 'club_section') {
    return {
      club_sections: {
        some: { club_section_id: scope.clubSectionId },
      },
    };
  }

  const where: Prisma.clubsWhereInput = {};

  if ('localFieldId' in scope && scope.localFieldId !== undefined) {
    where.local_field_id = scope.localFieldId;
  }

  if (
    ('unionId' in scope && scope.unionId !== undefined) ||
    ('divisionId' in scope && scope.divisionId !== undefined)
  ) {
    where.local_fields = {
      ...('unionId' in scope && scope.unionId !== undefined
        ? { union_id: scope.unionId }
        : {}),
      ...('divisionId' in scope && scope.divisionId !== undefined
        ? { unions: { division_id: scope.divisionId } }
        : {}),
    };
  }

  return where;
}

export function buildReportClubSectionWhere(
  scope: ReportVisibilityScope,
  extra?: Prisma.club_sectionsWhereInput,
): Prisma.club_sectionsWhereInput {
  const clubWhere =
    scope.access === 'club_section' ? {} : buildReportClubWhere(scope);

  return {
    ...(extra ?? {}),
    ...(scope.access === 'club_section' && {
      club_section_id: scope.clubSectionId,
    }),
    ...(Object.keys(clubWhere).length > 0 && { clubs: clubWhere }),
  };
}

function hasAnyRole(
  roleNames: Set<string>,
  allowedRoles: Set<string>,
): boolean {
  for (const role of allowedRoles) {
    if (roleNames.has(role)) return true;
  }
  return false;
}

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
  'director-lf',
  'assistant-lf',
]);

const COORDINATOR_REPORT_ROLES = new Set([
  'coordinator',
  'zone-coordinator',
  'general-coordinator',
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
    }
  | {
      access: 'club_sections';
      clubSectionIds: number[];
    };

export function needsCoordinatorReportSections(
  resolved: ResolvedAuthorizationProfile,
): boolean {
  const roleNames = globalRoleNameSet(resolved);
  if (
    hasAnyRole(roleNames, ALL_REPORTS_ROLES) ||
    hasAnyRole(roleNames, UNION_REPORTS_ROLES) ||
    hasAnyRole(roleNames, LOCAL_FIELD_REPORTS_ROLES)
  ) {
    return false;
  }

  return hasAnyRole(roleNames, COORDINATOR_REPORT_ROLES);
}

export async function resolveReportVisibilityScopeForActor(
  resolved: ResolvedAuthorizationProfile,
  filters: ReportVisibilityFilters,
  loadCoordinatorSectionIds: () => Promise<number[]>,
): Promise<ReportVisibilityScope> {
  const coordinatorSectionIds = needsCoordinatorReportSections(resolved)
    ? await loadCoordinatorSectionIds()
    : undefined;

  return resolveReportVisibilityScope(resolved, filters, coordinatorSectionIds);
}

export function resolveReportVisibilityScope(
  resolved: ResolvedAuthorizationProfile,
  filters: ReportVisibilityFilters,
  coordinatorSectionIds?: number[],
): ReportVisibilityScope {
  const roleNames = globalRoleNameSet(resolved);

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

  if (hasAnyRole(roleNames, COORDINATOR_REPORT_ROLES)) {
    if (!coordinatorSectionIds || coordinatorSectionIds.length === 0) {
      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }

    return { access: 'club_sections', clubSectionIds: coordinatorSectionIds };
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

  if (scope.access === 'club_sections') {
    return {
      club_sections: {
        some: { club_section_id: { in: scope.clubSectionIds } },
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
  if (scope.access === 'club_sections') {
    return {
      ...(extra ?? {}),
      club_section_id: { in: scope.clubSectionIds },
    };
  }

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

function globalRoleNameSet(
  resolved: ResolvedAuthorizationProfile,
): Set<string> {
  return new Set(
    resolved.authorization.grants.global_roles.map((grant) =>
      grant.role_name.toLowerCase(),
    ),
  );
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

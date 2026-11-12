import type { Prisma } from '@prisma/client';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ActorScope } from '../common/authorization/actor-scope';
import type { ResolvedAuthorizationProfile } from '../common/services/authorization-context.service';
import {
  activeGrantSectionId,
  ALL_REPORTS_ROLES,
  COORDINATOR_REPORT_ROLES,
  LOCAL_FIELD_REPORTS_ROLES,
  UNION_REPORTS_ROLES,
} from '../common/authorization/periodic-reports-access';

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
  const actor = ActorScope.from(resolved);
  if (
    actor.hasAnyRole(ALL_REPORTS_ROLES) ||
    actor.hasAnyRole(UNION_REPORTS_ROLES) ||
    actor.hasAnyRole(LOCAL_FIELD_REPORTS_ROLES)
  ) {
    return false;
  }

  return actor.hasAnyRole(COORDINATOR_REPORT_ROLES);
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

/**
 * Quarterly and annual reports are not for coordinators: a coordinator-only
 * actor (no territorial role, no club section of their own) is denied with
 * PERIODIC_REPORTS_FORBIDDEN. An actor that also holds a club section keeps
 * the club-section scope. Monthly reports and compliance keep using
 * {@link resolveReportVisibilityScopeForActor}.
 */
export function resolvePeriodicReportVisibilityScopeForActor(
  resolved: ResolvedAuthorizationProfile,
  filters: ReportVisibilityFilters = {},
): ReportVisibilityScope {
  return resolveReportVisibilityScope(resolved, filters, undefined, {
    periodic: true,
  });
}

export function resolveReportVisibilityScope(
  resolved: ResolvedAuthorizationProfile,
  filters: ReportVisibilityFilters,
  coordinatorSectionIds?: number[],
  options: { periodic?: boolean } = {},
): ReportVisibilityScope {
  const actor = ActorScope.from(resolved);

  if (actor.hasAnyRole(ALL_REPORTS_ROLES)) {
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

  if (actor.hasAnyRole(UNION_REPORTS_ROLES)) {
    const unionId = actor.unionId;

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

  if (actor.hasAnyRole(LOCAL_FIELD_REPORTS_ROLES)) {
    const localFieldId = actor.localFieldId;

    if (typeof localFieldId !== 'number') {
      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }

    return { access: 'local_field', localFieldId };
  }

  if (actor.hasAnyRole(COORDINATOR_REPORT_ROLES) && options.periodic) {
    // Falls through to the club-section scope when the actor has one.
    if (activeGrantSectionId(resolved) === undefined) {
      throw new AppForbiddenException(ErrorCode.PERIODIC_REPORTS_FORBIDDEN);
    }
  } else if (actor.hasAnyRole(COORDINATOR_REPORT_ROLES)) {
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

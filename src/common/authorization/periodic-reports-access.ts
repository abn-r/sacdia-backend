import type { ResolvedAuthorizationProfile } from '../services/authorization-context.service';
import { ActorScope } from './actor-scope';
import { GlobalRole } from './roles';

/**
 * Role sets that decide report visibility (monthly, compliance, quarterly and
 * annual). `src/reports/report-visibility-scope.ts` resolves the scope with
 * them; the capability `reports.view_periodic` reads the same sets.
 */
export const ALL_REPORTS_ROLES: ReadonlySet<string> = new Set([
  GlobalRole.SUPER_ADMIN,
  GlobalRole.ADMIN,
  GlobalRole.DIRECTOR_DIA,
  GlobalRole.ASSISTANT_DIA,
]);

export const UNION_REPORTS_ROLES: ReadonlySet<string> = new Set([
  GlobalRole.DIRECTOR_UNION,
  GlobalRole.ASSISTANT_UNION,
]);

export const LOCAL_FIELD_REPORTS_ROLES: ReadonlySet<string> = new Set([
  GlobalRole.ASSISTANT_ADMIN,
  GlobalRole.DIRECTOR_LF,
  GlobalRole.ASSISTANT_LF,
]);

export const COORDINATOR_REPORT_ROLES: ReadonlySet<string> = new Set([
  GlobalRole.COORDINATOR,
  GlobalRole.ZONE_COORDINATOR,
  GlobalRole.GENERAL_COORDINATOR,
]);

/** Club section of the active club grant, when there is one. */
export function activeGrantSectionId(
  resolved: ResolvedAuthorizationProfile,
): number | undefined {
  const authorization = resolved.authorization as
    Partial<ResolvedAuthorizationProfile['authorization']> | undefined;
  const activeAssignmentId = authorization?.active_assignment?.assignment_id;
  const grant = (authorization?.grants?.club_assignments ?? []).find(
    (assignment) => assignment.assignment_id === activeAssignmentId,
  );
  const sectionId = grant?.section?.club_section_id;
  return typeof sectionId === 'number' ? sectionId : undefined;
}

/**
 * True when the actor reaches reports ONLY through the coordinator branch:
 * a coordinator role with no territorial role and no club section of their
 * own. Quarterly and annual reports are not for them (the shared
 * `reports:read` / `reports:download` permissions stay because monthly
 * reports and compliance need them).
 */
export function isCoordinatorOnlyForPeriodicReports(
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
  if (!actor.hasAnyRole(COORDINATOR_REPORT_ROLES)) return false;
  return activeGrantSectionId(resolved) === undefined;
}

/**
 * Whether the actor can see quarterly / annual reports at all: holds
 * `reports:read` and resolves to a territorial scope or to a club section of
 * their own (never coordinator-only).
 */
export function canViewPeriodicReports(
  resolved: ResolvedAuthorizationProfile,
): boolean {
  const permissions =
    (
      resolved.authorization as
        Partial<ResolvedAuthorizationProfile['authorization']> | undefined
    )?.effective?.permissions ?? [];
  if (!permissions.includes('reports:read')) return false;

  const actor = ActorScope.from(resolved);
  if (
    actor.hasAnyRole(ALL_REPORTS_ROLES) ||
    actor.hasAnyRole(UNION_REPORTS_ROLES) ||
    actor.hasAnyRole(LOCAL_FIELD_REPORTS_ROLES)
  ) {
    return true;
  }
  return activeGrantSectionId(resolved) !== undefined;
}

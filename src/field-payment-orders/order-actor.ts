import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { ResolvedAuthorizationProfile } from '../common/services/authorization-context.service';

export type UserPayload = { sub?: string; user_id?: string; userId?: string };
export type RequestWithProfile = {
  user?: UserPayload;
  authorizationProfile?: ResolvedAuthorizationProfile;
};

export interface OrderActorSection {
  club_section_id: number;
  club_id: number;
  club_name: string;
  club_type_id: number;
  role_name: string;
  local_field_id?: number;
}

export interface OrderActor {
  userId: string;
  localFieldId?: number;
  sectionIds: number[];
  globalAccess: boolean;
  canReview: boolean;
  activeSection?: OrderActorSection;
}

const REVIEW_ROLES = ['director-lf', 'assistant-lf', 'admin', 'super-admin'];

/**
 * Same actor semantics as InsurancePurchasesController.resolveActor, plus the
 * active club section (from authorization.active_assignment) so order creation
 * can derive club/section/LF without trusting client-provided ids.
 */
export function resolveOrderActor(request: RequestWithProfile): OrderActor {
  const userId =
    request.user?.sub ?? request.user?.user_id ?? request.user?.userId;
  const profile = request.authorizationProfile;
  if (!userId || !profile) {
    throw new AppForbiddenException(ErrorCode.GUARD_USER_NOT_AUTHENTICATED);
  }

  const roles = new Set(
    profile.authorization.grants.global_roles.map((grant) =>
      grant.role_name.toLowerCase(),
    ),
  );
  const activeSectionGrants =
    profile.authorization.grants.club_assignments.filter(
      (grant) => grant.status === 'active',
    );
  const sectionIds = activeSectionGrants.map(
    (grant) => grant.section.club_section_id,
  );

  const activeAssignmentId =
    profile.authorization.active_assignment?.assignment_id ?? null;
  const activeGrant =
    (activeAssignmentId
      ? activeSectionGrants.find(
          (grant) => grant.assignment_id === activeAssignmentId,
        )
      : undefined) ??
    (activeSectionGrants.length === 1 ? activeSectionGrants[0] : undefined);

  const localFieldId =
    profile.authorization.effective.scope.global.local_field?.id ??
    activeGrant?.scope.local_field?.id;
  const globalAccess =
    (roles.has('admin') || roles.has('super-admin')) &&
    typeof localFieldId !== 'number';
  const canReview =
    REVIEW_ROLES.some((role) => roles.has(role)) &&
    (globalAccess || typeof localFieldId === 'number');

  return {
    userId,
    localFieldId: typeof localFieldId === 'number' ? localFieldId : undefined,
    sectionIds,
    globalAccess,
    canReview,
    activeSection: activeGrant
      ? {
          club_section_id: activeGrant.section.club_section_id,
          club_id: activeGrant.club.club_id,
          club_name: activeGrant.club.club_name,
          club_type_id: activeGrant.section.club_type_id,
          role_name: activeGrant.role_name,
          local_field_id:
            typeof activeGrant.scope.local_field?.id === 'number'
              ? activeGrant.scope.local_field.id
              : undefined,
        }
      : undefined,
  };
}

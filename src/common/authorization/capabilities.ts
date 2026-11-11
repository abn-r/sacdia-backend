import type { ResolvedAuthorizationProfile } from '../services/authorization-context.service';
import { ActorScope } from './actor-scope';
import {
  resolveActorTerritoryScope,
  type ActorTerritoryScope,
} from './actor-territory-scope';
import {
  CAPABILITY_KEYS,
  type CapabilityKey,
} from './generated/capability-keys';
import type { ClubRoleName, GlobalRoleName } from './generated/role-names';
import {
  ADMIN_SCOPE_ROLES,
  COORDINATOR_ROLES,
  DIVISION_ROLES,
  LOCAL_FIELD_ROLES,
  UNION_ROLES,
} from './role-sets';
import { ClubRole, GlobalRole } from './roles';
import { resolveAllowedTargetRoles } from './user-role-tiers';

export type { CapabilityKey };

/**
 * What the actor can attempt, published in `GET /auth/me` as
 * `data.authorization.{capabilities,territory,assignable_global_roles}` so the
 * admin panel and the app stop replicating role rules.
 *
 * Semantics of a capability: "the actor may ATTEMPT it on at least one
 * target". The services stay the authority and answer 403 when the concrete
 * target does not match (territory, club, window, state). Territory-based
 * keys are false for the `open` and `unconfigured` levels.
 *
 * Everything here is pure (no injection, no I/O): it reads an already
 * resolved profile and is computed PER REQUEST in `AuthService.getProfile`
 * after `stripClubContext`, so nothing enters the authorization cache and
 * `ResolvedAuthorizationProfile` keeps its shape.
 *
 * Adding a key: add its predicate to `CAPABILITY_DEFINITIONS`, run
 * `pnpm authz:generate` (which rewrites `generated/capability-keys.ts` for the
 * three repos from these keys) and extend `capabilities.spec.ts`.
 */

export type TerritoryLevel = ActorTerritoryScope['level'];

export type ActorTerritory = {
  level: TerritoryLevel;
  division_id: number | null;
  union_id: number | null;
  local_field_id: number | null;
};

/** Everything the predicates read, derived once per profile. */
export type CapabilityContext = {
  /** Global roles (lower-cased) of the actor. */
  actor: ActorScope;
  territory: ActorTerritory;
  /**
   * Role of the active club grant (`effective.scope.club.role_name`), only
   * when that grant is `operational`; undefined otherwise (also after
   * `stripClubContext`).
   */
  activeClubRole: ClubRoleName | string | undefined;
  /**
   * Local field of the active club grant (`scope.local_field.id`), only when
   * that grant is `operational` and the id is numeric; null otherwise.
   */
  activeClubLocalFieldId: number | null;
  /** At least one `operational` club grant, active or not. */
  hasOperationalClubGrant: boolean;
  /** `profile.local_field_id` (the person's own field). */
  profileLocalFieldId: number | null;
  assignableGlobalRoles: string[];
};

export type CapabilityPredicate = (ctx: CapabilityContext) => boolean;

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const LEVELS_WITH_TERRITORY: readonly TerritoryLevel[] = [
  'all',
  'division',
  'union',
  'local_field',
];

const SUPER_ADMIN_ONLY: readonly GlobalRoleName[] = [GlobalRole.SUPER_ADMIN];
const PLATFORM_ADMINS: readonly GlobalRoleName[] = [
  GlobalRole.SUPER_ADMIN,
  GlobalRole.ADMIN,
];
const PLATFORM_ADMINS_AND_LOCAL_FIELD: readonly GlobalRoleName[] = [
  ...PLATFORM_ADMINS,
  ...LOCAL_FIELD_ROLES,
];
const ADMIN_SCOPE_AND_LOCAL_FIELD: readonly GlobalRoleName[] = [
  ...ADMIN_SCOPE_ROLES,
  ...LOCAL_FIELD_ROLES,
];
const USER_MANAGEMENT_ROLES: readonly GlobalRoleName[] = [
  ...PLATFORM_ADMINS,
  ...LOCAL_FIELD_ROLES,
  ...UNION_ROLES,
  ...DIVISION_ROLES,
];

const CLUB_OPERATIONAL_STAFF: readonly ClubRoleName[] = [
  ClubRole.DIRECTOR,
  ClubRole.DEPUTY_DIRECTOR,
  ClubRole.SECRETARY,
  ClubRole.TREASURER,
  ClubRole.SECRETARY_TREASURER,
  ClubRole.COUNSELOR,
];
const CLUB_ADMINISTRATIVE_STAFF: readonly ClubRoleName[] = [
  ClubRole.DIRECTOR,
  ClubRole.DEPUTY_DIRECTOR,
  ClubRole.SECRETARY,
  ClubRole.TREASURER,
  ClubRole.SECRETARY_TREASURER,
];
const CLUB_MANAGEMENT_STAFF: readonly ClubRoleName[] = [
  ClubRole.DIRECTOR,
  ClubRole.DEPUTY_DIRECTOR,
  ClubRole.SECRETARY,
  ClubRole.SECRETARY_TREASURER,
];
const CLUB_BOARD: readonly ClubRoleName[] = [
  ClubRole.DIRECTOR,
  ClubRole.SECRETARY,
  ClubRole.SECRETARY_TREASURER,
];
const CLUB_DIRECTION: readonly ClubRoleName[] = [
  ClubRole.DIRECTOR,
  ClubRole.DEPUTY_DIRECTOR,
];

const levelIn =
  (...levels: readonly TerritoryLevel[]): CapabilityPredicate =>
  ({ territory }) =>
    levels.includes(territory.level);

const globalRoleIn =
  (roles: readonly GlobalRoleName[]): CapabilityPredicate =>
  ({ actor }) =>
    actor.hasAnyRole(roles);

const clubRoleIn =
  (roles: readonly ClubRoleName[]): CapabilityPredicate =>
  ({ activeClubRole }) =>
    activeClubRole !== undefined &&
    (roles as readonly string[]).includes(activeClubRole);

const every =
  (...predicates: CapabilityPredicate[]): CapabilityPredicate =>
  (ctx) =>
    predicates.every((predicate) => predicate(ctx));

const some =
  (...predicates: CapabilityPredicate[]): CapabilityPredicate =>
  (ctx) =>
    predicates.some((predicate) => predicate(ctx));

const localFieldReviewer: CapabilityPredicate = some(
  globalRoleIn(ADMIN_SCOPE_ROLES),
  every(
    globalRoleIn(LOCAL_FIELD_ROLES),
    ({ profileLocalFieldId }) => profileLocalFieldId !== null,
  ),
);

const localFieldCamporeeReviewer: CapabilityPredicate = every(
  globalRoleIn(PLATFORM_ADMINS_AND_LOCAL_FIELD),
  levelIn('all', 'local_field'),
);

/**
 * Mirrors `resolveOrderActor` (`field-payment-orders/order-actor.ts`): a local
 * field role reviews with the field of its global scope OR the field of its
 * active club grant; platform admins review everywhere.
 */
const fieldPaymentOrderReviewer: CapabilityPredicate = some(
  globalRoleIn(PLATFORM_ADMINS),
  every(
    globalRoleIn(LOCAL_FIELD_ROLES),
    ({ territory, activeClubLocalFieldId }) =>
      territory.local_field_id !== null || activeClubLocalFieldId !== null,
  ),
);

const sectionRoleManager: CapabilityPredicate = globalRoleIn(
  PLATFORM_ADMINS_AND_LOCAL_FIELD,
);

/**
 * Mirrors `SectionRoleMutationPolicy.assertCanMutate`: besides the global
 * section-role managers, the operational director of the active club section
 * may assign another user any role but director. The window and the "not
 * yourself / not director" checks stay on the server.
 */
const sectionRoleAssigner: CapabilityPredicate = some(
  sectionRoleManager,
  clubRoleIn([ClubRole.DIRECTOR]),
);

/**
 * Key → pure predicate. Keys are the capability catalog: the generator emits
 * `generated/capability-keys.ts` (and the admin/app copies) from them, and
 * the `Record<CapabilityKey, …>` type keeps both in sync at compile time.
 */
export const CAPABILITY_DEFINITIONS: Record<
  CapabilityKey,
  CapabilityPredicate
> = {
  'admin_panel.access': ({ actor }) =>
    [...actor.globalRoles].some((role) => role !== GlobalRole.USER),
  'admin_panel.pastor_only': ({ actor }) =>
    actor.globalRoles.size > 0 &&
    [...actor.globalRoles].every((role) => role === GlobalRole.PASTOR),
  'audit.read_system': globalRoleIn(SUPER_ADMIN_ONLY),
  'camporee_orders.configure_offering': levelIn('all', 'local_field', 'union'),
  'camporee_orders.issue': clubRoleIn(CLUB_ADMINISTRATIVE_STAFF),
  'camporee_orders.review_payment': localFieldCamporeeReviewer,
  'camporee_supplies.configure': every(
    globalRoleIn([...PLATFORM_ADMINS, ...LOCAL_FIELD_ROLES, ...UNION_ROLES]),
    levelIn('all', 'local_field', 'union'),
  ),
  'camporee_supplies.deliver': localFieldCamporeeReviewer,
  'camporee_supplies.plan': clubRoleIn(CLUB_BOARD),
  'camporee_supplies.review_payment': localFieldCamporeeReviewer,
  'catalogs.edit': globalRoleIn(ADMIN_SCOPE_ROLES),
  'catalogs.manage_protected': globalRoleIn(SUPER_ADMIN_ONLY),
  'certificates.review_imports': localFieldReviewer,
  'club.active_director': clubRoleIn([ClubRole.DIRECTOR]),
  'club.operational_staff': clubRoleIn(CLUB_OPERATIONAL_STAFF),
  'club.staff_mode': ({ activeClubRole }) =>
    activeClubRole !== undefined && activeClubRole !== ClubRole.MEMBER,
  // Platform admins (assistant-admin included), Local Field, Union, Division,
  // coordinators and pastors approve or reject the annual enrollment of the
  // sections in their scope; the service decides which sections.
  'club_enrollments.validate': globalRoleIn([
    ...ADMIN_SCOPE_ROLES,
    ...LOCAL_FIELD_ROLES,
    ...UNION_ROLES,
    ...DIVISION_ROLES,
    ...COORDINATOR_ROLES,
    GlobalRole.PASTOR,
  ]),
  'club_roles.assign_section': sectionRoleAssigner,
  // The October–December window is still enforced by the server.
  'club_roles.designate_director': sectionRoleManager,
  'club_roles.succeed_director': sectionRoleManager,
  'club_sections.create_active': clubRoleIn(CLUB_DIRECTION),
  'clubs.deactivate_active': clubRoleIn([ClubRole.DIRECTOR]),
  'clubs.manage_active': clubRoleIn(CLUB_MANAGEMENT_STAFF),
  'coordination.hub_view': globalRoleIn([
    ...ADMIN_SCOPE_ROLES,
    ...COORDINATOR_ROLES,
    ...LOCAL_FIELD_ROLES,
  ]),
  // Writing zones and assignments is the local field's job; union and division
  // only read. Not `levelIn`: `admin` anchors in a union and would get `union`.
  'coordination.manage': globalRoleIn(ADMIN_SCOPE_AND_LOCAL_FIELD),
  'field_payment_orders.review': fieldPaymentOrderReviewer,
  'folders.confirm_union': globalRoleIn(UNION_ROLES),
  'folders.evaluate': levelIn(...LEVELS_WITH_TERRITORY),
  'honors.review_instructor_proposals': localFieldReviewer,
  'institutional_certificates.review': globalRoleIn(SUPER_ADMIN_ONLY),
  'investiture.assign_district_pastors': globalRoleIn(LOCAL_FIELD_ROLES),
  'investiture.authorize_requests': globalRoleIn([
    ...LOCAL_FIELD_ROLES,
    GlobalRole.PASTOR,
  ]),
  'investiture.board': clubRoleIn(CLUB_BOARD),
  'investiture.configure_field_window': globalRoleIn(
    ADMIN_SCOPE_AND_LOCAL_FIELD,
  ),
  'investiture.consult_field_window': globalRoleIn([
    ...ADMIN_SCOPE_AND_LOCAL_FIELD,
    ...UNION_ROLES,
    ...DIVISION_ROLES,
  ]),
  'rbac.manage': globalRoleIn(SUPER_ADMIN_ONLY),
  'rbac.mutate_global_roles': globalRoleIn(SUPER_ADMIN_ONLY),
  'rbac.view_user_roles': globalRoleIn(PLATFORM_ADMINS),
  'reports.view_all': globalRoleIn([...PLATFORM_ADMINS, ...DIVISION_ROLES]),
  'reports.view_local_field': every(
    globalRoleIn([GlobalRole.ASSISTANT_ADMIN, ...LOCAL_FIELD_ROLES]),
    ({ territory }) => territory.local_field_id !== null,
  ),
  'reports.view_union': every(
    globalRoleIn(UNION_ROLES),
    ({ territory }) => territory.union_id !== null,
  ),
  'scoring_categories.manage': some(
    levelIn(...LEVELS_WITH_TERRITORY),
    ({ hasOperationalClubGrant }) => hasOperationalClubGrant,
  ),
  // Platform admins, Local Field, coordinators and pastors review the
  // counselor «constancia» of the people in their scope; the service decides
  // which people (assistant-admin does not hold the permission).
  'service_credentials.review': globalRoleIn([
    ...PLATFORM_ADMINS,
    ...LOCAL_FIELD_ROLES,
    ...COORDINATOR_ROLES,
    GlobalRole.PASTOR,
  ]),
  'system.config.read': globalRoleIn(ADMIN_SCOPE_ROLES),
  'system.jobs.run': globalRoleIn(SUPER_ADMIN_ONLY),
  'units.manage': clubRoleIn(CLUB_ADMINISTRATIVE_STAFF),
  'users.create_in_scope': ({ assignableGlobalRoles }) =>
    assignableGlobalRoles.length > 0,
  'users.manage_in_scope': globalRoleIn(USER_MANAGEMENT_ROLES),
  'users.update_admin_fields': globalRoleIn(PLATFORM_ADMINS),
};

/** `territory` block of `GET /auth/me`, from `resolveActorTerritoryScope`. */
export function computeTerritory(
  resolved: ResolvedAuthorizationProfile,
): ActorTerritory {
  const scope = resolveActorTerritoryScope(resolved);
  const ids: {
    divisionId?: number;
    unionId?: number;
    localFieldId?: number;
  } =
    scope.level === 'division' ||
    scope.level === 'union' ||
    scope.level === 'local_field'
      ? scope
      : {};
  return {
    level: scope.level,
    division_id: ids.divisionId ?? null,
    union_id: ids.unionId ?? null,
    local_field_id: ids.localFieldId ?? null,
  };
}

/**
 * Global roles the actor may assign when creating a user (tier below their
 * own, see `user-role-tiers.ts`), sorted ascending. `[]` outside the admin
 * tiers.
 */
export function assignableGlobalRoles(
  resolved: ResolvedAuthorizationProfile,
): string[] {
  return resolveAllowedTargetRoles(ActorScope.from(resolved).globalRoles).sort(
    byString,
  );
}

export function buildCapabilityContext(
  resolved: ResolvedAuthorizationProfile,
): CapabilityContext {
  const actor = ActorScope.from(resolved);
  // Tolerant of partial profiles, like `ActorScope.from`.
  const authorization = resolved.authorization as
    Partial<ResolvedAuthorizationProfile['authorization']> | undefined;
  const clubGrants = authorization?.grants?.club_assignments ?? [];
  const activeClub = authorization?.effective?.scope?.club ?? null;
  const activeGrant = activeClub
    ? clubGrants.find(
        (grant) => grant.assignment_id === activeClub.assignment_id,
      )
    : undefined;
  const activeClubRole =
    activeGrant?.operational === true
      ? activeClub?.role_name?.toLowerCase()
      : undefined;
  const activeGrantLocalFieldId =
    activeGrant?.operational === true
      ? activeGrant.scope?.local_field?.id
      : undefined;
  const activeClubLocalFieldId =
    typeof activeGrantLocalFieldId === 'number'
      ? activeGrantLocalFieldId
      : null;
  const profileLocalFieldId =
    (resolved.profile as { local_field_id?: number | null } | undefined)
      ?.local_field_id ?? null;

  return {
    actor,
    territory: computeTerritory(resolved),
    activeClubRole,
    activeClubLocalFieldId,
    hasOperationalClubGrant: clubGrants.some(
      (grant) => grant.operational === true,
    ),
    profileLocalFieldId,
    assignableGlobalRoles: assignableGlobalRoles(resolved),
  };
}

/** Capability keys the actor holds, sorted ascending (byte order). */
export function computeCapabilities(
  resolved: ResolvedAuthorizationProfile,
): CapabilityKey[] {
  const ctx = buildCapabilityContext(resolved);
  return CAPABILITY_KEYS.filter((key) => CAPABILITY_DEFINITIONS[key](ctx)).sort(
    byString,
  );
}

/** The three blocks `GET /auth/me` adds to `data.authorization`. */
export function computeActorAuthorizationSummary(
  resolved: ResolvedAuthorizationProfile,
): {
  capabilities: CapabilityKey[];
  territory: ActorTerritory;
  assignable_global_roles: string[];
} {
  const ctx = buildCapabilityContext(resolved);
  return {
    capabilities: CAPABILITY_KEYS.filter((key) =>
      CAPABILITY_DEFINITIONS[key](ctx),
    ).sort(byString),
    territory: ctx.territory,
    assignable_global_roles: ctx.assignableGlobalRoles,
  };
}

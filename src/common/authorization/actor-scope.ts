import type {
  AuthorizationContextService,
  ResolvedAuthorizationProfile,
} from '../services/authorization-context.service';

type HierarchyNode = {
  division_id?: number | null;
  union_id?: number | null;
  local_field_id?: number | null;
};

function numericId(node: { id: number | string } | null | undefined) {
  return typeof node?.id === 'number' ? node.id : undefined;
}

function normalizeRole(role: string): string {
  return role.toLowerCase();
}

/**
 * Read-only view of "who is acting and where": the actor's global roles, the
 * territory of their global scope and the club they currently act in. It only
 * reads an already-resolved profile (no I/O, no injection); the two async-free
 * delegates take the `AuthorizationContextService` as an argument so callers
 * stop re-implementing the hierarchy ladder.
 *
 * Territory ids come from `effective.scope.global` exactly as the guard and
 * the territory validators read them today. Active-club ids come from
 * `effective.scope.club`; `activeLocalFieldId` comes from the club grant
 * matching `active_assignment` (the grant's own local field).
 */
export class ActorScope {
  private constructor(
    readonly userId: string,
    readonly globalRoles: ReadonlySet<string>,
    readonly divisionId: number | undefined,
    readonly unionId: number | undefined,
    readonly localFieldId: number | undefined,
    readonly countryId: number | undefined,
    readonly activeClubId: number | undefined,
    readonly activeSectionId: number | undefined,
    readonly activeLocalFieldId: number | undefined,
    readonly coordinatorSectionIds: readonly number[],
    private readonly resolved?: ResolvedAuthorizationProfile,
  ) {}

  static from(
    resolved: ResolvedAuthorizationProfile,
    extra?: { coordinatorSectionIds?: readonly number[] },
  ): ActorScope {
    // Tolerant of partial profiles: several callers (and their specs) hand
    // in only the slice of the profile they care about.
    const authorization = resolved.authorization as
      Partial<ResolvedAuthorizationProfile['authorization']> | undefined;
    const global = authorization?.effective?.scope?.global ?? {};
    const activeClub = authorization?.effective?.scope?.club;
    const activeAssignmentId = authorization?.active_assignment?.assignment_id;
    const activeGrant = (authorization?.grants?.club_assignments ?? []).find(
      (assignment) => assignment.assignment_id === activeAssignmentId,
    );

    return new ActorScope(
      (resolved.profile as { user_id?: string } | undefined)?.user_id ?? '',
      new Set(
        (authorization?.grants?.global_roles ?? []).map((grant) =>
          normalizeRole(grant.role_name),
        ),
      ),
      numericId(global.division),
      numericId(global.union),
      numericId(global.local_field),
      numericId(global.country),
      activeClub?.club?.club_id,
      activeClub?.section?.club_section_id,
      numericId(activeGrant?.scope?.local_field),
      extra?.coordinatorSectionIds ?? [],
      resolved,
    );
  }

  /**
   * Role-only actor for adapters that already carry a normalised role list
   * (e.g. `CamporeeOrderActor.globalRoles`) and no profile.
   */
  static fromRoleNames(roles: Iterable<string>, userId = ''): ActorScope {
    return new ActorScope(
      userId,
      new Set([...roles].map(normalizeRole)),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [],
    );
  }

  /**
   * True when the actor holds ANY of the global roles. Replaces
   * `TerritoryScopeValidator.hasGlobalRole` and the private role-set copies
   * (`globalRoleNameSet` + `hasAnyRole` in the report/camporee adapters).
   */
  hasRole(...names: string[]): boolean {
    return this.hasAnyRole(names);
  }

  hasAnyRole(names: Iterable<string>): boolean {
    for (const name of names) {
      if (this.globalRoles.has(normalizeRole(name))) return true;
    }
    return false;
  }

  /**
   * Territory ladder (`canAccessHierarchyScope`). Delegates; synchronous
   * because the service resolves it from the already-loaded profile.
   */
  coversHierarchy(
    node: HierarchyNode,
    authorizationContext: Pick<
      AuthorizationContextService,
      'canAccessHierarchyScope'
    >,
    mode: 'current-write' | 'historical-read' = 'current-write',
  ): boolean {
    return authorizationContext.canAccessHierarchyScope(
      this.requireResolved(),
      node,
      mode,
    );
  }

  /** Replaces direct `authorizationContext.canManageClub(userId, clubId, resolved)` calls. */
  coversClub(
    clubId: number,
    authorizationContext: Pick<AuthorizationContextService, 'canManageClub'>,
  ): Promise<boolean> {
    return authorizationContext.canManageClub(
      this.userId,
      clubId,
      this.requireResolved(),
    );
  }

  /**
   * Section where the actor acts (active club section) or coordinates.
   * Replaces `activeClubScope.section.club_section_id === id` checks.
   */
  coversSection(sectionId: number): boolean {
    return (
      this.activeSectionId === sectionId ||
      this.coordinatorSectionIds.includes(sectionId)
    );
  }

  /**
   * Sync local-field match: own global local field or the active grant's.
   * Territory queries (union/division descendants) stay in
   * actor-territory-scope.
   */
  coversLocalField(id: number): boolean {
    return this.localFieldId === id || this.activeLocalFieldId === id;
  }

  private requireResolved(): ResolvedAuthorizationProfile {
    if (!this.resolved) {
      throw new Error('ActorScope built from role names has no profile');
    }
    return this.resolved;
  }
}

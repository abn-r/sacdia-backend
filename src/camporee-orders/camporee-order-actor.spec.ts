import { ErrorCode } from '../common/errors/error-codes';
import type { ActorTerritoryScope } from '../common/authorization/actor-territory-scope';
import type { ResolvedAuthorizationProfile } from '../common/services/authorization-context.service';
import {
  ISSUER_CLUB_ROLES,
  assertCanDistribute,
  assertCanIssueOrder,
  canAuthorizeWithoutProof,
  canConfigureOffering,
  canDeliverToSection,
  canManageCatalog,
  canReviewPayment,
  resolveCamporeeOrderActor,
  type CamporeeOrderActor,
  type RequestWithProfile,
} from './camporee-order-actor';

const LF_10 = 10;
const LF_11 = 11;
const UNION_2 = 2;
const UNION_3 = 3;
const DIVISION_1 = 1;
const DIVISION_9 = 9;
const SECTION_11 = 11;
const SECTION_12 = 12;

function baseActor(
  overrides: Partial<CamporeeOrderActor> & {
    territory: ActorTerritoryScope;
  },
): CamporeeOrderActor {
  return {
    userId: 'user-1',
    sectionIds: [],
    globalAccess: false,
    canReview: false,
    globalRoles: [],
    ...overrides,
  };
}

function lfActor(
  localFieldId: number,
  role: 'director-lf' | 'assistant-lf' = 'director-lf',
): CamporeeOrderActor {
  return baseActor({
    userId: `${role}-${localFieldId}`,
    localFieldId,
    globalRoles: [role],
    canReview: true,
    territory: {
      level: 'local_field',
      localFieldId,
      unionId: UNION_2,
      divisionId: DIVISION_1,
    },
  });
}

function unionActor(
  unionId: number,
  role: 'director-union' | 'assistant-union' = 'director-union',
): CamporeeOrderActor {
  return baseActor({
    userId: `${role}-${unionId}`,
    localFieldId: LF_10,
    globalRoles: [role],
    territory: {
      level: 'union',
      unionId,
      localFieldId: LF_10,
      divisionId: DIVISION_1,
    },
  });
}

function divisionActor(
  divisionId: number,
  role: 'director-dia' | 'assistant-dia' = 'director-dia',
): CamporeeOrderActor {
  return baseActor({
    userId: `${role}-${divisionId}`,
    globalRoles: [role],
    territory: {
      level: 'division',
      divisionId,
      unionId: UNION_2,
      localFieldId: LF_10,
    },
  });
}

function superAdminActor(): CamporeeOrderActor {
  return baseActor({
    userId: 'super-admin',
    globalAccess: true,
    canReview: true,
    globalRoles: ['super-admin'],
    territory: { level: 'all' },
  });
}

function clubActor(
  role: string,
  sectionId = SECTION_11,
): CamporeeOrderActor {
  return baseActor({
    userId: `club-${role}`,
    localFieldId: LF_10,
    sectionIds: [sectionId],
    globalRoles: [],
    territory: { level: 'open' },
    activeSection: {
      club_section_id: sectionId,
      club_id: 5,
      club_name: 'Club Orión',
      club_type_id: 1,
      role_name: role,
      local_field_id: LF_10,
    },
  });
}

function profileFor(options: {
  globalRoles?: string[];
  localFieldId?: number;
  unionId?: number;
  divisionId?: number;
  clubRole?: string;
  clubSectionId?: number;
  assignmentStatus?: string;
  activeAssignment?: boolean;
}): ResolvedAuthorizationProfile {
  const assignmentId = 'assignment-1';
  const clubSectionId = options.clubSectionId ?? SECTION_11;
  const clubRole = options.clubRole;
  const hasClub = typeof clubRole === 'string';

  return {
    profile: {
      user_id: 'user-1',
      email: 'user@example.com',
      name: 'Test',
      paternal_last_name: null,
      maternal_last_name: null,
      gender: null,
      birthday: null,
      baptism: false,
      baptism_date: null,
      blood: null,
      user_image: null,
      country_id: 1,
      union_id: options.unionId ?? null,
      local_field_id: options.localFieldId ?? null,
      created_at: new Date('2026-01-01'),
    },
    post_register_complete: true,
    authorization: {
      grants: {
        global_roles: (options.globalRoles ?? []).map((role_name) => ({
          role_name,
          permissions: [],
          scope: {},
        })),
        club_assignments: hasClub
          ? [
              {
                assignment_id: assignmentId,
                role_name: clubRole,
                permissions: [],
                club: { club_id: 5, club_name: 'Club Orión' },
                section: {
                  club_section_id: clubSectionId,
                  club_type_id: 1,
                },
                scope: {
                  ...(options.divisionId === undefined
                    ? {}
                    : { division: { id: options.divisionId } }),
                  ...(options.unionId === undefined
                    ? {}
                    : { union: { id: options.unionId } }),
                  ...(options.localFieldId === undefined
                    ? {}
                    : { local_field: { id: options.localFieldId } }),
                },
                status: options.assignmentStatus ?? 'active',
              },
            ]
          : [],
        direct_permissions: [],
      },
      active_assignment: {
        assignment_id:
          hasClub && options.activeAssignment !== false ? assignmentId : null,
      },
      effective: {
        permissions: [],
        scope: {
          global: {
            ...(options.divisionId === undefined
              ? {}
              : { division: { id: options.divisionId } }),
            ...(options.unionId === undefined
              ? {}
              : { union: { id: options.unionId } }),
            ...(options.localFieldId === undefined
              ? {}
              : { local_field: { id: options.localFieldId } }),
          },
          club: null,
        },
      },
    },
    legacy: {
      roles: [],
      permissions: [],
      club: null,
      club_context: {
        active_assignment_id: null,
        active: null,
        available: [],
      },
    },
  };
}

function requestFor(
  options: Parameters<typeof profileFor>[0] & { userId?: string | null },
): RequestWithProfile {
  const { userId = 'user-1', ...profileOptions } = options;
  return {
    ...(userId === null ? {} : { user: { sub: userId } }),
    authorizationProfile: profileFor(profileOptions),
  };
}

describe('resolveCamporeeOrderActor', () => {
  it('throws GUARD_USER_NOT_AUTHENTICATED without a user', () => {
    expect(() =>
      resolveCamporeeOrderActor(requestFor({ userId: null, clubRole: 'director' })),
    ).toThrow(
      expect.objectContaining({ code: ErrorCode.GUARD_USER_NOT_AUTHENTICATED }),
    );
  });

  it('throws GUARD_USER_NOT_AUTHENTICATED without an authorization profile', () => {
    expect(() =>
      resolveCamporeeOrderActor({ user: { sub: 'user-1' } }),
    ).toThrow(
      expect.objectContaining({ code: ErrorCode.GUARD_USER_NOT_AUTHENTICATED }),
    );
  });

  it('wraps the order actor with territorial scope from the profile', () => {
    const actor = resolveCamporeeOrderActor(
      requestFor({
        globalRoles: ['director-lf'],
        localFieldId: LF_10,
        unionId: UNION_2,
        divisionId: DIVISION_1,
      }),
    );

    expect(actor.userId).toBe('user-1');
    expect(actor.localFieldId).toBe(LF_10);
    expect(actor.globalRoles).toEqual(['director-lf']);
    expect(actor.territory).toMatchObject({
      level: 'local_field',
      localFieldId: LF_10,
    });
  });

  it('resolves unconfigured when a territorial role is missing its id', () => {
    const actor = resolveCamporeeOrderActor(
      requestFor({ globalRoles: ['director-union'] }),
    );
    expect(actor.territory).toEqual({ level: 'unconfigured' });
  });
});

describe('assertCanIssueOrder', () => {
  it.each([...ISSUER_CLUB_ROLES])(
    'allows club role %s with an active section',
    (role) => {
      expect(() => assertCanIssueOrder(clubActor(role))).not.toThrow();
    },
  );

  it('allows issuer roles regardless of stored casing', () => {
    expect(() => assertCanIssueOrder(clubActor('Director'))).not.toThrow();
    expect(() =>
      assertCanIssueOrder(clubActor('Secretary-Treasurer')),
    ).not.toThrow();
  });

  it('forbids counselor even with an active section', () => {
    expect(() => assertCanIssueOrder(clubActor('counselor'))).toThrow(
      expect.objectContaining({ code: ErrorCode.CAMPOREE_ORDER_FORBIDDEN }),
    );
  });

  it('forbids a club actor without an active section', () => {
    const actor = resolveCamporeeOrderActor(
      requestFor({
        clubRole: 'director',
        localFieldId: LF_10,
        activeAssignment: false,
        assignmentStatus: 'inactive',
      }),
    );
    expect(actor.activeSection).toBeUndefined();
    expect(() => assertCanIssueOrder(actor)).toThrow(
      expect.objectContaining({ code: ErrorCode.CAMPOREE_ORDER_FORBIDDEN }),
    );
  });

  it('forbids LF leadership without a club section', () => {
    expect(() => assertCanIssueOrder(lfActor(LF_10))).toThrow(
      expect.objectContaining({ code: ErrorCode.CAMPOREE_ORDER_FORBIDDEN }),
    );
  });
});

describe('assertCanDistribute', () => {
  it('allows the director of the order section', () => {
    expect(() =>
      assertCanDistribute(clubActor('director', SECTION_11), SECTION_11),
    ).not.toThrow();
  });

  it('forbids deputy-director from distributing', () => {
    expect(() =>
      assertCanDistribute(clubActor('deputy-director', SECTION_11), SECTION_11),
    ).toThrow(
      expect.objectContaining({ code: ErrorCode.CAMPOREE_ORDER_FORBIDDEN }),
    );
  });

  it('forbids secretary and treasurer from distributing', () => {
    expect(() =>
      assertCanDistribute(clubActor('secretary', SECTION_11), SECTION_11),
    ).toThrow(
      expect.objectContaining({ code: ErrorCode.CAMPOREE_ORDER_FORBIDDEN }),
    );
    expect(() =>
      assertCanDistribute(clubActor('treasurer', SECTION_11), SECTION_11),
    ).toThrow(
      expect.objectContaining({ code: ErrorCode.CAMPOREE_ORDER_FORBIDDEN }),
    );
  });

  it('forbids a director of a different section', () => {
    expect(() =>
      assertCanDistribute(clubActor('director', SECTION_11), SECTION_12),
    ).toThrow(
      expect.objectContaining({ code: ErrorCode.CAMPOREE_ORDER_FORBIDDEN }),
    );
  });

  it('forbids an actor without an active section', () => {
    expect(() => assertCanDistribute(lfActor(LF_10), SECTION_11)).toThrow(
      expect.objectContaining({ code: ErrorCode.CAMPOREE_ORDER_FORBIDDEN }),
    );
  });
});

describe('canManageCatalog', () => {
  const lf10Owner = {
    scope: 'LOCAL_FIELD' as const,
    localFieldId: LF_10,
    unionId: UNION_2,
    divisionId: DIVISION_1,
  };
  const lf11Owner = {
    scope: 'LOCAL_FIELD' as const,
    localFieldId: LF_11,
    unionId: UNION_3,
    divisionId: DIVISION_1,
  };
  const union2Owner = {
    scope: 'UNION' as const,
    unionId: UNION_2,
    divisionId: DIVISION_1,
  };
  const division1Owner = {
    scope: 'DIVISION' as const,
    divisionId: DIVISION_1,
  };

  it('lets LF leadership manage its own local-field catalog', () => {
    expect(canManageCatalog(lfActor(LF_10), lf10Owner)).toBe(true);
    expect(canManageCatalog(lfActor(LF_10, 'assistant-lf'), lf10Owner)).toBe(
      true,
    );
  });

  it('rejects a sibling local field', () => {
    expect(canManageCatalog(lfActor(LF_10), lf11Owner)).toBe(false);
  });

  it('lets a union actor manage LF catalogs in that union and its own union catalog', () => {
    const actor = unionActor(UNION_2);
    expect(canManageCatalog(actor, lf10Owner)).toBe(true);
    expect(canManageCatalog(actor, union2Owner)).toBe(true);
    expect(canManageCatalog(actor, lf11Owner)).toBe(false);
    expect(
      canManageCatalog(actor, { scope: 'UNION', unionId: UNION_3 }),
    ).toBe(false);
  });

  it('does not let LF create or mutate union-owned products', () => {
    expect(canManageCatalog(lfActor(LF_10), union2Owner)).toBe(false);
  });

  it('lets a division actor manage descendant union and LF catalogs, and its division catalog', () => {
    const actor = divisionActor(DIVISION_1);
    expect(canManageCatalog(actor, division1Owner)).toBe(true);
    expect(canManageCatalog(actor, union2Owner)).toBe(true);
    expect(canManageCatalog(actor, lf10Owner)).toBe(true);
    expect(
      canManageCatalog(actor, { scope: 'DIVISION', divisionId: DIVISION_9 }),
    ).toBe(false);
  });

  it('does not let union or LF manage a division-owned catalog', () => {
    expect(canManageCatalog(unionActor(UNION_2), division1Owner)).toBe(false);
    expect(canManageCatalog(lfActor(LF_10), division1Owner)).toBe(false);
  });

  it('lets super-admin manage every owner scope', () => {
    const actor = superAdminActor();
    expect(canManageCatalog(actor, lf10Owner)).toBe(true);
    expect(canManageCatalog(actor, union2Owner)).toBe(true);
    expect(canManageCatalog(actor, division1Owner)).toBe(true);
  });

  it('fails closed for unconfigured and open actors', () => {
    const unconfigured = baseActor({
      globalRoles: ['director-union'],
      territory: { level: 'unconfigured' },
    });
    const open = clubActor('director');
    expect(canManageCatalog(unconfigured, union2Owner)).toBe(false);
    expect(canManageCatalog(open, lf10Owner)).toBe(false);
  });
});

describe('canConfigureOffering', () => {
  const local10 = { type: 'local' as const, localFieldId: LF_10 };
  const local11 = { type: 'local' as const, localFieldId: LF_11 };
  const union2 = { type: 'union' as const, unionId: UNION_2 };

  it('lets LF of the organizer configure a local camporee', () => {
    expect(canConfigureOffering(lfActor(LF_10), local10)).toBe(true);
    expect(canConfigureOffering(lfActor(LF_10, 'assistant-lf'), local10)).toBe(
      true,
    );
  });

  it('does not let a sibling LF or union director configure a local camporee', () => {
    expect(canConfigureOffering(lfActor(LF_10), local11)).toBe(false);
    expect(canConfigureOffering(unionActor(UNION_2), local10)).toBe(false);
  });

  it('lets the organizing union configure a union camporee', () => {
    expect(canConfigureOffering(unionActor(UNION_2), union2)).toBe(true);
    expect(
      canConfigureOffering(unionActor(UNION_2, 'assistant-union'), union2),
    ).toBe(true);
  });

  it('does not let LF or division configure a union camporee', () => {
    expect(canConfigureOffering(lfActor(LF_10), union2)).toBe(false);
    expect(canConfigureOffering(divisionActor(DIVISION_1), union2)).toBe(false);
    expect(canConfigureOffering(divisionActor(DIVISION_1), local10)).toBe(
      false,
    );
  });

  it('lets super-admin configure both camporee types', () => {
    expect(canConfigureOffering(superAdminActor(), local10)).toBe(true);
    expect(canConfigureOffering(superAdminActor(), union2)).toBe(true);
  });

  it('fails closed for unconfigured and open actors', () => {
    expect(
      canConfigureOffering(
        baseActor({
          globalRoles: ['director-lf'],
          territory: { level: 'unconfigured' },
        }),
        local10,
      ),
    ).toBe(false);
    expect(canConfigureOffering(clubActor('director'), local10)).toBe(false);
  });
});

describe('canReviewPayment / authorize / deliver', () => {
  it('lets director-lf and assistant-lf review their own local field', () => {
    expect(canReviewPayment(lfActor(LF_10), LF_10)).toBe(true);
    expect(canReviewPayment(lfActor(LF_10, 'assistant-lf'), LF_10)).toBe(true);
    expect(canAuthorizeWithoutProof(lfActor(LF_10), LF_10)).toBe(true);
    expect(canDeliverToSection(lfActor(LF_10), LF_10)).toBe(true);
  });

  it('rejects a sibling local field', () => {
    expect(canReviewPayment(lfActor(LF_10), LF_11)).toBe(false);
    expect(canAuthorizeWithoutProof(lfActor(LF_10), LF_11)).toBe(false);
    expect(canDeliverToSection(lfActor(LF_10), LF_11)).toBe(false);
  });

  it('does not let union or division directors review LF caja', () => {
    expect(canReviewPayment(unionActor(UNION_2), LF_10)).toBe(false);
    expect(canReviewPayment(divisionActor(DIVISION_1), LF_10)).toBe(false);
    expect(canAuthorizeWithoutProof(unionActor(UNION_2), LF_10)).toBe(false);
    expect(canDeliverToSection(divisionActor(DIVISION_1), LF_10)).toBe(false);
  });

  it('lets super-admin review any local field', () => {
    expect(canReviewPayment(superAdminActor(), LF_11)).toBe(true);
    expect(canAuthorizeWithoutProof(superAdminActor(), LF_11)).toBe(true);
    expect(canDeliverToSection(superAdminActor(), LF_11)).toBe(true);
  });

  it('lets an LF-scoped admin review that field only', () => {
    const admin = baseActor({
      localFieldId: LF_10,
      canReview: true,
      globalRoles: ['admin'],
      territory: {
        level: 'local_field',
        localFieldId: LF_10,
        unionId: UNION_2,
      },
    });
    expect(canReviewPayment(admin, LF_10)).toBe(true);
    expect(canReviewPayment(admin, LF_11)).toBe(false);
  });

  it('fails closed when the territorial role has no id', () => {
    const unconfiguredLf = baseActor({
      canReview: true,
      globalRoles: ['director-lf'],
      territory: { level: 'unconfigured' },
    });
    const unconfiguredUnion = baseActor({
      globalRoles: ['director-union'],
      territory: { level: 'unconfigured' },
    });
    const unconfiguredAdmin = baseActor({
      globalAccess: true,
      canReview: true,
      globalRoles: ['admin'],
      territory: { level: 'unconfigured' },
    });
    expect(canReviewPayment(unconfiguredLf, LF_10)).toBe(false);
    expect(canReviewPayment(unconfiguredUnion, LF_10)).toBe(false);
    expect(canReviewPayment(unconfiguredAdmin, LF_10)).toBe(false);
    expect(canManageCatalog(unconfiguredLf, { scope: 'LOCAL_FIELD', localFieldId: LF_10 })).toBe(
      false,
    );
  });
});

import type { ResolvedAuthorizationProfile } from '../services/authorization-context.service';
import { stripClubContext } from '../../auth/acting-for/strip-club-context';
import {
  assignableGlobalRoles,
  buildCapabilityContext,
  CAPABILITY_DEFINITIONS,
  computeActorAuthorizationSummary,
  computeCapabilities,
  computeTerritory,
  type CapabilityKey,
} from './capabilities';
import { CAPABILITY_KEYS } from './generated/capability-keys';

type Fixture = {
  globalRoles?: string[];
  global?: { division?: number; union?: number; local_field?: number };
  profileLocalFieldId?: number | null;
  club?: { role: string; operational?: boolean; localField?: number | null };
};

const node = (id: number | undefined) =>
  id === undefined ? undefined : { id, name: `node-${id}` };

function resolvedFor(fixture: Fixture): ResolvedAuthorizationProfile {
  const globalScope = {
    division: node(fixture.global?.division),
    union: node(fixture.global?.union),
    local_field: node(fixture.global?.local_field),
  };
  const grant = fixture.club
    ? {
        assignment_id: 'assign-1',
        role_name: fixture.club.role,
        permissions: ['club_members:read'],
        operational: fixture.club.operational ?? true,
        ecclesiastical_year_id: 7,
        club: { club_id: 10, club_name: 'Club Aguila' },
        section: {
          club_section_id: 20,
          club_type_id: 2,
          club_type_name: 'Pathfinder',
        },
        scope:
          fixture.club.localField === null
            ? {}
            : {
                local_field: {
                  id: fixture.club.localField ?? 3,
                  name: `Campo ${fixture.club.localField ?? 3}`,
                },
              },
        status: 'active',
      }
    : null;
  const globalRoles = fixture.globalRoles ?? [];

  return {
    profile: {
      user_id: 'user-1',
      email: 'ana@example.com',
      name: 'Ana',
      local_field_id: fixture.profileLocalFieldId ?? null,
      union_id: null,
      country_id: null,
    },
    post_register_complete: true,
    authorization: {
      grants: {
        global_roles: globalRoles.map((role_name) => ({
          role_name,
          permissions: [],
          scope: globalScope,
        })),
        club_assignments: grant ? [grant] : [],
        direct_permissions: [],
      },
      active_assignment: { assignment_id: grant ? grant.assignment_id : null },
      effective: {
        permissions: [],
        scope: {
          global: globalScope,
          club: grant
            ? {
                assignment_id: grant.assignment_id,
                role_name: grant.role_name,
                club: grant.club,
                section: grant.section,
              }
            : null,
        },
      },
    },
    legacy: {
      roles: globalRoles,
      permissions: [],
      club: grant
        ? { club_id: 10, club_name: 'Club Aguila', club_type: 'P' }
        : null,
      club_context: {
        active_assignment_id: grant ? grant.assignment_id : null,
        active: null,
        available: [],
      },
    },
  } as unknown as ResolvedAuthorizationProfile;
}

const T5 = [
  'coordinator',
  'general-coordinator',
  'pastor',
  'user',
  'zone-coordinator',
];
const LF = ['assistant-lf', 'director-lf'];
const UNION = ['assistant-union', 'director-union'];
const DIA = ['assistant-dia', 'director-dia'];
const sorted = (xs: string[]) => [...xs].sort((a, b) => (a < b ? -1 : 1));

/** One fixture per actor the contract names, with the expected keys. */
const ACTORS: Array<{
  name: string;
  fixture: ResolvedAuthorizationProfile;
  territory: ReturnType<typeof computeTerritory>;
  assignable: string[];
  capabilities: CapabilityKey[];
}> = [
  {
    name: 'super-admin',
    fixture: resolvedFor({ globalRoles: ['super-admin'] }),
    territory: {
      level: 'all',
      division_id: null,
      union_id: null,
      local_field_id: null,
    },
    assignable: sorted([...T5, ...LF, ...UNION, ...DIA, 'admin']),
    capabilities: [
      'admin_panel.access',
      'audit.read_system',
      'camporee_orders.configure_offering',
      'camporee_orders.review_payment',
      'camporee_supplies.configure',
      'camporee_supplies.deliver',
      'camporee_supplies.review_payment',
      'catalogs.edit',
      'catalogs.manage_protected',
      'certificates.review_imports',
      'club_roles.assign_section',
      'club_roles.designate_director',
      'club_roles.succeed_director',
      'coordination.hub_view',
      'coordination.manage',
      'field_payment_orders.review',
      'folders.evaluate',
      'honors.review_instructor_proposals',
      'institutional_certificates.review',
      'investiture.configure_field_window',
      'investiture.consult_field_window',
      'rbac.manage',
      'rbac.mutate_global_roles',
      'rbac.view_user_roles',
      'reports.view_all',
      'scoring_categories.manage',
      'system.config.read',
      'system.jobs.run',
      'users.create_in_scope',
      'users.manage_in_scope',
      'users.update_admin_fields',
    ],
  },
  {
    name: 'admin without territory (unconfigured)',
    fixture: resolvedFor({ globalRoles: ['admin'] }),
    territory: {
      level: 'unconfigured',
      division_id: null,
      union_id: null,
      local_field_id: null,
    },
    assignable: sorted([...T5, ...LF, ...UNION, ...DIA]),
    capabilities: [
      'admin_panel.access',
      'catalogs.edit',
      'certificates.review_imports',
      'club_roles.assign_section',
      'club_roles.designate_director',
      'club_roles.succeed_director',
      'coordination.hub_view',
      'field_payment_orders.review',
      'honors.review_instructor_proposals',
      'investiture.configure_field_window',
      'investiture.consult_field_window',
      'rbac.view_user_roles',
      'reports.view_all',
      'system.config.read',
      'users.create_in_scope',
      'users.manage_in_scope',
      'users.update_admin_fields',
    ],
  },
  {
    name: 'assistant-admin scoped to a local field',
    fixture: resolvedFor({
      globalRoles: ['assistant-admin'],
      global: { local_field: 3 },
      profileLocalFieldId: 3,
    }),
    territory: {
      level: 'local_field',
      division_id: null,
      union_id: null,
      local_field_id: 3,
    },
    assignable: [],
    capabilities: [
      'admin_panel.access',
      'camporee_orders.configure_offering',
      'catalogs.edit',
      'certificates.review_imports',
      'coordination.hub_view',
      'coordination.manage',
      'folders.evaluate',
      'honors.review_instructor_proposals',
      'investiture.configure_field_window',
      'investiture.consult_field_window',
      'reports.view_local_field',
      'scoring_categories.manage',
      'system.config.read',
    ],
  },
  {
    name: 'director-lf with a local field',
    fixture: resolvedFor({
      globalRoles: ['director-lf', 'user'],
      global: { division: 1, union: 2, local_field: 3 },
      profileLocalFieldId: 3,
    }),
    territory: {
      level: 'local_field',
      division_id: 1,
      union_id: 2,
      local_field_id: 3,
    },
    assignable: sorted(T5),
    capabilities: [
      'admin_panel.access',
      'camporee_orders.configure_offering',
      'camporee_orders.review_payment',
      'camporee_supplies.configure',
      'camporee_supplies.deliver',
      'camporee_supplies.review_payment',
      'certificates.review_imports',
      'club_roles.assign_section',
      'club_roles.designate_director',
      'club_roles.succeed_director',
      'coordination.hub_view',
      'coordination.manage',
      'field_payment_orders.review',
      'folders.evaluate',
      'honors.review_instructor_proposals',
      'investiture.assign_district_pastors',
      'investiture.authorize_requests',
      'investiture.configure_field_window',
      'investiture.consult_field_window',
      'reports.view_local_field',
      'scoring_categories.manage',
      'users.create_in_scope',
      'users.manage_in_scope',
    ],
  },
  {
    name: 'director-union',
    fixture: resolvedFor({
      globalRoles: ['director-union'],
      global: { division: 1, union: 2 },
    }),
    territory: {
      level: 'union',
      division_id: 1,
      union_id: 2,
      local_field_id: null,
    },
    assignable: sorted([...T5, ...LF]),
    capabilities: [
      'admin_panel.access',
      'camporee_orders.configure_offering',
      'camporee_supplies.configure',
      'coordination.manage',
      'folders.confirm_union',
      'folders.evaluate',
      'investiture.consult_field_window',
      'reports.view_union',
      'scoring_categories.manage',
      'users.create_in_scope',
      'users.manage_in_scope',
    ],
  },
  {
    name: 'director-dia',
    fixture: resolvedFor({
      globalRoles: ['director-dia'],
      global: { division: 1 },
    }),
    territory: {
      level: 'division',
      division_id: 1,
      union_id: null,
      local_field_id: null,
    },
    assignable: sorted([...T5, ...LF, ...UNION]),
    capabilities: [
      'admin_panel.access',
      'coordination.manage',
      'folders.evaluate',
      'investiture.consult_field_window',
      'reports.view_all',
      'scoring_categories.manage',
      'users.create_in_scope',
      'users.manage_in_scope',
    ],
  },
  {
    name: 'pastor only',
    fixture: resolvedFor({ globalRoles: ['pastor'] }),
    territory: {
      level: 'open',
      division_id: null,
      union_id: null,
      local_field_id: null,
    },
    assignable: [],
    capabilities: [
      'admin_panel.access',
      'admin_panel.pastor_only',
      'investiture.authorize_requests',
    ],
  },
  {
    name: 'coordinator',
    fixture: resolvedFor({ globalRoles: ['user', 'coordinator'] }),
    territory: {
      level: 'open',
      division_id: null,
      union_id: null,
      local_field_id: null,
    },
    assignable: [],
    capabilities: ['admin_panel.access', 'coordination.hub_view'],
  },
  {
    name: 'active club director',
    fixture: resolvedFor({
      globalRoles: ['user'],
      club: { role: 'director' },
    }),
    territory: {
      level: 'open',
      division_id: null,
      union_id: null,
      local_field_id: null,
    },
    assignable: [],
    capabilities: [
      'camporee_orders.issue',
      'camporee_supplies.plan',
      'club.active_director',
      'club.operational_staff',
      'club.staff_mode',
      'club_roles.assign_section',
      'club_sections.create_active',
      'clubs.deactivate_active',
      'clubs.manage_active',
      'investiture.board',
      'scoring_categories.manage',
      'units.manage',
    ],
  },
  {
    name: 'club secretary',
    fixture: resolvedFor({
      globalRoles: ['user'],
      club: { role: 'secretary' },
    }),
    territory: {
      level: 'open',
      division_id: null,
      union_id: null,
      local_field_id: null,
    },
    assignable: [],
    capabilities: [
      'camporee_orders.issue',
      'camporee_supplies.plan',
      'club.operational_staff',
      'club.staff_mode',
      'clubs.manage_active',
      'investiture.board',
      'scoring_categories.manage',
      'units.manage',
    ],
  },
  {
    name: 'club member',
    fixture: resolvedFor({ globalRoles: ['user'], club: { role: 'member' } }),
    territory: {
      level: 'open',
      division_id: null,
      union_id: null,
      local_field_id: null,
    },
    assignable: [],
    capabilities: ['scoring_categories.manage'],
  },
  {
    name: 'user without grants',
    fixture: resolvedFor({}),
    territory: {
      level: 'open',
      division_id: null,
      union_id: null,
      local_field_id: null,
    },
    assignable: [],
    capabilities: [],
  },
  {
    name: 'principal with the club context stripped',
    fixture: stripClubContext(
      resolvedFor({ globalRoles: ['user'], club: { role: 'director' } }),
    ),
    territory: {
      level: 'open',
      division_id: null,
      union_id: null,
      local_field_id: null,
    },
    assignable: [],
    capabilities: [],
  },
];

describe('capabilities catalog', () => {
  it('CAPABILITY_DEFINITIONS keys (sorted) equal the generated CAPABILITY_KEYS', () => {
    expect(sorted(Object.keys(CAPABILITY_DEFINITIONS))).toEqual([
      ...CAPABILITY_KEYS,
    ]);
    expect([...CAPABILITY_KEYS]).toEqual(sorted([...CAPABILITY_KEYS]));
    expect(CAPABILITY_KEYS).toHaveLength(47);
  });

  describe.each(ACTORS)(
    '$name',
    ({ fixture, territory, assignable, capabilities }) => {
      it('computes the expected capabilities, sorted ascending', () => {
        const actual = computeCapabilities(fixture);
        expect(actual).toEqual(capabilities);
        expect(actual).toEqual(sorted(actual));
      });

      it('computes the territory and the assignable global roles', () => {
        expect(computeTerritory(fixture)).toEqual(territory);
        expect(assignableGlobalRoles(fixture)).toEqual(assignable);
      });

      it('summarises the three blocks in one pass', () => {
        expect(computeActorAuthorizationSummary(fixture)).toEqual({
          capabilities,
          territory,
          assignable_global_roles: assignable,
        });
      });
    },
  );

  describe('table by key', () => {
    const byKey = (key: CapabilityKey) =>
      Object.fromEntries(
        ACTORS.map((actor) => [
          actor.name,
          CAPABILITY_DEFINITIONS[key](buildCapabilityContext(actor.fixture)),
        ]),
      );

    it('super-admin only enters where it is listed', () => {
      expect(byKey('folders.confirm_union')['super-admin']).toBe(false);
      expect(byKey('investiture.authorize_requests')['super-admin']).toBe(
        false,
      );
      expect(byKey('investiture.assign_district_pastors')['super-admin']).toBe(
        false,
      );
    });

    it('territory keys are false for open and unconfigured levels', () => {
      for (const key of [
        'coordination.manage',
        'folders.evaluate',
        'camporee_orders.configure_offering',
      ] as const) {
        const table = byKey(key);
        expect(table['admin without territory (unconfigured)']).toBe(false);
        expect(table['pastor only']).toBe(false);
        expect(table['user without grants']).toBe(false);
      }
    });

    it('club_roles.assign_section follows SectionRoleMutationPolicy: global managers or the active club director', () => {
      const assign = byKey('club_roles.assign_section');
      expect(assign['super-admin']).toBe(true);
      expect(assign['admin without territory (unconfigured)']).toBe(true);
      expect(assign['director-lf with a local field']).toBe(true);
      expect(assign['active club director']).toBe(true);
      expect(assign['club secretary']).toBe(false);
      expect(assign['club member']).toBe(false);
      expect(assign['assistant-admin scoped to a local field']).toBe(false);
      expect(assign['principal with the club context stripped']).toBe(false);
      // Designating or succeeding the director still needs a global role.
      for (const key of [
        'club_roles.designate_director',
        'club_roles.succeed_director',
      ] as const) {
        expect(byKey(key)['active club director']).toBe(false);
        expect(byKey(key)['director-lf with a local field']).toBe(true);
      }
    });

    it('camporee review keys need both the role and a field-level territory', () => {
      const deliver = byKey('camporee_supplies.deliver');
      expect(deliver['director-lf with a local field']).toBe(true);
      expect(deliver['director-union']).toBe(false);
      expect(deliver['admin without territory (unconfigured)']).toBe(false);
      expect(deliver['super-admin']).toBe(true);
      expect(byKey('camporee_supplies.review_payment')).toEqual(deliver);
      expect(byKey('camporee_orders.review_payment')).toEqual(deliver);
    });
  });

  describe('edge cases', () => {
    it('ignores the active club role when its grant is not operational', () => {
      const fixture = resolvedFor({
        globalRoles: ['user'],
        club: { role: 'director', operational: false },
      });
      expect(buildCapabilityContext(fixture).activeClubRole).toBeUndefined();
      expect(computeCapabilities(fixture)).toEqual([]);
    });

    it('admin_panel.pastor_only needs every global role to be pastor', () => {
      expect(
        computeCapabilities(resolvedFor({ globalRoles: ['pastor', 'user'] })),
      ).not.toContain('admin_panel.pastor_only');
    });

    it('certificates.review_imports needs the own local field for LF roles, not the territory', () => {
      const withoutHome = resolvedFor({
        globalRoles: ['director-lf'],
        global: { local_field: 3 },
        profileLocalFieldId: null,
      });
      const caps = computeCapabilities(withoutHome);
      expect(caps).not.toContain('certificates.review_imports');
      expect(caps).not.toContain('honors.review_instructor_proposals');
      expect(caps).toContain('field_payment_orders.review');
      expect(caps).toContain('reports.view_local_field');
    });

    it('field_payment_orders.review accepts the field of the active club grant, like resolveOrderActor', () => {
      const viaClubGrant = resolvedFor({
        globalRoles: ['director-lf'],
        club: { role: 'secretary', localField: 5 },
      });
      expect(buildCapabilityContext(viaClubGrant).activeClubLocalFieldId).toBe(
        5,
      );
      expect(computeTerritory(viaClubGrant).local_field_id).toBeNull();
      expect(computeCapabilities(viaClubGrant)).toContain(
        'field_payment_orders.review',
      );

      // The grant must be operational and carry a numeric local field.
      expect(
        computeCapabilities(
          resolvedFor({
            globalRoles: ['assistant-lf'],
            club: { role: 'secretary', localField: 5, operational: false },
          }),
        ),
      ).not.toContain('field_payment_orders.review');
      expect(
        computeCapabilities(
          resolvedFor({
            globalRoles: ['assistant-lf'],
            club: { role: 'secretary', localField: null },
          }),
        ),
      ).not.toContain('field_payment_orders.review');

      // The grant alone never grants the key: the global role is required.
      expect(
        computeCapabilities(
          resolvedFor({
            globalRoles: ['user'],
            club: { role: 'director', localField: 5 },
          }),
        ),
      ).not.toContain('field_payment_orders.review');

      // After stripClubContext the grant is gone and the territory decides.
      expect(computeCapabilities(stripClubContext(viaClubGrant))).not.toContain(
        'field_payment_orders.review',
      );
    });

    it('a director-lf without a configured field loses every territory key', () => {
      const caps = computeCapabilities(
        resolvedFor({ globalRoles: ['director-lf'], profileLocalFieldId: 3 }),
      );
      expect(
        computeTerritory(resolvedFor({ globalRoles: ['director-lf'] })),
      ).toEqual({
        level: 'unconfigured',
        division_id: null,
        union_id: null,
        local_field_id: null,
      });
      expect(caps).not.toContain('coordination.manage');
      expect(caps).not.toContain('field_payment_orders.review');
      expect(caps).not.toContain('reports.view_local_field');
      expect(caps).toContain('certificates.review_imports');
      expect(caps).toContain('club_roles.assign_section');
    });

    it('an admin with a union scope reports the union level', () => {
      expect(
        computeTerritory(
          resolvedFor({
            globalRoles: ['admin'],
            global: { union: 2, local_field: 3 },
          }),
        ),
      ).toEqual({
        level: 'union',
        division_id: null,
        union_id: 2,
        local_field_id: 3,
      });
    });

    it('picks the highest tier for assignable roles', () => {
      expect(
        assignableGlobalRoles(
          resolvedFor({ globalRoles: ['user', 'director-lf', 'director-dia'] }),
        ),
      ).toEqual(sorted([...T5, ...LF, ...UNION]));
    });

    it('tolerates a partial profile (no authorization block)', () => {
      const partial = {
        profile: { user_id: 'u' },
      } as unknown as ResolvedAuthorizationProfile;
      expect(computeActorAuthorizationSummary(partial)).toEqual({
        capabilities: [],
        territory: {
          level: 'open',
          division_id: null,
          union_id: null,
          local_field_id: null,
        },
        assignable_global_roles: [],
      });
    });

    it('does not mutate its input', () => {
      const fixture = resolvedFor({
        globalRoles: ['director-lf'],
        global: { local_field: 3 },
        club: { role: 'director' },
      });
      const snapshot = JSON.stringify(fixture);
      computeActorAuthorizationSummary(fixture);
      expect(JSON.stringify(fixture)).toBe(snapshot);
    });
  });
});

import type { ResolvedAuthorizationProfile } from '../services/authorization-context.service';
import { stripClubContext } from '../../auth/acting-for/strip-club-context';
import {
  assignableGlobalRoles,
  buildCapabilityContext,
  CAPABILITY_DEFINITIONS,
  computeActorAuthorizationSummary,
  computeCapabilities,
  computeTerritory,
  localFieldRequiredRoles,
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
      name: null,
      division_id: null,
      union_id: null,
      local_field_id: null,
    },
    assignable: sorted([...T5, ...LF, ...UNION, ...DIA, 'admin']),
    capabilities: [
      'admin_panel.access',
      'analytics.operations_dashboard',
      'annual_progress.view_territory',
      'app.clubless_surface',
      'audit.read_system',
      'camporee_orders.configure_offering',
      'camporee_orders.review_payment',
      'camporee_supplies.configure',
      'camporee_supplies.deliver',
      'camporee_supplies.review_payment',
      'catalogs.edit',
      'catalogs.manage_protected',
      'certificates.review_imports',
      'club_enrollments.validate',
      'club_roles.assign_section',
      'club_roles.designate_director',
      'club_roles.succeed_director',
      'clubs.view_territory',
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
      'reports.regenerate_periodic',
      'reports.view_all',
      'requests.review_territory',
      'scoring_categories.manage',
      'service_credentials.review',
      'system.config.read',
      'system.jobs.run',
      'union_camporees.approve_registrations',
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
      name: null,
      division_id: null,
      union_id: null,
      local_field_id: null,
    },
    assignable: sorted([...T5, ...LF, ...UNION, ...DIA]),
    capabilities: [
      'admin_panel.access',
      'app.clubless_surface',
      'catalogs.edit',
      'certificates.review_imports',
      'club_enrollments.validate',
      'club_roles.assign_section',
      'club_roles.designate_director',
      'club_roles.succeed_director',
      'coordination.hub_view',
      'coordination.manage',
      'field_payment_orders.review',
      'honors.review_instructor_proposals',
      'investiture.configure_field_window',
      'investiture.consult_field_window',
      'rbac.view_user_roles',
      'reports.regenerate_periodic',
      'reports.view_all',
      'service_credentials.review',
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
      name: 'node-3',
      division_id: null,
      union_id: null,
      local_field_id: 3,
    },
    assignable: [],
    capabilities: [
      'admin_panel.access',
      'app.clubless_surface',
      'camporee_orders.configure_offering',
      'catalogs.edit',
      'certificates.review_imports',
      'club_enrollments.validate',
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
      name: 'node-3',
      division_id: 1,
      union_id: 2,
      local_field_id: 3,
    },
    assignable: sorted(T5),
    capabilities: [
      'admin_panel.access',
      'analytics.operations_dashboard',
      'annual_progress.view_territory',
      'app.clubless_surface',
      'camporee_orders.configure_offering',
      'camporee_orders.review_payment',
      'camporee_supplies.configure',
      'camporee_supplies.deliver',
      'camporee_supplies.review_payment',
      'certificates.review_imports',
      'club_enrollments.validate',
      'club_roles.assign_section',
      'club_roles.designate_director',
      'club_roles.succeed_director',
      'clubs.view_territory',
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
      'requests.review_territory',
      'scoring_categories.manage',
      'service_credentials.review',
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
      name: 'node-2',
      division_id: 1,
      union_id: 2,
      local_field_id: null,
    },
    assignable: sorted([...T5, ...LF]),
    capabilities: [
      'admin_panel.access',
      'analytics.operations_dashboard',
      'annual_progress.view_territory',
      'app.clubless_surface',
      'camporee_orders.configure_offering',
      'camporee_supplies.configure',
      'club_enrollments.validate',
      'clubs.view_territory',
      'folders.confirm_union',
      'folders.evaluate',
      'investiture.consult_field_window',
      'reports.view_territory',
      'reports.view_union',
      'requests.review_territory',
      'scoring_categories.manage',
      'supervision.app_view',
      'union_camporees.approve_registrations',
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
      name: 'node-1',
      division_id: 1,
      union_id: null,
      local_field_id: null,
    },
    assignable: sorted([...T5, ...LF, ...UNION]),
    capabilities: [
      'admin_panel.access',
      'analytics.operations_dashboard',
      'annual_progress.view_territory',
      'app.clubless_surface',
      'club_enrollments.validate',
      'clubs.view_territory',
      'folders.evaluate',
      'investiture.consult_field_window',
      'reports.view_territory',
      'requests.review_territory',
      'scoring_categories.manage',
      'supervision.app_view',
      'users.create_in_scope',
      'users.manage_in_scope',
    ],
  },
  {
    name: 'pastor only',
    fixture: resolvedFor({ globalRoles: ['pastor'] }),
    territory: {
      level: 'open',
      name: null,
      division_id: null,
      union_id: null,
      local_field_id: null,
    },
    assignable: [],
    capabilities: [
      'admin_panel.access',
      'admin_panel.pastor_only',
      'app.clubless_surface',
      'club_enrollments.validate',
      'investiture.authorize_requests',
      'service_credentials.review',
    ],
  },
  {
    name: 'coordinator',
    fixture: resolvedFor({ globalRoles: ['user', 'coordinator'] }),
    territory: {
      level: 'open',
      name: null,
      division_id: null,
      union_id: null,
      local_field_id: null,
    },
    assignable: [],
    capabilities: [
      'admin_panel.access',
      'analytics.operations_dashboard',
      'app.clubless_surface',
      'club_enrollments.validate',
      'coordination.hub_view',
      'service_credentials.review',
    ],
  },
  {
    name: 'active club director',
    fixture: resolvedFor({
      globalRoles: ['user'],
      club: { role: 'director' },
    }),
    territory: {
      level: 'open',
      name: null,
      division_id: null,
      union_id: null,
      local_field_id: null,
    },
    assignable: [],
    capabilities: [
      'camporee_orders.issue',
      'camporee_supplies.plan',
      'club.active_director',
      'club.administrative_staff',
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
      name: null,
      division_id: null,
      union_id: null,
      local_field_id: null,
    },
    assignable: [],
    capabilities: [
      'camporee_orders.issue',
      'camporee_supplies.plan',
      'club.administrative_staff',
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
      name: null,
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
      name: null,
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
      name: null,
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
    expect(CAPABILITY_KEYS).toHaveLength(60);
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

      it('summarises the four blocks in one pass', () => {
        expect(computeActorAuthorizationSummary(fixture)).toEqual({
          capabilities,
          territory,
          assignable_global_roles: assignable,
          // R4.3: assignable roles that need a Field (pastor today).
          local_field_required_roles: assignable.includes('pastor')
            ? ['pastor']
            : [],
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

    it('app.clubless_surface is the role matrix of pastor-only, the coordination hub and the supervision persona', () => {
      const surface = (...globalRoles: string[]) =>
        CAPABILITY_DEFINITIONS['app.clubless_surface'](
          buildCapabilityContext(resolvedFor({ globalRoles })),
        );
      for (const role of [
        'pastor',
        'super-admin',
        'admin',
        'assistant-admin',
        'coordinator',
        'zone-coordinator',
        'general-coordinator',
        'director-lf',
        'assistant-lf',
        'director-union',
        'assistant-union',
        'director-dia',
        'assistant-dia',
      ]) {
        expect([role, surface(role)]).toEqual([role, true]);
      }
      expect(['user', surface('user')]).toEqual(['user', false]);
      expect(surface()).toBe(false);
      // pastor + union: not pastor-only, but the supervision persona gives the surface.
      expect(surface('pastor', 'director-union')).toBe(true);
      // pastor + user is a pastor with the base role only: not pastor-only.
      expect(surface('pastor', 'user')).toBe(false);
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
        name: null,
        division_id: null,
        union_id: null,
        local_field_id: null,
      });
      // Role-based since writes became the local field's job: not a territory key.
      expect(caps).toContain('coordination.manage');
      expect(caps).not.toContain('field_payment_orders.review');
      expect(caps).not.toContain('reports.view_local_field');
      expect(caps).toContain('certificates.review_imports');
      expect(caps).toContain('club_roles.assign_section');
    });

    it('coordination.manage follows the role, not the territory level', () => {
      const has = (globalRoles: string[], global?: Record<string, number>) =>
        computeCapabilities(resolvedFor({ globalRoles, global })).includes(
          'coordination.manage',
        );
      // `admin` anchors in a union (level `union`) and must still manage.
      expect(has(['admin'], { union: 2 })).toBe(true);
      expect(has(['assistant-admin'], { local_field: 3 })).toBe(true);
      expect(has(['super-admin'])).toBe(true);
      expect(has(['director-lf'], { local_field: 3 })).toBe(true);
      expect(has(['assistant-lf'], { local_field: 3 })).toBe(true);
      for (const role of [
        'director-union',
        'assistant-union',
        'director-dia',
        'assistant-dia',
      ]) {
        expect(has([role], { division: 1, union: 2 })).toBe(false);
      }
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
        name: 'node-2',
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
          name: null,
          division_id: null,
          union_id: null,
          local_field_id: null,
        },
        assignable_global_roles: [],
        local_field_required_roles: [],
      });
    });

    it('publishes only the required-Field roles the actor can assign, in role-name form', () => {
      expect(
        localFieldRequiredRoles(['coordinator', 'pastor', 'user']),
      ).toEqual(['pastor']);
      expect(localFieldRequiredRoles(['coordinator', 'user'])).toEqual([]);
      expect(localFieldRequiredRoles([])).toEqual([]);
      // Same form as assignable_global_roles: a subset of it.
      const assignable = assignableGlobalRoles(
        resolvedFor({ globalRoles: ['director-lf'] }),
      );
      const required = localFieldRequiredRoles(assignable);
      expect(required.every((role) => assignable.includes(role))).toBe(true);
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

describe('reports.view_periodic', () => {
  const withPermissions = (
    fixture: ResolvedAuthorizationProfile,
    permissions: string[],
  ): ResolvedAuthorizationProfile => ({
    ...fixture,
    authorization: {
      ...fixture.authorization,
      effective: { ...fixture.authorization.effective, permissions },
    },
  });
  const READ = ['reports:read', 'reports:download'];
  const has = (fixture: ResolvedAuthorizationProfile) =>
    computeCapabilities(fixture).includes('reports.view_periodic');

  it.each([
    'super-admin',
    'admin',
    'assistant-admin',
    'director-lf',
    'director-union',
    'director-dia',
  ])('%s with reports:read can see quarterly and annual reports', (role) => {
    expect(
      has(withPermissions(resolvedFor({ globalRoles: [role] }), READ)),
    ).toBe(true);
  });

  it.each(['coordinator', 'zone-coordinator', 'general-coordinator'])(
    '%s only (reports:read kept for monthly reports) cannot',
    (role) => {
      expect(
        has(withPermissions(resolvedFor({ globalRoles: [role] }), READ)),
      ).toBe(false);
    },
  );

  it('a coordinator that also holds a club section keeps it', () => {
    const fixture = resolvedFor({
      globalRoles: ['coordinator'],
      club: { role: 'director' },
    });
    expect(has(withPermissions(fixture, READ))).toBe(true);
  });

  it('a club director with reports:read can', () => {
    const fixture = resolvedFor({ club: { role: 'director' } });
    expect(has(withPermissions(fixture, READ))).toBe(true);
  });

  it('without reports:read nobody can', () => {
    expect(
      has(withPermissions(resolvedFor({ globalRoles: ['admin'] }), [])),
    ).toBe(false);
  });

  it('a user with no role and no club cannot', () => {
    expect(has(withPermissions(resolvedFor({}), READ))).toBe(false);
  });
});

describe('reports.regenerate_periodic', () => {
  const has = (fixture: ResolvedAuthorizationProfile) =>
    computeCapabilities(fixture).includes('reports.regenerate_periodic');

  it.each(['super-admin', 'admin'])(
    '%s can recompute a closed report',
    (role) => {
      expect(has(resolvedFor({ globalRoles: [role] }))).toBe(true);
    },
  );

  it.each([
    'assistant-admin',
    'director-lf',
    'assistant-lf',
    'director-union',
    'director-dia',
    'coordinator',
  ])('%s cannot', (role) => {
    expect(has(resolvedFor({ globalRoles: [role] }))).toBe(false);
  });

  it('a club director cannot', () => {
    expect(has(resolvedFor({ club: { role: 'director' } }))).toBe(false);
  });
});

describe('territorial supervision capabilities', () => {
  const KEYS = [
    'supervision.app_view',
    'union_camporees.approve_registrations',
    'requests.review_territory',
    'analytics.operations_dashboard',
    'clubs.view_territory',
    'reports.view_territory',
    'annual_progress.view_territory',
    'reports.view_all',
    'app.clubless_surface',
  ] as const satisfies readonly CapabilityKey[];

  const held = (fixture: ResolvedAuthorizationProfile) =>
    KEYS.filter((key) => computeCapabilities(fixture).includes(key)).sort();

  const ALL_TERRITORIAL = [
    'analytics.operations_dashboard',
    'annual_progress.view_territory',
    'clubs.view_territory',
    'requests.review_territory',
  ];

  it.each(['director-union', 'assistant-union'])(
    '%s with a union holds the Unión surface incl. camporee approval',
    (role) => {
      expect(
        held(
          resolvedFor({
            globalRoles: [role],
            global: { division: 1, union: 2 },
          }),
        ),
      ).toEqual(
        expect.arrayContaining([
          'supervision.app_view',
          'app.clubless_surface',
          'union_camporees.approve_registrations',
          'reports.view_territory',
          ...ALL_TERRITORIAL,
        ]),
      );
      expect(
        held(
          resolvedFor({
            globalRoles: [role],
            global: { division: 1, union: 2 },
          }),
        ),
      ).not.toContain('reports.view_all');
    },
  );

  it.each(['director-dia', 'assistant-dia'])(
    '%s with a division holds the División surface, never camporee approval or view_all',
    (role) => {
      const keys = held(
        resolvedFor({ globalRoles: [role], global: { division: 1 } }),
      );
      expect(keys).toEqual(
        expect.arrayContaining([
          'supervision.app_view',
          'app.clubless_surface',
          'reports.view_territory',
          ...ALL_TERRITORIAL,
        ]),
      );
      expect(keys).not.toContain('union_camporees.approve_registrations');
      expect(keys).not.toContain('reports.view_all');
    },
  );

  it.each([
    'director-union',
    'assistant-union',
    'director-dia',
    'assistant-dia',
  ])(
    '%s with an unconfigured territory keeps the persona and loses every per-function key',
    (role) => {
      const fixture = resolvedFor({ globalRoles: [role] });
      expect(computeTerritory(fixture).level).toBe('unconfigured');
      expect(held(fixture)).toEqual(
        ['supervision.app_view', 'app.clubless_surface'].sort(),
      );
    },
  );

  it('a Union role without a union id (division anchor only) is unconfigured: no reports.view_territory', () => {
    const keys = held(
      resolvedFor({ globalRoles: ['director-union'], global: { division: 1 } }),
    );
    expect(keys).toContain('supervision.app_view');
    expect(keys).not.toContain('reports.view_territory');
  });

  it.each(['director-lf', 'assistant-lf'])(
    '%s with a field holds the territorial keys but not the supervision persona',
    (role) => {
      const keys = held(
        resolvedFor({
          globalRoles: [role],
          global: { division: 1, union: 2, local_field: 3 },
          profileLocalFieldId: 3,
        }),
      );
      expect(keys).toEqual(expect.arrayContaining(ALL_TERRITORIAL));
      expect(keys).not.toContain('supervision.app_view');
      expect(keys).not.toContain('union_camporees.approve_registrations');
      expect(keys).not.toContain('reports.view_territory');
      expect(keys).not.toContain('reports.view_all');
    },
  );

  it.each(['super-admin', 'admin'])(
    '%s keeps reports.view_all and has no persona key',
    (role) => {
      const keys = held(
        resolvedFor({ globalRoles: [role], global: { union: 2 } }),
      );
      expect(keys).toContain('reports.view_all');
      expect(keys).not.toContain('supervision.app_view');
      expect(keys).not.toContain('reports.view_territory');
    },
  );

  it('super-admin approves union camporee registrations, admin does not', () => {
    expect(held(resolvedFor({ globalRoles: ['super-admin'] }))).toContain(
      'union_camporees.approve_registrations',
    );
    expect(
      held(resolvedFor({ globalRoles: ['admin'], global: { union: 2 } })),
    ).not.toContain('union_camporees.approve_registrations');
  });

  it('a coordinator only gets the operations dashboard', () => {
    expect(held(resolvedFor({ globalRoles: ['user', 'coordinator'] }))).toEqual(
      ['analytics.operations_dashboard', 'app.clubless_surface'],
    );
  });

  it('pastor and plain user get none of the new keys', () => {
    expect(held(resolvedFor({ globalRoles: ['pastor'] }))).toEqual([
      'app.clubless_surface',
    ]);
    expect(held(resolvedFor({ globalRoles: ['user'] }))).toEqual([]);
  });

  it('a Union role plus pastor still holds the persona', () => {
    expect(
      held(
        resolvedFor({
          globalRoles: ['pastor', 'director-union'],
          global: { union: 2 },
        }),
      ),
    ).toContain('supervision.app_view');
  });
});

describe('computeTerritory name', () => {
  it('is the name of the unit at the actor level, not of a parent', () => {
    const union = resolvedFor({
      globalRoles: ['director-union'],
      global: { division: 1, union: 2 },
    });
    expect(computeTerritory(union).name).toBe('node-2');

    const division = resolvedFor({
      globalRoles: ['director-dia'],
      global: { division: 1 },
    });
    expect(computeTerritory(division).name).toBe('node-1');
  });

  it('is null when the loaded scope node has no name', () => {
    const union = resolvedFor({
      globalRoles: ['director-union'],
      global: { division: 1, union: 2 },
    });
    const scope = union.authorization.effective.scope.global;
    scope.union = { id: 2, name: null };

    expect(computeTerritory(union)).toMatchObject({
      level: 'union',
      name: null,
      union_id: 2,
    });
  });
});

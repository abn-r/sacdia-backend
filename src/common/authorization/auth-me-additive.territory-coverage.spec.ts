import type { ResolvedAuthorizationProfile } from '../services/authorization-context.service';
import {
  CAPABILITY_DEFINITIONS,
  computeActorAuthorizationSummary,
  computeCapabilities,
} from './capabilities';
import { CAPABILITY_KEYS } from './generated/capability-keys';

/**
 * B8 (union-division-app-surface, S1.10 / R1.8): `GET /auth/me` stays
 * additive. An old app build keeps working against the new backend because
 * (a) every pre-existing capability key still exists, (b) the only pre-existing
 * keys whose value may differ are the two the design changes on purpose, and
 * (c) the `authorization` summary block keeps the same shape (only new
 * capability KEYS inside the existing `capabilities` array).
 *
 * `BASELINE_KEYS` is the literal key list of
 * `git show HEAD:src/common/authorization/generated/capability-keys.ts`
 * (52 keys). The golden baseline arrays below are what HEAD computed for the
 * same actors; they were derived from the HEAD diff of capabilities.ts, which
 * only touches `app.clubless_surface`, `reports.view_all` and adds keys.
 *
 * Enforcing code: common/authorization/capabilities.ts
 * (`CAPABILITY_DEFINITIONS`, `computeActorAuthorizationSummary` :494-513).
 * This spec cannot prove behavior of the Flutter client; the old-build
 * tolerance of unknown keys is NOT verified here (app side).
 */

const BASELINE_KEYS = [
  'admin_panel.access',
  'admin_panel.pastor_only',
  'app.clubless_surface',
  'audit.read_system',
  'camporee_orders.configure_offering',
  'camporee_orders.issue',
  'camporee_orders.review_payment',
  'camporee_supplies.configure',
  'camporee_supplies.deliver',
  'camporee_supplies.plan',
  'camporee_supplies.review_payment',
  'catalogs.edit',
  'catalogs.manage_protected',
  'certificates.review_imports',
  'club.active_director',
  'club.administrative_staff',
  'club.operational_staff',
  'club.staff_mode',
  'club_enrollments.validate',
  'club_roles.assign_section',
  'club_roles.designate_director',
  'club_roles.succeed_director',
  'club_sections.create_active',
  'clubs.deactivate_active',
  'clubs.manage_active',
  'coordination.hub_view',
  'coordination.manage',
  'field_payment_orders.review',
  'folders.confirm_union',
  'folders.evaluate',
  'honors.review_instructor_proposals',
  'institutional_certificates.review',
  'investiture.assign_district_pastors',
  'investiture.authorize_requests',
  'investiture.board',
  'investiture.configure_field_window',
  'investiture.consult_field_window',
  'rbac.manage',
  'rbac.mutate_global_roles',
  'rbac.view_user_roles',
  'reports.regenerate_periodic',
  'reports.view_all',
  'reports.view_local_field',
  'reports.view_periodic',
  'reports.view_union',
  'scoring_categories.manage',
  'service_credentials.review',
  'system.config.read',
  'system.jobs.run',
  'units.manage',
  'users.create_in_scope',
  'users.manage_in_scope',
  'users.update_admin_fields',
];

const NEW_KEYS = [
  'analytics.operations_dashboard',
  'annual_progress.view_territory',
  'clubs.view_territory',
  'reports.view_territory',
  'requests.review_territory',
  'supervision.app_view',
  'union_camporees.approve_registrations',
];

/** Existing keys whose value changes on purpose (design A). */
const INTENTIONALLY_CHANGED = ['app.clubless_surface', 'reports.view_all'];

function clublessSupervisor(
  roleName: string,
  global: { division?: number; union?: number },
): ResolvedAuthorizationProfile {
  const node = (id?: number) => (id ? { id, name: `n-${id}` } : undefined);
  const scope = {
    division: node(global.division),
    union: node(global.union),
    local_field: undefined,
  };
  return {
    profile: { user_id: 'u-1', local_field_id: null, union_id: null },
    post_register_complete: true,
    authorization: {
      grants: {
        global_roles: [{ role_name: roleName, permissions: [], scope }],
        club_assignments: [],
        direct_permissions: [],
      },
      active_assignment: { assignment_id: null },
      effective: {
        permissions: ['reports:read'],
        scope: { global: scope, club: null },
      },
    },
  } as unknown as ResolvedAuthorizationProfile;
}

const withoutNewOrChanged = (keys: string[]) =>
  keys.filter(
    (key) => !NEW_KEYS.includes(key) && !INTENTIONALLY_CHANGED.includes(key),
  );

describe('/auth/me stays additive (union-division-app-surface B8, S1.10)', () => {
  it('keeps every pre-existing capability key', () => {
    const current = new Set<string>(CAPABILITY_KEYS);

    expect(BASELINE_KEYS.filter((key) => !current.has(key))).toEqual([]);
  });

  it('adds exactly the seven new capability keys and nothing else', () => {
    const added = CAPABILITY_KEYS.filter((key) => !BASELINE_KEYS.includes(key));

    expect([...added].sort()).toEqual([...NEW_KEYS].sort());
  });

  it('defines a predicate for every published key (no key without a definition)', () => {
    for (const key of CAPABILITY_KEYS) {
      expect(typeof CAPABILITY_DEFINITIONS[key]).toBe('function');
    }
  });

  it('keeps the shape of the authorization summary: same four blocks, same territory fields (plus name)', () => {
    const summary = computeActorAuthorizationSummary(
      clublessSupervisor('director-union', { union: 3, division: 1 }),
    );

    expect(Object.keys(summary).sort()).toEqual([
      'assignable_global_roles',
      'capabilities',
      'local_field_required_roles',
      'territory',
    ]);
    expect(Object.keys(summary.territory).sort()).toEqual([
      'division_id',
      'level',
      'local_field_id',
      'name',
      'union_id',
    ]);
    expect(Array.isArray(summary.capabilities)).toBe(true);
    expect(summary.capabilities.every((key) => typeof key === 'string')).toBe(
      true,
    );
  });

  describe('Union (union 3, no club): old keys keep their value; only new keys and the persona key appear', () => {
    const caps = computeCapabilities(
      clublessSupervisor('director-union', { union: 3, division: 1 }),
    );

    it('the pre-existing keys that did not change on purpose equal what HEAD computed', () => {
      expect(withoutNewOrChanged(caps)).toEqual([
        'admin_panel.access',
        'camporee_orders.configure_offering',
        'camporee_supplies.configure',
        'club_enrollments.validate',
        'folders.confirm_union',
        'folders.evaluate',
        'investiture.consult_field_window',
        'reports.view_periodic',
        'reports.view_union',
        'scoring_categories.manage',
        'users.create_in_scope',
        'users.manage_in_scope',
      ]);
    });

    it('the intended changes are exactly: app.clubless_surface true, reports.view_all still false', () => {
      expect(caps).toContain('app.clubless_surface');
      expect(caps).not.toContain('reports.view_all');
    });
  });

  describe('Division (division 1, no club)', () => {
    const caps = computeCapabilities(
      clublessSupervisor('director-dia', { division: 1 }),
    );

    it('the pre-existing keys that did not change on purpose equal what HEAD computed', () => {
      expect(withoutNewOrChanged(caps)).toEqual([
        'admin_panel.access',
        'club_enrollments.validate',
        'folders.evaluate',
        'investiture.consult_field_window',
        'reports.view_periodic',
        'scoring_categories.manage',
        'users.create_in_scope',
        'users.manage_in_scope',
      ]);
    });

    it('the intended changes are exactly: app.clubless_surface true, reports.view_all dropped (HEAD had it true for Division)', () => {
      expect(caps).toContain('app.clubless_surface');
      expect(caps).not.toContain('reports.view_all');
    });
  });

  it('a Union/Division actor with no territory anchor keeps the persona (club_exempt) but gains no per-function key (R1.10)', () => {
    const caps = computeCapabilities(clublessSupervisor('director-union', {}));

    expect(caps).toContain('supervision.app_view');
    expect(caps).toContain('app.clubless_surface');
    for (const key of NEW_KEYS.filter((k) => k !== 'supervision.app_view')) {
      expect(caps).not.toContain(key);
    }
  });
});

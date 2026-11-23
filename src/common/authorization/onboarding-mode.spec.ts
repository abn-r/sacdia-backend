import type { ResolvedAuthorizationProfile } from '../services/authorization-context.service';
import { stripClubContext } from '../../auth/acting-for/strip-club-context';
import { computeOnboardingMode } from './onboarding-mode';

type ClubFixture = { role?: string; status?: string; operational?: boolean };

function resolvedFor(
  globalRoles: string[],
  clubs: ClubFixture[] = [],
): ResolvedAuthorizationProfile {
  const grants = clubs.map((club, index) => ({
    assignment_id: `assign-${index}`,
    role_name: club.role ?? 'member',
    permissions: ['club_members:read'],
    operational: club.operational ?? club.status === 'active',
    ecclesiastical_year_id: 7,
    club: { club_id: 10, club_name: 'Club Aguila' },
    section: {
      club_section_id: 20,
      club_type_id: 2,
      club_type_name: 'Pathfinder',
    },
    scope: {},
    status: club.status ?? 'active',
  }));
  const active = grants.find((grant) => grant.status === 'active');
  const globalScope = {};

  return {
    profile: {
      user_id: 'user-1',
      email: 'ana@example.com',
      name: 'Ana',
      local_field_id: null,
      union_id: null,
      country_id: null,
    },
    post_register_complete: false,
    authorization: {
      grants: {
        global_roles: globalRoles.map((role_name) => ({
          role_name,
          permissions: [],
          scope: globalScope,
        })),
        club_assignments: grants,
        direct_permissions: [],
      },
      active_assignment: { assignment_id: active?.assignment_id ?? null },
      effective: {
        permissions: [],
        scope: {
          global: globalScope,
          club: active
            ? {
                assignment_id: active.assignment_id,
                role_name: active.role_name,
                club: active.club,
                section: active.section,
              }
            : null,
        },
      },
    },
    legacy: {
      roles: globalRoles,
      permissions: [],
      club: null,
      club_context: {
        active_assignment_id: active?.assignment_id ?? null,
        active: null,
        available: [],
      },
    },
  } as unknown as ResolvedAuthorizationProfile;
}

describe('computeOnboardingMode', () => {
  it('S1.1 club member with an active assignment -> club', () => {
    expect(
      computeOnboardingMode(
        resolvedFor(['user'], [{ role: 'counselor', status: 'active' }]),
      ),
    ).toBe('club');
  });

  it('S1.2 active club assignment + coordinator -> club', () => {
    expect(
      computeOnboardingMode(
        resolvedFor(
          ['user', 'coordinator'],
          [{ role: 'counselor', status: 'active' }],
        ),
      ),
    ).toBe('club');
  });

  it.each(['pending', 'inactive', 'expired'])(
    'S1.3 only a %s assignment still counts as visible -> club',
    (status) => {
      expect(computeOnboardingMode(resolvedFor(['pastor'], [{ status }]))).toBe(
        'club',
      );
    },
  );

  it('S1.4 / R1.8 designated is not visible: the grants array does not carry it -> club_exempt', () => {
    // A designated assignment never reaches grants.club_assignments
    // (buildClubGrant returns null), so the pastor has no visible club.
    expect(computeOnboardingMode(resolvedFor(['pastor'], []))).toBe(
      'club_exempt',
    );
  });

  it('S1.5 pastor-only without assignments -> club_exempt', () => {
    expect(computeOnboardingMode(resolvedFor(['pastor']))).toBe('club_exempt');
  });

  it.each([
    'super-admin',
    'admin',
    'assistant-admin',
    'coordinator',
    'zone-coordinator',
    'general-coordinator',
    'director-lf',
    'assistant-lf',
  ])('S1.6 hub role %s without a club -> club_exempt', (role) => {
    expect(computeOnboardingMode(resolvedFor([role]))).toBe('club_exempt');
    expect(computeOnboardingMode(resolvedFor(['user', role]))).toBe(
      'club_exempt',
    );
  });

  it.each([
    'director-union',
    'assistant-union',
    'director-dia',
    'assistant-dia',
  ])('S1.7 %s without a club -> panel_only', (role) => {
    expect(computeOnboardingMode(resolvedFor([role]))).toBe('panel_only');
  });

  it('S1.8 union role with a pending club assignment -> club', () => {
    expect(
      computeOnboardingMode(
        resolvedFor(['director-union'], [{ status: 'pending' }]),
      ),
    ).toBe('club');
  });

  it('S1.9 / R1.3 a plain user with no club is club, never panel_only', () => {
    expect(computeOnboardingMode(resolvedFor(['user']))).toBe('club');
  });

  it('a profile with no global roles at all -> club', () => {
    expect(computeOnboardingMode(resolvedFor([]))).toBe('club');
  });

  it('S1.10 / R1.7 pastor + union role with no club -> panel_only', () => {
    expect(
      computeOnboardingMode(resolvedFor(['pastor', 'director-union'])),
    ).toBe('panel_only');
  });

  it('S1.13 a club_exempt account that gains a visible club -> club', () => {
    expect(
      computeOnboardingMode(resolvedFor(['pastor'], [{ status: 'pending' }])),
    ).toBe('club');
  });

  it('S1.12 losing the surface role while keeping another global role -> panel_only; only user left -> club', () => {
    expect(computeOnboardingMode(resolvedFor(['director-union', 'user']))).toBe(
      'panel_only',
    );
    expect(computeOnboardingMode(resolvedFor(['user']))).toBe('club');
  });

  it('is derived from the fully resolved profile: the stripped profile would hide the club', () => {
    const full = resolvedFor(['user'], [{ role: 'counselor' }]);
    expect(computeOnboardingMode(full)).toBe('club');
    // stripClubContext empties club data; that is why the mode must not use it.
    expect(computeOnboardingMode(stripClubContext(full))).toBe('club');
    const fullPastor = resolvedFor(['pastor'], [{ status: 'active' }]);
    expect(computeOnboardingMode(fullPastor)).toBe('club');
    expect(computeOnboardingMode(stripClubContext(fullPastor))).toBe(
      'club_exempt',
    );
  });
});

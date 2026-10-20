import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '../common/errors/error-codes';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { InstitutionalHierarchyService } from '../common/services/institutional-hierarchy.service';
import { MembershipRequestsController } from '../membership-requests/membership-requests.controller';
import { PrismaService } from '../prisma/prisma.service';

/**
 * T3c-B11. Design section 13 assumed that a GLOBAL coordinator holding
 * `consent:verify` resolves `club_assignment` resources INSIDE their territory
 * and is denied outside it, so coordinators could be the independent verifier of
 * a director-created minor.
 *
 * VALIDATION RESULT: THE ASSUMPTION FAILS for `coordinator`, `zone-coordinator`
 * and `general-coordinator`.
 *
 * Why: `validateInstanceScope` (PermissionsGuard) lets a request through only if
 * `AuthorizationContextService.canManageClub` is true or the caller's ACTIVE
 * club assignment is that very section. `canManageClub` resolves territory with
 * `resolveActorTerritoryScope`, which only knows super-admin, the division,
 * union and local-field director/assistant roles and admin/assistant-admin. A
 * coordinator is none of them, so their scope is `open`, which
 * `actorCanAccessHierarchyScope` treats as "no territory": denied everywhere,
 * even inside the territory the coordinator was assigned to. A home
 * local_field_id on the user never upgrades the role (see
 * actor-territory-scope.ts).
 *
 * FALLBACK APPLIED (the user must be told): `consent:verify` is seeded only for
 * the CLUB roles director, deputy-director, secretary and secretary-treasurer
 * (plus admin, assistant-admin and super-admin through their wildcard blocks).
 * The coordinator rows were removed from migration
 * 20261022130000_seed_family_permissions and from both seed files. `assistant-lf`
 * resolves territory correctly but already verifies through `club_members:approve`
 * (the seed grants it), so it needs no extra row. Making coordinators verify
 * needs a separate change: teach resolveActorTerritoryScope their territory.
 */

const SECTION_ID = 22;
const MAIN_CLUB_ID = 10;
const OTHER_MAIN_CLUB_ID = 11;
const ASSIGNMENT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '99999999-9999-4999-8999-999999999999';

const HOME_TERRITORY = { local_field: 50, union: 70, division: 1 } as const;
const OTHER_TERRITORY = { local_field: 51, union: 71, division: 2 } as const;

type Territory = { local_field: number; union: number; division: number };

const globalScope = (territory: Territory) => ({
  division: { id: territory.division },
  union: { id: territory.union },
  local_field: { id: territory.local_field },
});

/** A resolved profile with ONE global role and no club assignment. */
function globalRoleProfile(
  roleName: string,
  permissions: string[],
  territory: Territory,
) {
  return {
    authorization: {
      grants: {
        global_roles: [
          {
            role_name: roleName,
            permissions,
            scope: globalScope(territory),
          },
        ],
        club_assignments: [],
        direct_permissions: [],
      },
      active_assignment: { assignment_id: null },
      effective: {
        permissions,
        scope: { global: globalScope(territory), club: null },
      },
    },
  };
}

/** A resolved profile with an ACTIVE club assignment (a CLUB role). */
function clubRoleProfile(
  roleName: string,
  permissions: string[],
  clubId: number,
  sectionId: number,
) {
  const club = { club_id: clubId, club_name: 'Club Amanecer' };
  const section = { club_section_id: sectionId, club_type_id: 2 };
  return {
    authorization: {
      grants: {
        global_roles: [],
        club_assignments: [
          {
            assignment_id: 'assignment-1',
            role_name: roleName,
            permissions,
            operational: true,
            club,
            section,
            scope: {},
            status: 'active',
          },
        ],
        direct_permissions: [],
      },
      active_assignment: { assignment_id: 'assignment-1' },
      effective: {
        permissions,
        scope: {
          global: {},
          club: {
            assignment_id: 'assignment-1',
            role_name: roleName,
            club,
            section,
          },
        },
      },
    },
  };
}

function setup(profile: unknown, clubTerritory: Territory = HOME_TERRITORY) {
  const hierarchy = {
    resolveCurrent: jest.fn().mockResolvedValue({
      division_id: clubTerritory.division,
      union_id: clubTerritory.union,
      local_field_id: clubTerritory.local_field,
      club_id: MAIN_CLUB_ID,
      as_of: new Date(),
      source: 'current',
      precision: 'club',
    }),
  };
  const prisma = {
    club_role_assignments: {
      findUnique: jest.fn().mockResolvedValue({
        club_section_id: SECTION_ID,
        club_sections: {
          club_section_id: SECTION_ID,
          main_club_id: MAIN_CLUB_ID,
          club_type_id: 2,
        },
      }),
    },
  };
  // The REAL authorization context: only the profile loader is replaced. The
  // territory decision (canManageClub -> canAccessHierarchyScope) is production code.
  const authorizationContext = new AuthorizationContextService(
    prisma as unknown as PrismaService,
    hierarchy as unknown as InstitutionalHierarchyService,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  jest
    .spyOn(authorizationContext, 'resolveUserAuthorization')
    .mockResolvedValue(profile);
  const guard = new PermissionsGuard(
    new Reflector(),
    authorizationContext,
    prisma as unknown as PrismaService,
    hierarchy as unknown as InstitutionalHierarchyService,
  );
  return { guard, prisma, hierarchy };
}

/** The context of the REAL verify-consent handler: its real PERMISSIONS_KEY and resource. */
function verifyConsentContext(): ExecutionContext {
  const request = {
    user: { sub: USER_ID },
    params: { clubSectionId: String(SECTION_ID), assignmentId: ASSIGNMENT_ID },
    query: {},
    body: {},
  };
  return {
    getHandler: () => MembershipRequestsController.prototype.verifyConsent,
    getClass: () => MembershipRequestsController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const decide = async (guard: PermissionsGuard) => {
  try {
    return { allowed: await guard.canActivate(verifyConsentContext()) };
  } catch (error) {
    return { allowed: false, code: (error as { code?: string }).code };
  }
};

describe('PermissionsGuard on verify-consent with consent:verify (T3c-B11)', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('GLOBAL coordinators: the design assumption FAILS (documented fallback)', () => {
    it.each(['coordinator', 'zone-coordinator', 'general-coordinator'])(
      '%s holding consent:verify is DENIED even inside their own territory',
      async (role) => {
        const { guard } = setup(
          globalRoleProfile(role, ['consent:verify'], HOME_TERRITORY),
          HOME_TERRITORY,
        );

        const result = await decide(guard);

        // If this ever flips to allowed, resolveActorTerritoryScope learned the
        // coordinator territory: restore the coordinator rows in the seed
        // migration and in both seed files.
        expect(result).toEqual({
          allowed: false,
          code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
        });
      },
    );

    it.each(['coordinator', 'zone-coordinator', 'general-coordinator'])(
      '%s is denied outside their territory too (so it is the role, not the territory, that fails)',
      async (role) => {
        const { guard } = setup(
          globalRoleProfile(role, ['consent:verify'], HOME_TERRITORY),
          OTHER_TERRITORY,
        );

        expect(await decide(guard)).toEqual({
          allowed: false,
          code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
        });
      },
    );
  });

  describe('roles whose territory the guard DOES resolve', () => {
    it('assistant-lf resolves the club inside their local field and is denied outside it', async () => {
      const permissions = ['club_members:approve'];
      const inside = setup(
        globalRoleProfile('assistant-lf', permissions, HOME_TERRITORY),
        HOME_TERRITORY,
      );
      const outside = setup(
        globalRoleProfile('assistant-lf', permissions, HOME_TERRITORY),
        OTHER_TERRITORY,
      );

      expect(await decide(inside.guard)).toEqual({ allowed: true });
      expect(await decide(outside.guard)).toEqual({
        allowed: false,
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
    });

    it('an admin with a configured territory resolves the club inside it only', async () => {
      const permissions = ['consent:verify', 'club_members:approve'];
      const inside = setup(
        globalRoleProfile('admin', permissions, HOME_TERRITORY),
        HOME_TERRITORY,
      );
      const outside = setup(
        globalRoleProfile('admin', permissions, HOME_TERRITORY),
        OTHER_TERRITORY,
      );

      expect(await decide(inside.guard)).toEqual({ allowed: true });
      expect(await decide(outside.guard)).toEqual({
        allowed: false,
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
    });

    it.each([
      'director',
      'deputy-director',
      'secretary',
      'secretary-treasurer',
    ])(
      'CLUB %s holding consent:verify verifies in their own section',
      async (role) => {
        const { guard } = setup(
          clubRoleProfile(role, ['consent:verify'], MAIN_CLUB_ID, SECTION_ID),
        );

        expect(await decide(guard)).toEqual({ allowed: true });
      },
    );

    it('a CLUB role is denied in another section or another club', async () => {
      const otherSection = setup(
        clubRoleProfile('secretary', ['consent:verify'], MAIN_CLUB_ID, 99),
      );
      const otherClub = setup(
        clubRoleProfile(
          'secretary',
          ['consent:verify'],
          OTHER_MAIN_CLUB_ID,
          SECTION_ID,
        ),
      );

      for (const { guard } of [otherSection, otherClub]) {
        expect(await decide(guard)).toEqual({
          allowed: false,
          code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
        });
      }
    });

    it('a member without either permission is denied before any scope check', async () => {
      const { guard, prisma } = setup(
        clubRoleProfile('member', ['classes:read'], MAIN_CLUB_ID, SECTION_ID),
      );

      expect(await decide(guard)).toEqual({
        allowed: false,
        code: ErrorCode.GUARD_PERMISSION_DENIED,
      });
      expect(prisma.club_role_assignments.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('the seed carries the fallback', () => {
    const seedMigration = readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20261022130000_seed_family_permissions/migration.sql',
      ),
      'utf8',
    )
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

    it.each(['coordinator', 'zone-coordinator', 'general-coordinator'])(
      'the migration does not grant consent:verify to %s',
      (role) => {
        expect(seedMigration).not.toContain(`'${role}'`);
      },
    );
  });
});

import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { AuthorizationContextService } from '../services/authorization-context.service';
import { InstitutionalHierarchyService } from '../services/institutional-hierarchy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../errors/error-codes';
import { AuthorizationResource, RequirePermissions } from '../decorators';
import { FinancesController } from '../../finances/finances.controller';
import { CamporeesController } from '../../camporees/camporees.controller';
import { CamporeeEventsController } from '../../camporee-events/camporee-events.controller';
import { CamporeeVenuesController } from '../../camporee-venues/camporee-venues.controller';

/**
 * Regression tests for tenant binding (audit run-1, §2). Dummy tenants:
 * club 1 owns section 10, club 2 owns section 20; union camporee 100 belongs
 * to union 1 and union camporee 900 to union 2. Route metadata is read from
 * the real controllers so removing a `bind` declaration fails these tests.
 */
describe('PermissionsGuard tenant binding', () => {
  const SECTIONS: Record<
    number,
    { club_section_id: number; main_club_id: number }
  > = {
    10: { club_section_id: 10, main_club_id: 1 },
    20: { club_section_id: 20, main_club_id: 2 },
  };
  const UNION_CAMPOREES: Record<number, { union_id: number }> = {
    100: { union_id: 1 },
    900: { union_id: 2 },
  };

  const mockAuthorizationContext = {
    resolveUserAuthorization: jest.fn(),
    canManageClub: jest.fn(),
    canAccessHierarchyScope: jest.fn(),
  };

  const mockHierarchy = {
    resolveCurrent: jest.fn(),
  };

  // Local field 50 participates in union camporee 100; local field 51 was
  // removed (inactive row); nobody from union 1 participates in camporee 900.
  const UNION_CAMPOREE_LOCAL_FIELDS = [
    { union_camporee_lf_id: 100, local_field_id: 50, active: true },
    { union_camporee_lf_id: 100, local_field_id: 51, active: false },
  ];
  const CAMPOREE_EVENTS: Record<
    number,
    { local_camporee_id: null; union_camporee_id: number }
  > = {
    200: { local_camporee_id: null, union_camporee_id: 100 },
    300: { local_camporee_id: null, union_camporee_id: 900 },
  };

  const mockPrisma = {
    club_sections: { findUnique: jest.fn() },
    union_camporees: { findUnique: jest.fn() },
    union_camporee_local_fields: { findFirst: jest.fn() },
    camporee_events: { findUnique: jest.fn() },
    camporee_venues: { findUnique: jest.fn() },
    unions: { findUnique: jest.fn() },
  };

  const guard = new PermissionsGuard(
    new Reflector(),
    mockAuthorizationContext as unknown as AuthorizationContextService,
    mockPrisma as unknown as PrismaService,
    mockHierarchy as unknown as InstitutionalHierarchyService,
  );

  const createContext = (
    controller: new (...args: never[]) => unknown,
    handlerName: string,
    request: Record<string, unknown>,
  ): ExecutionContext =>
    ({
      getHandler: () =>
        (controller.prototype as Record<string, unknown>)[handlerName],
      getClass: () => controller,
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  /** Director of club 1 / section 10 with an active club assignment. */
  const clubDirector = (permissions: string[]) => ({
    authorization: {
      grants: {
        global_roles: [{ role_name: 'user', permissions: [], scope: {} }],
        direct_permissions: [],
        club_assignments: [
          {
            assignment_id: 'assignment-1',
            role_name: 'director',
            permissions,
            club: { club_id: 1, club_name: 'Club Uno' },
            section: { club_section_id: 10, club_type_name: 'pathfinders' },
            scope: { local_field: { id: 50 }, union: { id: 1 } },
            status: 'active',
          },
        ],
      },
      active_assignment: { assignment_id: 'assignment-1' },
      effective: {
        permissions,
        scope: {
          global: {},
          club: {
            assignment_id: 'assignment-1',
            role_name: 'director',
            club: { club_id: 1, club_name: 'Club Uno' },
            section: { club_section_id: 10, club_type_name: 'pathfinders' },
          },
        },
      },
    },
  });

  /** Territorial actor (global role) whose home scope is `globalScope`. */
  const territorialActor = (
    roleName: string,
    permissions: string[],
    globalScope: Record<string, { id: number }>,
  ) => ({
    authorization: {
      grants: {
        global_roles: [
          { role_name: roleName, permissions, scope: globalScope },
        ],
        direct_permissions: [],
        club_assignments: [],
      },
      active_assignment: { assignment_id: null },
      effective: {
        permissions,
        scope: { global: globalScope, club: null },
      },
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthorizationContext.canManageClub.mockResolvedValue(false);
    mockAuthorizationContext.canAccessHierarchyScope.mockImplementation(
      (resolved, scope) => {
        const globalScope = resolved.authorization.effective.scope.global ?? {};
        if (typeof globalScope.union?.id === 'number') {
          return scope.union_id === globalScope.union.id;
        }
        if (typeof globalScope.local_field?.id === 'number') {
          return scope.local_field_id === globalScope.local_field.id;
        }
        return false;
      },
    );
    mockHierarchy.resolveCurrent.mockImplementation(
      async (input: { unionId?: number; localFieldId?: number }) => ({
        division_id: 7,
        union_id: input.unionId ?? null,
        local_field_id: input.localFieldId ?? null,
        as_of: new Date('2026-01-01'),
        source: 'current',
      }),
    );
    mockPrisma.club_sections.findUnique.mockImplementation(
      async ({ where }: { where: { club_section_id: number } }) =>
        SECTIONS[where.club_section_id] ?? null,
    );
    mockPrisma.union_camporees.findUnique.mockImplementation(
      async ({ where }: { where: { union_camporee_id: number } }) => {
        const row = UNION_CAMPOREES[where.union_camporee_id];
        return row ? { ...row, unions: { country_id: 1 } } : null;
      },
    );
    mockPrisma.union_camporee_local_fields.findFirst.mockImplementation(
      async ({
        where,
      }: {
        where: {
          union_camporee_lf_id: number;
          local_field_id: number;
          active: boolean;
        };
      }) =>
        UNION_CAMPOREE_LOCAL_FIELDS.find(
          (row) =>
            row.union_camporee_lf_id === where.union_camporee_lf_id &&
            row.local_field_id === where.local_field_id &&
            row.active === where.active,
        ) ?? null,
    );
    mockPrisma.camporee_events.findUnique.mockImplementation(
      async ({ where }: { where: { camporee_event_id: number } }) =>
        CAMPOREE_EVENTS[where.camporee_event_id] ?? null,
    );
    mockPrisma.unions.findUnique.mockResolvedValue({ country_id: 1 });
  });

  describe('POST /clubs/:clubId/finances (body club_section_id)', () => {
    const run = (body: Record<string, unknown>) =>
      guard.canActivate(
        createContext(FinancesController, 'create', {
          user: { sub: 'treasurer-1' },
          params: { clubId: '1' },
          body,
        }),
      );

    beforeEach(() => {
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        clubDirector(['finances:create']),
      );
    });

    it('allows the actor own section', async () => {
      await expect(run({ club_section_id: 10 })).resolves.toBe(true);
      await expect(run({ club_section_id: '10' })).resolves.toBe(true);
    });

    it('rejects another club section in the body', async () => {
      await expect(run({ club_section_id: 20 })).rejects.toMatchObject({
        code: ErrorCode.CLUB_SECTION_NOT_FOUND,
      });
    });

    it('rejects a director of another club posting to that club', async () => {
      await expect(
        guard.canActivate(
          createContext(FinancesController, 'create', {
            user: { sub: 'treasurer-1' },
            params: { clubId: '2' },
            body: { club_section_id: 20 },
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
    });

    it('allows a territorial actor that manages the club, only for its sections', async () => {
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        territorialActor('director-lf', ['finances:create'], {
          local_field: { id: 50 },
        }),
      );
      mockAuthorizationContext.canManageClub.mockImplementation(
        async (_userId: string, clubId: number) => clubId === 1,
      );

      await expect(run({ club_section_id: 10 })).resolves.toBe(true);
      await expect(run({ club_section_id: 20 })).rejects.toMatchObject({
        code: ErrorCode.CLUB_SECTION_NOT_FOUND,
      });
    });

    it('rejects a missing or malformed section id', async () => {
      await expect(run({})).rejects.toMatchObject({
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
      await expect(run({ club_section_id: [10, 20] })).rejects.toMatchObject({
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
      await expect(run({ club_section_id: '20abc' })).rejects.toMatchObject({
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
      expect(mockPrisma.club_sections.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('PATCH/DELETE /camporees/union/:camporeeId', () => {
    const runPatch = (camporeeId: string, body: Record<string, unknown> = {}) =>
      guard.canActivate(
        createContext(CamporeesController, 'updateUnion', {
          user: { sub: 'union-actor' },
          params: { camporeeId },
          body,
        }),
      );
    const runDelete = (camporeeId: string) =>
      guard.canActivate(
        createContext(CamporeesController, 'removeUnion', {
          user: { sub: 'union-actor' },
          params: { camporeeId },
          body: {},
        }),
      );

    beforeEach(() => {
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        territorialActor(
          'director-union',
          ['camporees:update', 'camporees:delete'],
          { union: { id: 1 } },
        ),
      );
    });

    it('allows the organizing union', async () => {
      await expect(runPatch('100', { name: 'x' })).resolves.toBe(true);
      await expect(runDelete('100')).resolves.toBe(true);
    });

    it('rejects a camporee owned by another union', async () => {
      await expect(runPatch('900')).rejects.toMatchObject({
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
      await expect(runDelete('900')).rejects.toMatchObject({
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
    });

    it('rejects retargeting an own camporee to another union via body union_id', async () => {
      await expect(runPatch('100', { union_id: 2 })).rejects.toMatchObject({
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
    });

    it('does not admit local-field actors through the participation fallback', async () => {
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        territorialActor('director-lf', ['camporees:update'], {
          local_field: { id: 50 },
        }),
      );

      await expect(runPatch('100')).rejects.toMatchObject({
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
    });
  });

  describe('union camporee participation fallback (type union_camporee)', () => {
    /** Club director whose active assignment sits in `localFieldId`. */
    const clubDirectorInLocalField = (
      permissions: string[],
      localFieldId: number,
    ) => {
      const actor = clubDirector(permissions);
      actor.authorization.grants.club_assignments[0].scope = {
        local_field: { id: localFieldId },
        union: { id: 1 },
      };
      return actor;
    };

    const runGetMembers = (camporeeId: string) =>
      guard.canActivate(
        createContext(CamporeesController, 'getUnionMembers', {
          user: { sub: 'participant' },
          params: { camporeeId },
        }),
      );
    const runRegister = (camporeeId: string) =>
      guard.canActivate(
        createContext(CamporeesController, 'registerMemberToUnion', {
          user: { sub: 'participant' },
          params: { camporeeId },
          body: {},
        }),
      );
    const runGetEvent = (eventId: string) =>
      guard.canActivate(
        createContext(CamporeeEventsController, 'getEvent', {
          user: { sub: 'participant' },
          params: { eventId },
        }),
      );

    it('admits a local-field director whose field participates', async () => {
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        territorialActor('director-lf', ['attendance:read'], {
          local_field: { id: 50 },
        }),
      );

      await expect(runGetMembers('100')).resolves.toBe(true);
    });

    it('rejects a local-field director for a camporee the field does not join', async () => {
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        territorialActor('director-lf', ['attendance:read'], {
          local_field: { id: 50 },
        }),
      );

      await expect(runGetMembers('900')).rejects.toMatchObject({
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
    });

    it('rejects a local field whose participation is inactive', async () => {
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        territorialActor('assistant-lf', ['attendance:read'], {
          local_field: { id: 51 },
        }),
      );

      await expect(runGetMembers('100')).rejects.toMatchObject({
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
    });

    it('admits a club director of a participating field to register members', async () => {
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        clubDirectorInLocalField(['attendance:manage'], 50),
      );

      await expect(runRegister('100')).resolves.toBe(true);
    });

    it('rejects a club director whose field does not participate', async () => {
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        clubDirectorInLocalField(['attendance:manage'], 52),
      );

      await expect(runRegister('100')).rejects.toMatchObject({
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
      await expect(runRegister('900')).rejects.toMatchObject({
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
    });

    it('applies the same rule to events of a union camporee', async () => {
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        territorialActor('director-lf', ['camporee_events:read'], {
          local_field: { id: 50 },
        }),
      );

      await expect(runGetEvent('200')).resolves.toBe(true);
      await expect(runGetEvent('300')).rejects.toMatchObject({
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
    });

    it('does not admit local-field actors to union venues (no concrete camporee)', async () => {
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        territorialActor('director-lf', ['camporee_events:update'], {
          local_field: { id: 50 },
        }),
      );
      mockPrisma.camporee_venues.findUnique.mockResolvedValue({
        scope: 'union',
        union_id: 1,
        local_field_id: null,
      });

      await expect(
        guard.canActivate(
          createContext(CamporeeVenuesController, 'updateVenue', {
            user: { sub: 'participant' },
            params: { venueId: '5' },
            body: {},
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
    });

    it('keeps admitting the organizing union without a participation row', async () => {
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        territorialActor('director-union', ['attendance:read'], {
          union: { id: 2 },
        }),
      );

      await expect(runGetMembers('900')).resolves.toBe(true);
      expect(
        mockPrisma.union_camporee_local_fields.findFirst,
      ).not.toHaveBeenCalled();
    });
  });

  describe('owner bypass', () => {
    @AuthorizationResource({
      type: 'active_assignment',
      ownerParam: 'userId',
      bind: [
        { kind: 'club_section', source: 'body', field: 'club_section_id' },
      ],
    })
    class OwnerRouteController {
      @RequirePermissions('dummy:write')
      handle() {
        return undefined;
      }
    }

    it('still binds tenant ids sent by the resource owner', async () => {
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        clubDirector([]),
      );
      const run = (sectionId: number) =>
        guard.canActivate(
          createContext(OwnerRouteController, 'handle', {
            user: { sub: 'owner-1' },
            params: { userId: 'owner-1' },
            body: { club_section_id: sectionId },
          }),
        );

      await expect(run(10)).resolves.toBe(true);
      await expect(run(20)).rejects.toMatchObject({
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
    });
  });
});

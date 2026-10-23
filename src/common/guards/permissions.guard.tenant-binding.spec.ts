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

  const mockPrisma = {
    club_sections: { findUnique: jest.fn() },
    union_camporees: { findUnique: jest.fn() },
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

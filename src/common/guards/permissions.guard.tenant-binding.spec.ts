import { clubAssignmentEffectivityArgs } from '../authorization/testing/club-assignment-effectivity.testing';
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
import { CamporeeOrdersController } from '../../camporee-orders/camporee-orders.controller';
import {
  CAMPOREE_ORDERS_CREATE,
  CAMPOREE_ORDERS_OFFERING_CONFIGURE,
  CAMPOREE_ORDERS_READ,
} from '../../camporee-orders/permissions';
import {
  CAMPOREE_SUPPLIES_CONFIGURE,
  CAMPOREE_SUPPLIES_DELIVER,
  CAMPOREE_SUPPLIES_PLAN,
  CAMPOREE_SUPPLIES_READ,
} from '../../camporee-supplies/permissions';
import { OfferingsController } from '../../camporee-orders/offerings.controller';
import { CamporeeSupplyConfigController } from '../../camporee-supplies/config.controller';
import { CamporeeSupplyPlansController } from '../../camporee-supplies/plans.controller';
import { FieldPaymentOrdersController } from '../../field-payment-orders/field-payment-orders.controller';
import { AdminCoordinationController } from '../../coordination/coordination.controller';
import { ConfigController } from '../../materials/config/config.controller';
import { NotificationsController } from '../../notifications/notifications.controller';
import { AnnualRankingProgressController } from '../../rankings/annual-ranking-progress/annual-ranking-progress.controller';
import { SectionRankingsController } from '../../rankings/section-rankings/section-rankings.controller';
import { ScoringCategoriesController } from '../../scoring-categories/scoring-categories.controller';

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

  // Local camporees: 300 belongs to local field 50 / union 1, 301 to local
  // field 60 / union 2.
  const LOCAL_CAMPOREES: Record<
    number,
    { local_field_id: number; local_fields: { union_id: number } }
  > = {
    300: { local_field_id: 50, local_fields: { union_id: 1 } },
    301: { local_field_id: 60, local_fields: { union_id: 2 } },
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
    local_camporees: { findUnique: jest.fn() },
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
    ...clubAssignmentEffectivityArgs(),
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
    mockPrisma.local_camporees.findUnique.mockImplementation(
      async ({ where }: { where: { local_camporee_id: number } }) => {
        const row = LOCAL_CAMPOREES[where.local_camporee_id];
        return row
          ? {
              ...row,
              local_fields: { ...row.local_fields, unions: { country_id: 1 } },
            }
          : null;
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

  describe('camporee routes (orders, offerings, payment orders, supplies, union detail)', () => {
    type Kind = 'local-typed' | 'local-global' | 'union-typed' | 'union-global';
    const PLAN = [CAMPOREE_SUPPLIES_PLAN];
    const READ = [CAMPOREE_SUPPLIES_READ];
    const CONFIGURE = [CAMPOREE_SUPPLIES_CONFIGURE];
    const OFFERING = [CAMPOREE_ORDERS_OFFERING_CONFIGURE];
    const ORDERS_READ = [CAMPOREE_ORDERS_READ];

    // [label, controller, handler, permissions, kind]
    const ROUTES: Array<
      [string, new (...args: never[]) => unknown, string, string[], Kind]
    > = [
      [
        'orders local',
        CamporeeOrdersController,
        'createLocal',
        [CAMPOREE_ORDERS_CREATE],
        'local-typed',
      ],
      [
        'orders union',
        CamporeeOrdersController,
        'createUnion',
        [CAMPOREE_ORDERS_CREATE],
        'union-typed',
      ],
      [
        'offerings read local',
        OfferingsController,
        'listLocalOfferings',
        ORDERS_READ,
        'local-global',
      ],
      [
        'offerings read union',
        OfferingsController,
        'listUnionOfferings',
        ORDERS_READ,
        'union-global',
      ],
      [
        'offerings settings local',
        OfferingsController,
        'updateLocalSettings',
        OFFERING,
        'local-global',
      ],
      [
        'offerings replace local',
        OfferingsController,
        'replaceLocalOfferings',
        OFFERING,
        'local-global',
      ],
      [
        'payment-orders local',
        FieldPaymentOrdersController,
        'createCamporeeOrder',
        ['field-payment-orders:create'],
        'local-typed',
      ],
      [
        'payment-orders union',
        FieldPaymentOrdersController,
        'createUnionCamporeeOrder',
        ['field-payment-orders:create'],
        'union-typed',
      ],
      [
        'supply config local',
        CamporeeSupplyConfigController,
        'settingsLocal',
        CONFIGURE,
        'local-global',
      ],
      [
        'supply config union',
        CamporeeSupplyConfigController,
        'settingsUnion',
        CONFIGURE,
        'union-global',
      ],
      [
        'supply catalog local',
        CamporeeSupplyConfigController,
        'catalogLocal',
        READ,
        'local-typed',
      ],
      [
        'supply catalog union',
        CamporeeSupplyConfigController,
        'catalogUnion',
        READ,
        'union-typed',
      ],
      [
        'plan get local',
        CamporeeSupplyPlansController,
        'getLocal',
        PLAN,
        'local-typed',
      ],
      [
        'plan get union',
        CamporeeSupplyPlansController,
        'getUnion',
        PLAN,
        'union-typed',
      ],
      [
        'plan list local',
        CamporeeSupplyPlansController,
        'listLocal',
        READ,
        'local-global',
      ],
      [
        'plan list union',
        CamporeeSupplyPlansController,
        'listUnion',
        READ,
        'union-global',
      ],
      [
        'plan adjust local',
        CamporeeSupplyPlansController,
        'adjustLocal',
        PLAN,
        'local-global',
      ],
      [
        'plan adjust union',
        CamporeeSupplyPlansController,
        'adjustUnion',
        PLAN,
        'union-global',
      ],
      [
        'plan deliver local',
        CamporeeSupplyPlansController,
        'deliverLocal',
        [CAMPOREE_SUPPLIES_DELIVER],
        'local-global',
      ],
      [
        'plan deliver union',
        CamporeeSupplyPlansController,
        'deliverUnion',
        [CAMPOREE_SUPPLIES_DELIVER],
        'union-global',
      ],
      [
        'reports kitchen local',
        CamporeeSupplyPlansController,
        'kitchenLocal',
        READ,
        'local-global',
      ],
      [
        'reports cash union',
        CamporeeSupplyPlansController,
        'cashUnion',
        READ,
        'union-global',
      ],
      [
        'union detail read',
        CamporeesController,
        'findOneUnion',
        ['camporees:read'],
        'union-typed',
      ],
    ];

    // Allowed / cross-tenant camporee ids per kind.
    const IDS = {
      local: { ok: '300', other: '301', missing: '999' },
      union: { ok: '100', other: '900', missing: '999' },
    };

    const actorFor = (kind: Kind, permissions: string[]) => {
      if (kind === 'local-typed' || kind === 'union-typed') {
        return clubDirector(permissions); // LF 50 / union 1 in the club grant
      }
      return territorialActor('director', permissions, {
        [kind === 'local-global' ? 'local_field' : 'union']: {
          id: kind === 'local-global' ? 50 : 1,
        },
      });
    };

    const run = (
      controller: new (...args: never[]) => unknown,
      handler: string,
      camporeeId: string,
    ) =>
      guard.canActivate(
        createContext(controller, handler, {
          user: { sub: 'actor' },
          params: { camporeeId, lineId: '1', slotId: '1', productId: '1' },
          body: {},
          query: {},
        }),
      );

    describe.each(ROUTES)('%s', (_label, controller, handler, perms, kind) => {
      const ids = kind.startsWith('local') ? IDS.local : IDS.union;
      const notFound = kind.startsWith('local')
        ? ErrorCode.CAMPOREE_NOT_FOUND
        : ErrorCode.CAMPOREE_UNION_CAMPOREE_NOT_FOUND;

      beforeEach(() => {
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          actorFor(kind, perms),
        );
      });

      it('allows an actor of the camporee scope', async () => {
        await expect(run(controller, handler, ids.ok)).resolves.toBe(true);
      });

      it('rejects a camporee of another tenant', async () => {
        await expect(run(controller, handler, ids.other)).rejects.toMatchObject(
          {
            code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
          },
        );
      });

      it('returns 404 for an unknown camporee', async () => {
        await expect(
          run(controller, handler, ids.missing),
        ).rejects.toMatchObject({ code: notFound });
      });
    });

    describe('union configure routes are owner-only', () => {
      beforeEach(() => {
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          territorialActor('director-union', OFFERING, { union: { id: 1 } }),
        );
      });

      it.each(['updateUnionSettings', 'replaceUnionOfferings'])(
        '%s: owner union passes, other union is rejected',
        async (handler) => {
          await expect(run(OfferingsController, handler, '100')).resolves.toBe(
            true,
          );
          await expect(
            run(OfferingsController, handler, '900'),
          ).rejects.toMatchObject({
            code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
          });
        },
      );

      it('does not admit a participating local-field actor', async () => {
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          territorialActor('director-lf', OFFERING, {
            local_field: { id: 50 },
          }),
        );
        await expect(
          run(OfferingsController, 'updateUnionSettings', '100'),
        ).rejects.toMatchObject({
          code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
        });
      });
    });
  });

  describe('fase 5 batch 3: remaining tenant routes', () => {
    const operational = <T extends ReturnType<typeof clubDirector>>(
      actor: T,
    ): T => {
      for (const grant of actor.authorization.grants.club_assignments) {
        (grant as Record<string, unknown>).operational = true;
      }
      return actor;
    };

    const runWith = (
      controller: new (...args: never[]) => unknown,
      handler: string,
      params: Record<string, string>,
    ) =>
      guard.canActivate(
        createContext(controller, handler, {
          user: { sub: 'actor' },
          params,
          body: {},
          query: {},
        }),
      );

    describe('coordination local-field routes (local_field)', () => {
      const ROUTES: Array<[string, string]> = [
        ['GET zones', 'listZones'],
        ['POST zones', 'createZone'],
        ['GET assignments', 'listAssignments'],
        ['POST assignments', 'createAssignment'],
        ['POST backfill', 'backfillLegacyAssignments'],
      ];

      beforeEach(() => {
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          territorialActor('director-lf', ['coordination:manage'], {
            local_field: { id: 50 },
          }),
        );
      });

      it.each(ROUTES)('%s: allows its own local field', async (_l, handler) => {
        await expect(
          runWith(AdminCoordinationController, handler, {
            localFieldId: '50',
          }),
        ).resolves.toBe(true);
      });

      it.each(ROUTES)(
        '%s: rejects another local field',
        async (_l, handler) => {
          await expect(
            runWith(AdminCoordinationController, handler, {
              localFieldId: '60',
            }),
          ).rejects.toMatchObject({
            code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
          });
        },
      );
    });

    describe('PATCH /materials/config/:localFieldId', () => {
      beforeEach(() => {
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          territorialActor('director-lf', ['materiales:configure'], {
            local_field: { id: 50 },
          }),
        );
      });

      it('allows its own local field and rejects another', async () => {
        await expect(
          runWith(ConfigController, 'updateById', { localFieldId: '50' }),
        ).resolves.toBe(true);
        await expect(
          runWith(ConfigController, 'updateById', { localFieldId: '60' }),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
      });
    });

    describe('POST /notifications/club/:instanceType/:instanceId (club_section)', () => {
      const run = (instanceId: string) =>
        runWith(NotificationsController, 'sendToClub', {
          instanceType: 'club',
          instanceId,
        });

      it('allows the director of the section club', async () => {
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          clubDirector(['notifications:club']),
        );
        await expect(run('10')).resolves.toBe(true);
      });

      it('rejects a section of another club', async () => {
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          clubDirector(['notifications:club']),
        );
        await expect(run('20')).rejects.toMatchObject({
          code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
        });
      });

      it('returns 404 for an unknown section', async () => {
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          clubDirector(['notifications:club']),
        );
        await expect(run('999')).rejects.toMatchObject({
          code: ErrorCode.CLUB_SECTION_NOT_FOUND,
        });
      });
    });

    describe.each([
      [
        'GET /club-sections/:sectionId/annual-ranking-progress',
        AnnualRankingProgressController,
        'getProgress',
        'rankings:read',
      ],
      [
        'GET /section-rankings/:sectionId/members',
        SectionRankingsController,
        'getMembers',
        'section_rankings:read_club',
      ],
    ] as const)(
      '%s (club_section_membership)',
      (_l, controller, handler, perm) => {
        const run = (sectionId: string) =>
          runWith(controller, handler, { sectionId });

        it('allows an actor with an operational grant in the club (not the active one)', async () => {
          const actor = operational(clubDirector([perm]));
          // Active assignment is in club 2; the grant in club 1 is a secondary one.
          const club1Grant = actor.authorization.grants.club_assignments[0];
          actor.authorization.grants.club_assignments = [
            {
              ...club1Grant,
              assignment_id: 'assignment-2',
              club: { club_id: 2, club_name: 'Club Dos' },
              section: { club_section_id: 20, club_type_name: 'pathfinders' },
            },
            club1Grant,
          ];
          actor.authorization.active_assignment = {
            assignment_id: 'assignment-2',
          };
          actor.authorization.effective.scope.club = {
            ...actor.authorization.effective.scope.club,
            assignment_id: 'assignment-2',
            club: { club_id: 2, club_name: 'Club Dos' },
            section: { club_section_id: 20, club_type_name: 'pathfinders' },
          };
          mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
            actor,
          );
          await expect(run('10')).resolves.toBe(true);
        });

        it('rejects a section of another club', async () => {
          mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
            operational(clubDirector([perm])),
          );
          await expect(run('20')).rejects.toMatchObject({
            code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
          });
        });

        it('allows an actor that can manage the club', async () => {
          mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
            territorialActor('director-lf', [perm], {
              local_field: { id: 50 },
            }),
          );
          mockAuthorizationContext.canManageClub.mockImplementation(
            async (_u: string, clubId: number) => clubId === 2,
          );
          await expect(run('20')).resolves.toBe(true);
          await expect(run('10')).rejects.toMatchObject({
            code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
          });
        });

        it('returns 404 for an unknown section', async () => {
          mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
            operational(clubDirector([perm])),
          );
          await expect(run('999')).rejects.toMatchObject({
            code: ErrorCode.CLUB_SECTION_NOT_FOUND,
          });
        });
      },
    );

    describe('scoring categories (union_membership / local_field_membership)', () => {
      const PERM = 'scoring_categories:read';
      const clubMember = (unionId: number, lfId: number) => {
        const actor = operational(clubDirector([PERM]));
        actor.authorization.grants.club_assignments[0].scope = {
          local_field: { id: lfId },
          union: { id: unionId },
        };
        return actor;
      };

      it('union: allows a club member of the union, denies another union', async () => {
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          clubMember(1, 50),
        );
        await expect(
          runWith(ScoringCategoriesController, 'findUnionCategories', {
            unionId: '1',
          }),
        ).resolves.toBe(true);
        await expect(
          runWith(ScoringCategoriesController, 'findUnionCategories', {
            unionId: '2',
          }),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
      });

      it('union: allows a union director through the hierarchy', async () => {
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          territorialActor('director-union', [PERM], { union: { id: 1 } }),
        );
        await expect(
          runWith(ScoringCategoriesController, 'findUnionCategories', {
            unionId: '1',
          }),
        ).resolves.toBe(true);
        await expect(
          runWith(ScoringCategoriesController, 'findUnionCategories', {
            unionId: '2',
          }),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
      });

      it('local field: allows a club member of the field, denies another', async () => {
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          clubMember(1, 50),
        );
        await expect(
          runWith(ScoringCategoriesController, 'findLocalFieldCategories', {
            fieldId: '50',
          }),
        ).resolves.toBe(true);
        await expect(
          runWith(ScoringCategoriesController, 'findLocalFieldCategories', {
            fieldId: '60',
          }),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
      });

      it('local field: allows a local-field director through the hierarchy', async () => {
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          territorialActor('director-lf', [PERM], { local_field: { id: 50 } }),
        );
        await expect(
          runWith(ScoringCategoriesController, 'findLocalFieldCategories', {
            fieldId: '50',
          }),
        ).resolves.toBe(true);
        await expect(
          runWith(ScoringCategoriesController, 'findLocalFieldCategories', {
            fieldId: '60',
          }),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
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

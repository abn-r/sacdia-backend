import { clubAssignmentEffectivityArgs } from '../authorization/testing/club-assignment-effectivity.testing';
import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { AuthorizationContextService } from '../services/authorization-context.service';
import { InstitutionalHierarchyService } from '../services/institutional-hierarchy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../errors/error-codes';
import { ClubEnrollmentValidationController } from '../../club-enrollments/club-enrollment-validation.controller';
import { CamporeesController } from '../../camporees/camporees.controller';

/**
 * Regression tests for entity-UUID routes (audit run-1: club enrollment
 * review and camporee payments). Dummy tenants:
 * - club 1 (local field 50) owns sections 10 and 11; club 2 (local field 60)
 *   owns section 20.
 * - local camporee 300 belongs to local field 50, local camporee 400 to 60.
 * - union camporee 100 belongs to union 1 (local field 50 participates),
 *   union camporee 900 to union 2.
 * Route metadata is read from the real controllers, so dropping the
 * resolver/bind declaration fails these tests.
 */
describe('PermissionsGuard entity UUID resolvers', () => {
  const PAYMENT_LOCAL_LF50 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa50';
  const PAYMENT_LOCAL_LF60 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa60';
  const PAYMENT_UNION_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb100';
  const PAYMENT_UNION_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb900';
  const PAYMENT_NO_CAMPOREE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const MISSING_UUID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  const CLUB_LOCAL_FIELD: Record<number, number> = { 1: 50, 2: 60 };
  const PAYMENT_MEMBER: Record<
    string,
    { camporee_id: number | null; union_camporee_id: number | null }
  > = {
    [PAYMENT_LOCAL_LF50]: { camporee_id: 300, union_camporee_id: null },
    [PAYMENT_LOCAL_LF60]: { camporee_id: 400, union_camporee_id: null },
    [PAYMENT_UNION_1]: { camporee_id: null, union_camporee_id: 100 },
    [PAYMENT_UNION_2]: { camporee_id: null, union_camporee_id: 900 },
    [PAYMENT_NO_CAMPOREE]: { camporee_id: null, union_camporee_id: null },
  };
  const LOCAL_CAMPOREE_FIELD: Record<number, number> = { 300: 50, 400: 60 };
  const UNION_CAMPOREE_UNION: Record<number, number> = { 100: 1, 900: 2 };
  const LOCAL_FIELD_UNION: Record<number, number> = { 50: 1, 60: 2 };
  const UNION_CAMPOREE_LOCAL_FIELDS = [
    { union_camporee_lf_id: 100, local_field_id: 50, active: true },
  ];

  const mockAuthorizationContext = {
    resolveUserAuthorization: jest.fn(),
    canManageClub: jest.fn(),
    canAccessHierarchyScope: jest.fn(),
  };

  const mockHierarchy = {
    resolveCurrent: jest.fn(),
  };

  const mockPrisma = {
    club_enrollments: { findUnique: jest.fn() },
    camporee_payments: { findUnique: jest.fn() },
    local_camporees: { findUnique: jest.fn() },
    union_camporees: { findUnique: jest.fn() },
    union_camporee_local_fields: { findFirst: jest.fn() },
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

  /**
   * Director of club 1 / section 10 (local field 50). `globalPermissions`
   * models a club actor that also holds the permission through a global role.
   */
  const clubDirector = (
    permissions: string[],
    globalPermissions: string[] = [],
  ) => ({
    authorization: {
      grants: {
        global_roles: [
          { role_name: 'user', permissions: globalPermissions, scope: {} },
        ],
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

  type Actor =
    ReturnType<typeof clubDirector> | ReturnType<typeof territorialActor>;

  const actorScope = (
    resolved: Actor,
  ): { local_field?: { id: number }; union?: { id: number } } =>
    resolved.authorization.effective.scope.global;

  let currentActor: Actor;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthorizationContext.resolveUserAuthorization.mockImplementation(
      async () => currentActor,
    );
    mockAuthorizationContext.canAccessHierarchyScope.mockImplementation(
      (resolved, scope) => {
        const globalScope = actorScope(resolved);
        if (typeof globalScope.union?.id === 'number') {
          return scope.union_id === globalScope.union.id;
        }
        if (typeof globalScope.local_field?.id === 'number') {
          return scope.local_field_id === globalScope.local_field.id;
        }
        return false;
      },
    );
    // Territory over the club's local field / union, like the real service.
    mockAuthorizationContext.canManageClub.mockImplementation(
      async (_userId: string, clubId: number) => {
        const globalScope = actorScope(currentActor);
        const localFieldId = CLUB_LOCAL_FIELD[clubId];
        return (
          globalScope.local_field?.id === localFieldId ||
          globalScope.union?.id === LOCAL_FIELD_UNION[localFieldId]
        );
      },
    );
    mockHierarchy.resolveCurrent.mockImplementation(
      async (input: { unionId?: number; localFieldId?: number }) => ({
        division_id: 7,
        union_id:
          input.unionId ??
          (input.localFieldId ? LOCAL_FIELD_UNION[input.localFieldId] : null),
        local_field_id: input.localFieldId ?? null,
        as_of: new Date('2026-01-01'),
        source: 'current',
      }),
    );
    mockPrisma.camporee_payments.findUnique.mockImplementation(
      async ({ where }: { where: { camporee_payment_id: string } }) => {
        const member = PAYMENT_MEMBER[where.camporee_payment_id];
        return member ? { camporee_member: member } : null;
      },
    );
    mockPrisma.local_camporees.findUnique.mockImplementation(
      async ({ where }: { where: { local_camporee_id: number } }) => {
        const localFieldId = LOCAL_CAMPOREE_FIELD[where.local_camporee_id];
        return localFieldId
          ? {
              local_field_id: localFieldId,
              local_fields: {
                union_id: LOCAL_FIELD_UNION[localFieldId],
                unions: { country_id: 1 },
              },
            }
          : null;
      },
    );
    mockPrisma.union_camporees.findUnique.mockImplementation(
      async ({ where }: { where: { union_camporee_id: number } }) => {
        const unionId = UNION_CAMPOREE_UNION[where.union_camporee_id];
        return unionId
          ? { union_id: unionId, unions: { country_id: 1 } }
          : null;
      },
    );
    mockPrisma.union_camporee_local_fields.findFirst.mockImplementation(
      async ({
        where,
      }: {
        where: { union_camporee_lf_id: number; local_field_id: number };
      }) =>
        UNION_CAMPOREE_LOCAL_FIELDS.find(
          (row) =>
            row.union_camporee_lf_id === where.union_camporee_lf_id &&
            row.local_field_id === where.local_field_id,
        ) ?? null,
    );
  });

  describe('POST /club-enrollments/:enrollmentId/approve|reject', () => {
    const run = (handler: 'approve' | 'reject', enrollmentId: string) =>
      guard.canActivate(
        createContext(ClubEnrollmentValidationController, handler, {
          user: { sub: 'reviewer-1' },
          params: { enrollmentId },
          body: {},
        }),
      );

    // The territory check moved into the review service (404 for an id out of
    // scope), so the route no longer binds the enrollment: the guard only
    // asks for the permission and never reads the enrollment.
    it.each(['approve', 'reject', 'findValidationQueue'] as const)(
      '%s declares club_enrollments:validate on a global resource without binds',
      (handler) => {
        const target = ClubEnrollmentValidationController.prototype[handler];
        expect(Reflect.getMetadata('permissions', target)).toEqual({
          mode: 'all',
          permissions: ['club_enrollments:validate'],
        });
        expect(Reflect.getMetadata('authorization_resource', target)).toEqual({
          type: 'global',
        });
      },
    );

    it('lets a reviewer holding the permission reach the service, whatever the club', async () => {
      currentActor = territorialActor(
        'director-lf',
        ['club_enrollments:validate'],
        { local_field: { id: 50 } },
      );

      await expect(run('approve', MISSING_UUID)).resolves.toBe(true);
      await expect(run('reject', MISSING_UUID)).resolves.toBe(true);
      expect(mockPrisma.club_enrollments.findUnique).not.toHaveBeenCalled();
    });

    it('keeps out a reviewer that only holds the old club_instances:update', async () => {
      currentActor = territorialActor(
        'director-lf',
        ['club_instances:update'],
        { local_field: { id: 50 } },
      );

      await expect(run('approve', MISSING_UUID)).rejects.toBeDefined();
    });
  });

  describe('camporee payments by UUID', () => {
    const run = (
      handler: 'updatePayment' | 'approvePayment' | 'rejectPayment',
      params: Record<string, string>,
    ) =>
      guard.canActivate(
        createContext(CamporeesController, handler, {
          user: { sub: 'actor-1' },
          params,
          body: {},
        }),
      );

    describe('PATCH /camporees/payments/:paymentId', () => {
      beforeEach(() => {
        currentActor = clubDirector(['attendance:manage']);
      });

      it('allows a club actor of the local camporee field', async () => {
        await expect(
          run('updatePayment', { paymentId: PAYMENT_LOCAL_LF50 }),
        ).resolves.toBe(true);
      });

      it('rejects a payment of a camporee in another local field', async () => {
        await expect(
          run('updatePayment', { paymentId: PAYMENT_LOCAL_LF60 }),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
      });

      it('applies the union camporee participation rule', async () => {
        await expect(
          run('updatePayment', { paymentId: PAYMENT_UNION_1 }),
        ).resolves.toBe(true);
        await expect(
          run('updatePayment', { paymentId: PAYMENT_UNION_2 }),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
      });

      it('returns not found for an unknown payment', async () => {
        await expect(
          run('updatePayment', { paymentId: MISSING_UUID }),
        ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_PAYMENT_NOT_FOUND });
      });

      it('rejects a payment whose member has no camporee', async () => {
        await expect(
          run('updatePayment', { paymentId: PAYMENT_NO_CAMPOREE }),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
      });

      it('rejects a malformed payment id before querying', async () => {
        await expect(
          run('updatePayment', { paymentId: 'not-a-uuid' }),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
        expect(mockPrisma.camporee_payments.findUnique).not.toHaveBeenCalled();
      });
    });

    describe('PATCH /camporees/payments/:camporeePaymentId/approve|reject', () => {
      it('allows the local field that owns the camporee', async () => {
        currentActor = territorialActor(
          'director-lf',
          ['attendance:approve_late'],
          { local_field: { id: 50 } },
        );

        await expect(
          run('approvePayment', { camporeePaymentId: PAYMENT_LOCAL_LF50 }),
        ).resolves.toBe(true);
        await expect(
          run('rejectPayment', { camporeePaymentId: PAYMENT_LOCAL_LF50 }),
        ).resolves.toBe(true);
      });

      it('rejects a payment of another local field camporee', async () => {
        currentActor = territorialActor(
          'director-lf',
          ['attendance:approve_late'],
          { local_field: { id: 50 } },
        );

        await expect(
          run('approvePayment', { camporeePaymentId: PAYMENT_LOCAL_LF60 }),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
        await expect(
          run('rejectPayment', { camporeePaymentId: PAYMENT_LOCAL_LF60 }),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
      });

      it('allows the organizing union and rejects another union camporee', async () => {
        currentActor = territorialActor(
          'director-union',
          ['attendance:approve_late'],
          { union: { id: 1 } },
        );

        await expect(
          run('approvePayment', { camporeePaymentId: PAYMENT_UNION_1 }),
        ).resolves.toBe(true);
        await expect(
          run('approvePayment', { camporeePaymentId: PAYMENT_UNION_2 }),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
        await expect(
          run('rejectPayment', { camporeePaymentId: PAYMENT_UNION_2 }),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
      });
    });
  });
});

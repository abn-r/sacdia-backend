import {
  AUTHORIZATION_RESOURCE_KEY,
  PERMISSIONS_KEY,
} from '../common/decorators';
import { SKIP_PERMISSIONS_KEY } from '../common/decorators/skip-permissions.decorator';
import { ACTING_SCOPE_KEY } from '../auth/acting-for/acting-scope.decorator';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  AdminCoordinationController,
  CoordinationController,
} from './coordination.controller';
import { runGlobalRolesGuard } from '../common/guards/global-roles-guard.testing';
import { CoordinatorConsentPendingQueryDto } from './dto';

describe('CoordinationController metadata', () => {
  const handler = CoordinationController.prototype.getMyCoordinatorScope;

  it('skips PermissionsGuard for the self-scoped me/scope endpoint', () => {
    // Without this metadata the fail-closed PermissionsGuard answers
    // 500 GUARD_RBAC_MISCONFIGURATION.
    expect(Reflect.getMetadata(SKIP_PERMISSIONS_KEY, handler)).toBe(true);
  });

  it('does not require any RBAC permission or authorization resource', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toBeUndefined();
    expect(
      Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, handler),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, CoordinationController),
    ).toBeUndefined();
  });
});

describe('CoordinationController GET me/consent-pending', () => {
  const handler = CoordinationController.prototype.listMyPendingConsents;
  const COORDINATOR = '00000000-0000-4000-8000-000000000c01';

  it('requires consent:verify through PermissionsGuard, as a GLOBAL permission (coordinator roles carry it)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({
      permissions: ['consent:verify'],
      mode: 'all',
    });
    expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, handler)).toEqual({
      type: 'global',
    });
    expect(Reflect.getMetadata(SKIP_PERMISSIONS_KEY, handler)).toBeUndefined();
  });

  it('declares NO acting scope: guardians acting, teens and devices are denied by default', () => {
    expect(Reflect.getMetadata(ACTING_SCOPE_KEY, handler)).toBeUndefined();
    expect(
      Reflect.getMetadata(ACTING_SCOPE_KEY, CoordinationController),
    ).toBeUndefined();
  });

  it('hands the caller, the global roles the guard resolved and the page to the queue, and wraps the result', async () => {
    const queue = {
      listForCoordinator: jest.fn().mockResolvedValue({
        items: [],
        total: 0,
        limit: 10,
        offset: 20,
        by_section: [],
      }),
    };
    const controller = new CoordinationController({} as never, queue as never);
    const globalRoles = [
      { role_name: 'coordinator', permissions: ['consent:verify'] },
    ];

    const response = await controller.listMyPendingConsents(
      {
        user: { sub: COORDINATOR },
        authorization: { grants: { global_roles: globalRoles } },
      } as never,
      { limit: 10, offset: 20 },
    );

    expect(queue.listForCoordinator).toHaveBeenCalledWith(
      COORDINATOR,
      globalRoles,
      { limit: 10, offset: 20 },
    );
    expect(response).toEqual({
      status: 'success',
      data: { items: [], total: 0, limit: 10, offset: 20, by_section: [] },
    });
  });

  it('fails closed without a resolved authorization (no roles handed over) and applies the default page', async () => {
    const queue = { listForCoordinator: jest.fn().mockResolvedValue({}) };
    const controller = new CoordinationController({} as never, queue as never);

    await controller.listMyPendingConsents(
      { user: { sub: COORDINATOR } } as never,
      {},
    );

    expect(queue.listForCoordinator).toHaveBeenCalledWith(
      COORDINATOR,
      undefined,
      { limit: 50, offset: 0 },
    );
  });
});

describe('CoordinatorConsentPendingQueryDto', () => {
  const validate = (query: Record<string, unknown>) => {
    const dto = plainToInstance(CoordinatorConsentPendingQueryDto, query);
    return { dto, errors: validateSync(dto) };
  };

  it('accepts numeric strings (query params) and an empty query', () => {
    const { dto, errors } = validate({ limit: '100', offset: '0' });
    expect(errors).toEqual([]);
    expect(dto).toMatchObject({ limit: 100, offset: 0 });
    expect(validate({}).errors).toEqual([]);
  });

  it.each([
    ['limit above 100', { limit: '101' }],
    ['limit 0', { limit: '0' }],
    ['a negative offset', { offset: '-1' }],
    ['a non-integer limit', { limit: '2.5' }],
    ['a non-numeric offset', { offset: 'abc' }],
  ])('rejects %s', (_label, query) => {
    expect(validate(query).errors.length).toBeGreaterThan(0);
  });
});

describe('AdminCoordinationController route guards', () => {
  const proto = AdminCoordinationController.prototype;
  const run = (handler: (...args: never[]) => unknown, role: string) =>
    runGlobalRolesGuard(AdminCoordinationController, handler, [role]);
  const DENIED = 'GUARD_PERMISSION_DENIED';

  describe.each([
    ['POST local-fields/:id/zones', proto.createZone],
    ['PATCH zones/:zoneId', proto.updateZone],
    ['POST zones/:zoneId/districts/:districtId', proto.assignDistrictToZone],
    [
      'DELETE zones/:zoneId/districts/:districtId',
      proto.removeDistrictFromZone,
    ],
    ['POST local-fields/:id/assignments', proto.createAssignment],
    ['PATCH assignments/:assignmentId', proto.updateAssignment],
    ['POST local-fields/:id/backfill', proto.backfillLegacyAssignments],
  ])('%s', (_label, handler) => {
    it.each([
      'super-admin',
      'admin',
      'assistant-admin',
      'director-lf',
      'assistant-lf',
    ])('lets %s write', async (role) => {
      await expect(run(handler, role)).resolves.toBe(true);
    });

    it.each([
      'director-union',
      'assistant-union',
      'director-dia',
      'assistant-dia',
    ])('rejects %s with GUARD_PERMISSION_DENIED', async (role) => {
      await expect(run(handler, role)).resolves.toBe(DENIED);
    });
  });

  describe.each([
    ['GET local-fields/:id/zones', proto.listZones],
    ['GET local-fields/:id/assignments', proto.listAssignments],
  ])('%s', (_label, handler) => {
    it.each([
      'super-admin',
      'admin',
      'assistant-admin',
      'director-lf',
      'assistant-lf',
      'director-union',
      'assistant-union',
      'director-dia',
      'assistant-dia',
    ])('keeps reading open to %s', async (role) => {
      await expect(run(handler, role)).resolves.toBe(true);
    });
  });
});

import { join } from 'path';
import { TENANT_BINDING_ALLOWLIST } from './tenant-binding-allowlist';
import { TENANT_BODY_ALLOWLIST } from './tenant-body-allowlist';
import {
  findUnboundBodyTenantRoutes,
  findUnboundTenantRoutes,
  scanControllers,
} from './tenant-binding-inventory';

describe('tenant binding inventory', () => {
  const routes = scanControllers(join(__dirname, '..', '..'));
  const unbound = findUnboundTenantRoutes(routes);

  it('scans the controllers', () => {
    expect(routes.length).toBeGreaterThan(500);
    expect(routes).toContainEqual(
      expect.objectContaining({
        key: 'camporees/camporees.controller.ts PATCH /camporees/union/:camporeeId',
        resourceType: 'active_assignment',
        hasBind: true,
      }),
    );
  });

  it('requires bind on every global/user/active_assignment route with a tenant path param', () => {
    const missing = unbound.filter((key) => !(key in TENANT_BINDING_ALLOWLIST));

    expect(missing).toEqual([]);
  });

  it('has no stale allowlist entries', () => {
    const unboundSet = new Set(unbound);
    const stale = Object.keys(TENANT_BINDING_ALLOWLIST).filter(
      (key) => !unboundSet.has(key),
    );

    expect(stale).toEqual([]);
  });

  describe('body/query tenant ids', () => {
    const unboundBody = findUnboundBodyTenantRoutes(routes);

    it('detects tenant fields from inline params and DTOs', () => {
      expect(routes).toContainEqual(
        expect.objectContaining({
          key: 'admin/admin-geography.controller.ts GET /admin/unions',
          bodyTenantFields: ['divisionId'],
        }),
      );
    });

    it('body tenant routes are all allowlisted', () => {
      const missing = unboundBody.filter(
        (key) => !(key in TENANT_BODY_ALLOWLIST),
      );

      expect(missing).toEqual([]);
    });

    it('no stale body allowlist entries', () => {
      const unboundSet = new Set(unboundBody);
      const stale = Object.keys(TENANT_BODY_ALLOWLIST).filter(
        (key) => !unboundSet.has(key),
      );

      expect(stale).toEqual([]);
    });
  });
});

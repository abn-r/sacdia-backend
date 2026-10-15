import {
  AUTHORIZATION_RESOURCE_KEY,
  PERMISSIONS_KEY,
} from '../common/decorators';
import { SKIP_PERMISSIONS_KEY } from '../common/decorators/skip-permissions.decorator';
import { CoordinationController } from './coordination.controller';

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

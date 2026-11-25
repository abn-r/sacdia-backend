import {
  AUTHORIZATION_RESOURCE_KEY,
  PERMISSIONS_KEY,
} from '../common/decorators';
import { SupervisionController } from './supervision.controller';

describe('SupervisionController', () => {
  const proto = SupervisionController.prototype;

  it('declares the any-of permissions and a global resource on pending-counts', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      proto.getPendingCounts,
    );
    expect(permissions.permissions).toEqual([
      'club_enrollments:validate',
      'annual_folders:evaluate',
      'requests:review',
      'attendance:approve_late',
    ]);
    expect(permissions.mode).toBe('any');
    expect(
      Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, proto.getPendingCounts),
    ).toEqual({ type: 'global' });
  });

  it('wraps the aggregate in the success envelope using the caller id', async () => {
    const data = {
      territory_level: 'union',
      counts: {
        club_enrollments: 1,
        annual_folders: null,
        union_camporee_registrations: 2,
        transfers: 0,
        role_assignments: 0,
      },
    };
    const service = { getPendingCounts: jest.fn().mockResolvedValue(data) };
    const controller = new SupervisionController(service as never);

    await expect(
      controller.getPendingCounts({ sub: 'user-1' }),
    ).resolves.toEqual({ status: 'success', data });
    expect(service.getPendingCounts).toHaveBeenCalledWith('user-1');
  });
});

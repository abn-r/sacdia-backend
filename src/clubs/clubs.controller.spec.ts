import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { ClubsController } from './clubs.controller';

describe('ClubsController.getAssignableRoles', () => {
  it('delegates to ClubsService with route params', async () => {
    const getAssignableRoles = jest.fn().mockResolvedValue({ roles: [] });
    const controller = new ClubsController(
      { getAssignableRoles } as never,
      {} as never,
    );

    await expect(controller.getAssignableRoles(10, 7, 'u1')).resolves.toEqual({
      roles: [],
    });
    expect(getAssignableRoles).toHaveBeenCalledWith(10, 7, 'u1');
  });

  it('requires club_roles:read', () => {
    const meta = Reflect.getMetadata(
      PERMISSIONS_KEY,
      ClubsController.prototype.getAssignableRoles,
    );
    expect(meta).toEqual({ permissions: ['club_roles:read'], mode: 'all' });
  });
});

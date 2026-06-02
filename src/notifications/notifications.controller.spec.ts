import {
  AUTHORIZATION_RESOURCE_KEY,
  PERMISSIONS_KEY,
} from '../common/decorators';
import { NotificationsController } from './notifications.controller';

describe('NotificationsController metadata', () => {
  it('allows authenticated users to read their inbox history without notifications:send', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        NotificationsController.prototype.getHistory,
      ),
    ).toBeUndefined();
  });

  it('requires notifications:club permission for club target discovery endpoint', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        NotificationsController.prototype.getAuthorizedClubTargets,
      ),
    ).toEqual({
      mode: 'all',
      permissions: ['notifications:club'],
    });
  });

  it('scopes club target discovery to the active assignment resource', () => {
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        NotificationsController.prototype.getAuthorizedClubTargets,
      ),
    ).toEqual({ type: 'active_assignment' });
  });
});

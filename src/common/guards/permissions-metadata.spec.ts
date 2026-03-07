import { ActivitiesController } from '../../activities/activities.controller';
import { AdminGeographyController } from '../../admin/admin-geography.controller';
import { AdminReferenceController } from '../../admin/admin-reference.controller';
import { AUTHORIZATION_RESOURCE_KEY } from '../decorators/authorization-resource.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AdminUsersController } from '../../admin/admin-users.controller';
import { ClubRolesController } from '../../clubs/clubs.controller';
import { FinancesController } from '../../finances/finances.controller';
import { InventoryController } from '../../inventory/inventory.controller';
import { NotificationsController } from '../../notifications/notifications.controller';
import { RbacController } from '../../rbac/rbac.controller';
import { UsersController } from '../../users/users.controller';

describe('Permissions metadata', () => {
  it('marks admin users listing with users:read', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, AdminUsersController.prototype.listUsers),
    ).toEqual({ permissions: ['users:read'], mode: 'all' });
  });

  it('marks user detail routes as owner-aware user resources', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, UsersController.prototype.findOne),
    ).toEqual({ permissions: ['users:read_detail'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UsersController.prototype.findOne,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
  });

  it('marks inventory creation as instance-scoped inventory permission', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, InventoryController.prototype.create),
    ).toEqual({ permissions: ['inventory:create'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        InventoryController.prototype.create,
      ),
    ).toEqual({
      type: 'inventory_instance',
      idParam: 'clubId',
      instanceTypeSource: 'body',
      instanceTypeField: 'instanceType',
    });
  });

  it('marks club assignment mutations with assignment-scoped permissions', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        ClubRolesController.prototype.updateAssignment,
      ),
    ).toEqual({ permissions: ['club_roles:assign'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        ClubRolesController.prototype.updateAssignment,
      ),
    ).toEqual({ type: 'club_assignment', idParam: 'assignmentId' });
  });

  it('marks geography admin reads with explicit country permissions', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminGeographyController.prototype.listCountries,
      ),
    ).toEqual({ permissions: ['countries:read'], mode: 'all' });
  });

  it('marks reference admin writes with catalogs permissions', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminReferenceController.prototype.createAllergy,
      ),
    ).toEqual({ permissions: ['catalogs:create'], mode: 'all' });
  });

  it('marks RBAC endpoints with explicit permission permissions', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        RbacController.prototype.listPermissions,
      ),
    ).toEqual({ permissions: ['permissions:read'], mode: 'all' });
  });

  it('marks direct notifications with explicit send permissions', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        NotificationsController.prototype.sendToUser,
      ),
    ).toEqual({ permissions: ['notifications:send'], mode: 'all' });
  });

  it('marks activity updates as activity-scoped permissions', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        ActivitiesController.prototype.update,
      ),
    ).toEqual({ permissions: ['activities:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        ActivitiesController.prototype.update,
      ),
    ).toEqual({ type: 'activity', idParam: 'activityId' });
  });

  it('marks finance updates as finance-scoped permissions', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        FinancesController.prototype.update,
      ),
    ).toEqual({ permissions: ['finances:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        FinancesController.prototype.update,
      ),
    ).toEqual({ type: 'finance', idParam: 'financeId' });
  });
});

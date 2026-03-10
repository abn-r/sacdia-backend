/* eslint-disable @typescript-eslint/unbound-method */

import { ActivitiesController } from '../../activities/activities.controller';
import { AdminGeographyController } from '../../admin/admin-geography.controller';
import { AdminReferenceController } from '../../admin/admin-reference.controller';
import { AUTHORIZATION_RESOURCE_KEY } from '../decorators/authorization-resource.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { CLUB_ROLES_KEY } from '../guards/club-roles.guard';
import { AdminUsersController } from '../../admin/admin-users.controller';
import {
  ClubsController,
  ClubRolesController,
} from '../../clubs/clubs.controller';
import { CamporeesController } from '../../camporees/camporees.controller';
import { FinancesController } from '../../finances/finances.controller';
import { InventoryController } from '../../inventory/inventory.controller';
import { EmergencyContactsController } from '../../emergency-contacts/emergency-contacts.controller';
import { LegalRepresentativesController } from '../../legal-representatives/legal-representatives.controller';
import { NotificationsController } from '../../notifications/notifications.controller';
import { PostRegistrationController } from '../../post-registration/post-registration.controller';
import { RbacController } from '../../rbac/rbac.controller';
import { UsersController } from '../../users/users.controller';

describe('Permissions metadata', () => {
  it('marks admin users listing with users:read', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminUsersController.prototype.listUsers,
      ),
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

  it('marks user health read routes as owner-aware detail reads', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.getAllergies,
      ),
    ).toEqual({ permissions: ['users:read_detail'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UsersController.prototype.getAllergies,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.getDiseases,
      ),
    ).toEqual({ permissions: ['users:read_detail'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UsersController.prototype.getDiseases,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.getMedicines,
      ),
    ).toEqual({ permissions: ['users:read_detail'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UsersController.prototype.getMedicines,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
  });

  it('marks sensitive user profile writes as owner-aware updates', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.updateAllergies,
      ),
    ).toEqual({ permissions: ['users:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UsersController.prototype.updateAllergies,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.updateDiseases,
      ),
    ).toEqual({ permissions: ['users:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UsersController.prototype.updateDiseases,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.updateMedicines,
      ),
    ).toEqual({ permissions: ['users:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UsersController.prototype.updateMedicines,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.removeMedicine,
      ),
    ).toEqual({ permissions: ['users:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UsersController.prototype.removeMedicine,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.uploadProfilePicture,
      ),
    ).toEqual({ permissions: ['users:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UsersController.prototype.uploadProfilePicture,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
  });

  it('marks derived user health checks as owner-aware detail reads', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, UsersController.prototype.getAge),
    ).toEqual({ permissions: ['users:read_detail'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UsersController.prototype.getAge,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.requiresLegalRepresentative,
      ),
    ).toEqual({ permissions: ['users:read_detail'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UsersController.prototype.requiresLegalRepresentative,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
  });

  it('marks emergency contact routes as owner-aware sensitive user resources', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        EmergencyContactsController.prototype.findAll,
      ),
    ).toEqual({ permissions: ['users:read_detail'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        EmergencyContactsController.prototype.findAll,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        EmergencyContactsController.prototype.create,
      ),
    ).toEqual({ permissions: ['users:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        EmergencyContactsController.prototype.create,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        EmergencyContactsController.prototype.update,
      ),
    ).toEqual({ permissions: ['users:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        EmergencyContactsController.prototype.update,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
  });

  it('marks legal representative routes as owner-aware sensitive user resources', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        LegalRepresentativesController.prototype.findOne,
      ),
    ).toEqual({ permissions: ['users:read_detail'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        LegalRepresentativesController.prototype.findOne,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        LegalRepresentativesController.prototype.create,
      ),
    ).toEqual({ permissions: ['users:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        LegalRepresentativesController.prototype.create,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        LegalRepresentativesController.prototype.update,
      ),
    ).toEqual({ permissions: ['users:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        LegalRepresentativesController.prototype.update,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
  });

  it('marks inventory creation as instance-scoped inventory permission', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        InventoryController.prototype.create,
      ),
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

  it('keeps club role assignment creation free from legacy club role metadata', () => {
    expect(
      Reflect.getMetadata(
        CLUB_ROLES_KEY,
        ClubRolesController.prototype.updateAssignment,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(CLUB_ROLES_KEY, ClubsController.prototype.assignRole),
    ).toBeUndefined();
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
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminReferenceController.prototype.listMedicines,
      ),
    ).toEqual({ permissions: ['catalogs:read'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminReferenceController.prototype.createMedicine,
      ),
    ).toEqual({ permissions: ['catalogs:create'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminReferenceController.prototype.updateMedicine,
      ),
    ).toEqual({ permissions: ['catalogs:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminReferenceController.prototype.deleteMedicine,
      ),
    ).toEqual({ permissions: ['catalogs:delete'], mode: 'all' });
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

  it('marks notification variants with explicit broadcast and club permissions', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        NotificationsController.prototype.broadcast,
      ),
    ).toEqual({ permissions: ['notifications:broadcast'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        NotificationsController.prototype.sendToClub,
      ),
    ).toEqual({ permissions: ['notifications:club'], mode: 'all' });
  });

  it('keeps post-registration permissions on users:* without inventing new permissions', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        PostRegistrationController.prototype.getStatus,
      ),
    ).toEqual({ permissions: ['users:read_detail'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        PostRegistrationController.prototype.getStatus,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        PostRegistrationController.prototype.completeStep1,
      ),
    ).toEqual({ permissions: ['users:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        PostRegistrationController.prototype.completeStep1,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        PostRegistrationController.prototype.completeStep2,
      ),
    ).toEqual({ permissions: ['users:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        PostRegistrationController.prototype.completeStep2,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        PostRegistrationController.prototype.completeStep3,
      ),
    ).toEqual({ permissions: ['users:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        PostRegistrationController.prototype.completeStep3,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
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

  it('marks camporee creation with active-assignment scoped activity permissions', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        CamporeesController.prototype.create,
      ),
    ).toEqual({ permissions: ['activities:create'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        CamporeesController.prototype.create,
      ),
    ).toEqual({ type: 'active_assignment' });
  });

  it('marks finance updates as finance-scoped permissions', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, FinancesController.prototype.update),
    ).toEqual({ permissions: ['finances:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        FinancesController.prototype.update,
      ),
    ).toEqual({ type: 'finance', idParam: 'financeId' });
  });
});

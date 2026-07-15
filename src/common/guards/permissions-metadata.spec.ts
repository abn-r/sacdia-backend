import { ActivitiesController } from '../../activities/activities.controller';
import { AdminGeographyController } from '../../admin/admin-geography.controller';
import { AdminReferenceController } from '../../admin/admin-reference.controller';
import { UserClassesController } from '../../classes/classes.controller';
import { UserCertificationsController } from '../../certifications/certifications.controller';
import {
  getSensitiveUserSubresourceFallbackPermission,
  type SensitiveUserSubresourceFamily,
} from './sensitive-user-subresource-policy';
import {
  SENSITIVE_USER_SUBRESOURCE_KEY,
  SensitiveUserSubresource,
} from '../decorators/sensitive-user-subresource.decorator';
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
import { InvestitureController } from '../../investiture/investiture.controller';
import { RankingsController } from '../../annual-folders/rankings.controller';
import { EmergencyContactsController } from '../../emergency-contacts/emergency-contacts.controller';
import { LegalRepresentativesController } from '../../legal-representatives/legal-representatives.controller';
import { NotificationsController } from '../../notifications/notifications.controller';
import { PostRegistrationController } from '../../post-registration/post-registration.controller';
import { RbacController } from '../../rbac/rbac.controller';
import { MemberRankingsController } from '../../rankings/member-rankings/member-rankings.controller';
import { SectionRankingsController } from '../../rankings/section-rankings/section-rankings.controller';
import { UsersController } from '../../users/users.controller';

class SensitiveUserSubresourceMetadataFixture {
  @SensitiveUserSubresource('health', 'read')
  healthRead() {}

  @SensitiveUserSubresource('health', 'update')
  healthUpdate() {}

  @SensitiveUserSubresource('emergency_contacts', 'read')
  emergencyContactsRead() {}

  @SensitiveUserSubresource('emergency_contacts', 'update')
  emergencyContactsUpdate() {}

  @SensitiveUserSubresource('legal_representative', 'read')
  legalRepresentativeRead() {}

  @SensitiveUserSubresource('legal_representative', 'update')
  legalRepresentativeUpdate() {}

  @SensitiveUserSubresource('post_registration', 'read')
  postRegistrationRead() {}

  @SensitiveUserSubresource('post_registration', 'update')
  postRegistrationUpdate() {}
}

describe('Permissions metadata', () => {
  it('marks admin overdue expiration as a global permission resource', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        InvestitureController.prototype.expireOverdueEnrollments,
      ),
    ).toEqual({ permissions: ['catalogs:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        InvestitureController.prototype.expireOverdueEnrollments,
      ),
    ).toEqual({ type: 'global' });
  });

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

  it('marks class progress write routes as owner-aware active assignment resources', () => {
    for (const handler of [
      UserClassesController.prototype.updateProgress,
      UserClassesController.prototype.submitSection,
      UserClassesController.prototype.uploadSectionFile,
      UserClassesController.prototype.deleteSectionFile,
    ]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({
        permissions: ['classes:submit_progress'],
        mode: 'all',
      });
      expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, handler)).toEqual({
        type: 'active_assignment',
        ownerParam: 'userId',
      });
    }
  });

  it('marks user health read routes as owner-aware health reads', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.getAllergies,
      ),
    ).toEqual({ permissions: ['health:read'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UsersController.prototype.getAllergies,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        UsersController.prototype.getAllergies,
      ),
    ).toEqual({ family: 'health', mode: 'read' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.getDiseases,
      ),
    ).toEqual({ permissions: ['health:read'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UsersController.prototype.getDiseases,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        UsersController.prototype.getDiseases,
      ),
    ).toEqual({ family: 'health', mode: 'read' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.getMedicines,
      ),
    ).toEqual({ permissions: ['health:read'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UsersController.prototype.getMedicines,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        UsersController.prototype.getMedicines,
      ),
    ).toEqual({ family: 'health', mode: 'read' });
  });

  it('marks scoped user health writes as owner-aware health updates', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.updateAllergies,
      ),
    ).toEqual({ permissions: ['health:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UsersController.prototype.updateAllergies,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        UsersController.prototype.updateAllergies,
      ),
    ).toEqual({ family: 'health', mode: 'update' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.updateDiseases,
      ),
    ).toEqual({ permissions: ['health:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UsersController.prototype.updateDiseases,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        UsersController.prototype.updateDiseases,
      ),
    ).toEqual({ family: 'health', mode: 'update' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.updateMedicines,
      ),
    ).toEqual({ permissions: ['health:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UsersController.prototype.updateMedicines,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        UsersController.prototype.updateMedicines,
      ),
    ).toEqual({ family: 'health', mode: 'update' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.removeAllergy,
      ),
    ).toEqual({ permissions: ['health:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UsersController.prototype.removeAllergy,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        UsersController.prototype.removeAllergy,
      ),
    ).toEqual({ family: 'health', mode: 'update' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.removeDisease,
      ),
    ).toEqual({ permissions: ['health:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UsersController.prototype.removeDisease,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        UsersController.prototype.removeDisease,
      ),
    ).toEqual({ family: 'health', mode: 'update' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.removeMedicine,
      ),
    ).toEqual({ permissions: ['health:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UsersController.prototype.removeMedicine,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        UsersController.prototype.removeMedicine,
      ),
    ).toEqual({ family: 'health', mode: 'update' });
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

  it.each([
    [
      SensitiveUserSubresourceMetadataFixture.prototype.healthRead,
      'health:read',
      { family: 'health', mode: 'read' },
    ],
    [
      SensitiveUserSubresourceMetadataFixture.prototype.healthUpdate,
      'health:update',
      { family: 'health', mode: 'update' },
    ],
    [
      SensitiveUserSubresourceMetadataFixture.prototype.emergencyContactsRead,
      'emergency_contacts:read',
      { family: 'emergency_contacts', mode: 'read' },
    ],
    [
      SensitiveUserSubresourceMetadataFixture.prototype.emergencyContactsUpdate,
      'emergency_contacts:update',
      { family: 'emergency_contacts', mode: 'update' },
    ],
    [
      SensitiveUserSubresourceMetadataFixture.prototype.legalRepresentativeRead,
      'legal_representative:read',
      { family: 'legal_representative', mode: 'read' },
    ],
    [
      SensitiveUserSubresourceMetadataFixture.prototype
        .legalRepresentativeUpdate,
      'legal_representative:update',
      { family: 'legal_representative', mode: 'update' },
    ],
    [
      SensitiveUserSubresourceMetadataFixture.prototype.postRegistrationRead,
      'post_registration:read',
      { family: 'post_registration', mode: 'read' },
    ],
    [
      SensitiveUserSubresourceMetadataFixture.prototype.postRegistrationUpdate,
      'post_registration:update',
      { family: 'post_registration', mode: 'update' },
    ],
  ] as const)(
    'sets fine-grained metadata for sensitive user subresources on %p',
    (handler, permission, subresourceMetadata) => {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({
        permissions: [permission],
        mode: 'all',
      });
      expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, handler)).toEqual({
        type: 'user',
        ownerParam: 'userId',
      });
      expect(
        Reflect.getMetadata(SENSITIVE_USER_SUBRESOURCE_KEY, handler),
      ).toEqual(subresourceMetadata);
    },
  );

  it('marks emergency contact routes as owner-aware sensitive user resources', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        EmergencyContactsController.prototype.findAll,
      ),
    ).toEqual({ permissions: ['emergency_contacts:read'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        EmergencyContactsController.prototype.findAll,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        EmergencyContactsController.prototype.findAll,
      ),
    ).toEqual({ family: 'emergency_contacts', mode: 'read' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        EmergencyContactsController.prototype.findOne,
      ),
    ).toEqual({ permissions: ['emergency_contacts:read'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        EmergencyContactsController.prototype.findOne,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        EmergencyContactsController.prototype.findOne,
      ),
    ).toEqual({ family: 'emergency_contacts', mode: 'read' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        EmergencyContactsController.prototype.create,
      ),
    ).toEqual({ permissions: ['emergency_contacts:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        EmergencyContactsController.prototype.create,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        EmergencyContactsController.prototype.create,
      ),
    ).toEqual({ family: 'emergency_contacts', mode: 'update' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        EmergencyContactsController.prototype.update,
      ),
    ).toEqual({ permissions: ['emergency_contacts:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        EmergencyContactsController.prototype.update,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        EmergencyContactsController.prototype.update,
      ),
    ).toEqual({ family: 'emergency_contacts', mode: 'update' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        EmergencyContactsController.prototype.remove,
      ),
    ).toEqual({ permissions: ['emergency_contacts:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        EmergencyContactsController.prototype.remove,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        EmergencyContactsController.prototype.remove,
      ),
    ).toEqual({ family: 'emergency_contacts', mode: 'update' });
  });

  it('marks legal representative routes as owner-aware sensitive user resources', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        LegalRepresentativesController.prototype.findOne,
      ),
    ).toEqual({ permissions: ['legal_representative:read'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        LegalRepresentativesController.prototype.findOne,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        LegalRepresentativesController.prototype.findOne,
      ),
    ).toEqual({ family: 'legal_representative', mode: 'read' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        LegalRepresentativesController.prototype.create,
      ),
    ).toEqual({ permissions: ['legal_representative:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        LegalRepresentativesController.prototype.create,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        LegalRepresentativesController.prototype.create,
      ),
    ).toEqual({ family: 'legal_representative', mode: 'update' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        LegalRepresentativesController.prototype.update,
      ),
    ).toEqual({ permissions: ['legal_representative:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        LegalRepresentativesController.prototype.update,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        LegalRepresentativesController.prototype.update,
      ),
    ).toEqual({ family: 'legal_representative', mode: 'update' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        LegalRepresentativesController.prototype.remove,
      ),
    ).toEqual({ permissions: ['legal_representative:update'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        LegalRepresentativesController.prototype.remove,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        LegalRepresentativesController.prototype.remove,
      ),
    ).toEqual({ family: 'legal_representative', mode: 'update' });
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

  it('marks post-registration routes as owner-aware sensitive user resources', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        PostRegistrationController.prototype.getStatus,
      ),
    ).toEqual({ permissions: ['post_registration:read'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        PostRegistrationController.prototype.getStatus,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        PostRegistrationController.prototype.getStatus,
      ),
    ).toEqual({ family: 'post_registration', mode: 'read' });

    // step-1/2/3 complete: use registration:complete directly (no sensitive subresource
    // fallback) so that users:update does NOT grant third-party access to these endpoints.
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        PostRegistrationController.prototype.completeStep1,
      ),
    ).toEqual({ permissions: ['registration:complete'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        PostRegistrationController.prototype.completeStep1,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        PostRegistrationController.prototype.completeStep1,
      ),
    ).toBeUndefined();

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        PostRegistrationController.prototype.completeStep2,
      ),
    ).toEqual({ permissions: ['registration:complete'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        PostRegistrationController.prototype.completeStep2,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        PostRegistrationController.prototype.completeStep2,
      ),
    ).toBeUndefined();

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        PostRegistrationController.prototype.completeStep3,
      ),
    ).toEqual({ permissions: ['registration:complete'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        PostRegistrationController.prototype.completeStep3,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        PostRegistrationController.prototype.completeStep3,
      ),
    ).toBeUndefined();
  });

  it('uses users:update_profile on self-service user routes', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, UsersController.prototype.update),
    ).toEqual({ permissions: ['users:update_profile'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.uploadProfilePicture,
      ),
    ).toEqual({ permissions: ['users:update_profile'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.deleteProfilePicture,
      ),
    ).toEqual({ permissions: ['users:update_profile'], mode: 'all' });
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, UsersController.prototype.getAge),
    ).toEqual({ permissions: ['users:read_detail'], mode: 'all' });
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
    ).toEqual({ permissions: ['camporees:create'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        CamporeesController.prototype.create,
      ),
    ).toEqual({ type: 'active_assignment' });
  });

  it('marks active section registration routes with camporee-scoped permissions', () => {
    const getHandler = (
      CamporeesController.prototype as unknown as Record<string, object>
    ).getActiveSectionRegistration;
    const postHandler = (
      CamporeesController.prototype as unknown as Record<string, object>
    ).registerActiveSection;

    expect(getHandler).toBeDefined();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, getHandler)).toEqual({
      permissions: ['camporees:read'],
      mode: 'all',
    });
    expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, getHandler)).toEqual(
      { type: 'camporee', idParam: 'camporeeId' },
    );

    expect(postHandler).toBeDefined();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, postHandler)).toEqual({
      permissions: ['camporees:register_active_section'],
      mode: 'all',
    });
    expect(
      Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, postHandler),
    ).toEqual({ type: 'camporee', idParam: 'camporeeId' });
  });

  it('separates legacy organizer enrollment from contextual director registration', () => {
    const legacyHandler = CamporeesController.prototype.enrollClub;
    const contextualHandler =
      CamporeesController.prototype.registerActiveSection;

    expect(Reflect.getMetadata(PERMISSIONS_KEY, legacyHandler)).toEqual({
      permissions: ['camporees:register'],
      mode: 'all',
    });
    expect(
      Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, legacyHandler),
    ).toEqual({ type: 'camporee', idParam: 'camporeeId' });

    expect(Reflect.getMetadata(PERMISSIONS_KEY, contextualHandler)).toEqual({
      permissions: ['camporees:register_active_section'],
      mode: 'all',
    });
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

  it('marks ranking controllers as active-assignment resources so club role permissions can pass the guard', () => {
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        SectionRankingsController,
      ),
    ).toEqual({ type: 'active_assignment' });
    expect(
      Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, MemberRankingsController),
    ).toEqual({ type: 'active_assignment' });
  });

  it('marks annual ranking list as active-assignment scoped while keeping detail/recalculate globally scoped', () => {
    expect(
      Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, RankingsController),
    ).toEqual({ type: 'global' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        RankingsController.prototype.getRankings,
      ),
    ).toEqual({ type: 'active_assignment' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        RankingsController.prototype.getRankingForClub,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        RankingsController.prototype.recalculate,
      ),
    ).toBeUndefined();
  });

  // ==========================================================================
  // Phase 3 cleanup (`permission-scope-cleanup-phase-3`):
  // certifications enrollment / progress / abandon endpoints MUST require
  // `user_certifications:manage` instead of retired broad user permissions.
  // ==========================================================================

  it('marks certification enroll/update/delete as user_certifications:manage (Phase 3 cleanup)', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UserCertificationsController.prototype.enrollUser,
      ),
    ).toEqual({ permissions: ['user_certifications:manage'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UserCertificationsController.prototype.enrollUser,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UserCertificationsController.prototype.updateProgress,
      ),
    ).toEqual({ permissions: ['user_certifications:manage'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UserCertificationsController.prototype.updateProgress,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UserCertificationsController.prototype.deleteCertification,
      ),
    ).toEqual({ permissions: ['user_certifications:manage'], mode: 'all' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UserCertificationsController.prototype.deleteCertification,
      ),
    ).toEqual({ type: 'user', ownerParam: 'userId' });
  });

  it('resolves sensitive-user-subresource update mode to users:update_profile (Phase 3 cleanup)', () => {
    const families: SensitiveUserSubresourceFamily[] = [
      'health',
      'emergency_contacts',
      'legal_representative',
      'post_registration',
    ];
    for (const family of families) {
      expect(
        getSensitiveUserSubresourceFallbackPermission(family, 'update'),
      ).toBe('users:update_profile');
      expect(
        getSensitiveUserSubresourceFallbackPermission(family, 'read'),
      ).toBe('users:read_detail');
    }
  });
});

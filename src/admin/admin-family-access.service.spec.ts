import { AdminFamilyAccessService } from './admin-family-access.service';

const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001';
const TEEN = 'bbbbbbbb-0000-4000-8000-000000000001';
const DEVICE = 'cccccccc-0000-4000-8000-000000000001';

describe('AdminFamilyAccessService', () => {
  let order: string[];
  let adminUsers: { assertUserInActorScope: jest.Mock };
  let supervisedLogins: { disableAsAdmin: jest.Mock };
  let linkedDevices: { revokeAsAdmin: jest.Mock };
  let service: AdminFamilyAccessService;

  beforeEach(() => {
    order = [];
    adminUsers = {
      assertUserInActorScope: jest.fn(() => {
        order.push('scope');
        return Promise.resolve();
      }),
    };
    supervisedLogins = {
      disableAsAdmin: jest.fn(() => {
        order.push('disable');
        return Promise.resolve({
          supervised_login: {
            method: 'handle',
            login_handle: 'ana-7kq4m9xz',
            email: 'secret@example.org',
            origin: 'guardian_enabled',
            enabled_at: '2026-10-10T10:00:00.000Z',
            disabled_at: '2026-10-20T10:00:00.000Z',
            disabled_reason: 'admin',
            password_set_by: 'guardian',
          },
        });
      }),
    };
    linkedDevices = {
      revokeAsAdmin: jest.fn(() => {
        order.push('revoke');
        return Promise.resolve({
          linked_device_id: DEVICE,
          revoked_at: '2026-10-20T10:00:00.000Z',
          revoked_reason: 'admin',
        });
      }),
    };
    service = new AdminFamilyAccessService(
      adminUsers as never,
      supervisedLogins as never,
      linkedDevices as never,
    );
  });

  describe('disableSupervisedLogin', () => {
    it('checks the actor territory BEFORE cutting anything, then disables with the typed reason', async () => {
      await service.disableSupervisedLogin(ADMIN, TEEN, 'Solicitud del tutor');

      expect(order).toEqual(['scope', 'disable']);
      expect(adminUsers.assertUserInActorScope).toHaveBeenCalledWith(
        ADMIN,
        TEEN,
      );
      expect(supervisedLogins.disableAsAdmin).toHaveBeenCalledWith(
        ADMIN,
        TEEN,
        'Solicitud del tutor',
      );
    });

    it('answers a status "disabled" and NEVER the handle or the email', async () => {
      const result = await service.disableSupervisedLogin(
        ADMIN,
        TEEN,
        'Solicitud del tutor',
      );

      expect(result).toEqual({
        supervised_login: {
          status: 'disabled',
          method: 'handle',
          origin: 'guardian_enabled',
          enabled_at: '2026-10-10T10:00:00.000Z',
          disabled_at: '2026-10-20T10:00:00.000Z',
          disabled_reason: 'admin',
          password_set_by: 'guardian',
        },
      });
      expect(JSON.stringify(result)).not.toContain('ana-7kq4m9xz');
      expect(JSON.stringify(result)).not.toContain('secret@example.org');
    });

    it('does not touch the login when the user is outside the actor scope', async () => {
      adminUsers.assertUserInActorScope.mockRejectedValue(
        new Error('out of scope'),
      );

      await expect(
        service.disableSupervisedLogin(ADMIN, TEEN, 'Solicitud del tutor'),
      ).rejects.toThrow('out of scope');
      expect(supervisedLogins.disableAsAdmin).not.toHaveBeenCalled();
    });
  });

  describe('revokeLinkedDevice', () => {
    it('checks the territory, then revokes with the admin as actor and the typed reason', async () => {
      const result = await service.revokeLinkedDevice(
        ADMIN,
        TEEN,
        DEVICE,
        'Teléfono extraviado',
      );

      expect(order).toEqual(['scope', 'revoke']);
      expect(linkedDevices.revokeAsAdmin).toHaveBeenCalledWith(
        ADMIN,
        TEEN,
        DEVICE,
        'Teléfono extraviado',
      );
      expect(result).toEqual({
        linked_device_id: DEVICE,
        revoked_at: '2026-10-20T10:00:00.000Z',
        revoked_reason: 'admin',
      });
    });

    it('does not revoke when the user is outside the actor scope', async () => {
      adminUsers.assertUserInActorScope.mockRejectedValue(
        new Error('out of scope'),
      );

      await expect(
        service.revokeLinkedDevice(ADMIN, TEEN, DEVICE, 'Teléfono extraviado'),
      ).rejects.toThrow('out of scope');
      expect(linkedDevices.revokeAsAdmin).not.toHaveBeenCalled();
    });
  });
});

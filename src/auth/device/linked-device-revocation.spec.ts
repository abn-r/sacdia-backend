import { Logger } from '@nestjs/common';
import { LinkedDeviceRevocation } from './linked-device-revocation';

const CHILD = '11111111-1111-4111-8111-111111111111';
const GUARDIAN = '99999999-9999-4999-8999-999999999999';

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    linked_device_id: id,
    dependent_user_id: CHILD,
    guardianship_id: 'g-1',
    paired_by_user_id: GUARDIAN,
    session_id: `sid-${id}`,
    label: `Tablet ${id}`,
    platform: 'android',
    fcm_token_id: `fcm-${id}`,
    ...over,
  };
}

describe('LinkedDeviceRevocation', () => {
  let tx: {
    linked_devices: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
    session: { deleteMany: jest.Mock; findMany: jest.Mock };
    user_fcm_tokens: { updateMany: jest.Mock };
    audit_logs: { create: jest.Mock };
  };
  let prisma: Record<string, any>;
  let cache: { bump: jest.Mock };
  let service: LinkedDeviceRevocation;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    tx = {
      linked_devices: {
        findMany: jest.fn().mockResolvedValue([row('d1')]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(1),
      },
      session: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user_fcm_tokens: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      audit_logs: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
      linked_devices: { findMany: jest.fn() },
      session: { findMany: jest.fn() },
    };
    cache = { bump: jest.fn().mockResolvedValue(undefined) };
    service = new LinkedDeviceRevocation(prisma as never, cache as never);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('revokeInTx', () => {
    it('only looks at ACTIVE devices of the filter', async () => {
      await service.revokeInTx(
        tx as never,
        { dependent_user_id: CHILD },
        { by: GUARDIAN, reason: 'guardian' },
      );

      expect(tx.linked_devices.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { dependent_user_id: CHILD, revoked_at: null },
        }),
      );
    });

    it('sets who/when/why with a compare-and-set on revoked_at, deletes the session, deactivates the token and audits', async () => {
      const revoked = await service.revokeInTx(
        tx as never,
        { linked_device_id: 'd1' },
        { by: GUARDIAN, reason: 'guardian' },
      );

      expect(tx.linked_devices.updateMany).toHaveBeenCalledWith({
        where: { linked_device_id: 'd1', revoked_at: null },
        data: {
          revoked_at: expect.any(Date),
          revoked_by_user_id: GUARDIAN,
          revoked_reason: 'guardian',
        },
      });
      expect(tx.session.deleteMany).toHaveBeenCalledWith({
        where: { id: 'sid-d1' },
      });
      expect(revoked).toEqual([
        expect.objectContaining({
          linkedDeviceId: 'd1',
          dependentUserId: CHILD,
          label: 'Tablet d1',
        }),
      ]);
      expect(tx.audit_logs.create).toHaveBeenCalledTimes(1);
      expect(tx.audit_logs.create.mock.calls[0][0].data).toMatchObject({
        entity_type: 'linked_device',
        entity_id: 'd1',
        action: 'linked_device.revoked',
        actor_user_id: GUARDIAN,
        actor_kind: 'user',
        target_user_id: CHILD,
        changes: { reason: 'guardian' },
      });
    });

    it('deactivates ONLY the token the device registered, and only while it still belongs to the child', async () => {
      await service.revokeInTx(
        tx as never,
        { linked_device_id: 'd1' },
        { by: null, reason: 'admin' },
      );

      expect(tx.user_fcm_tokens.updateMany).toHaveBeenCalledWith({
        where: { fcm_token_id: 'fcm-d1', user_id: CHILD },
        data: { active: false },
      });
    });

    it('an ADMIN revoke with a reason writes ONE admin.linked_device.revoked row that stores the free-text reason', async () => {
      await service.revokeInTx(
        tx as never,
        { linked_device_id: 'd1' },
        {
          by: GUARDIAN,
          reason: 'admin',
          adminReason: 'Solicitud del tutor legal',
        },
      );

      expect(tx.audit_logs.create).toHaveBeenCalledTimes(1);
      expect(tx.audit_logs.create.mock.calls[0][0].data).toMatchObject({
        action: 'admin.linked_device.revoked',
        actor_user_id: GUARDIAN,
        actor_kind: 'user',
        target_user_id: CHILD,
        changes: {
          reason: 'Solicitud del tutor legal',
          revoked_reason: 'admin',
          label: 'Tablet d1',
          platform: 'android',
        },
      });
      // The vocabulary column still says 'admin', never the free text.
      expect(tx.linked_devices.updateMany.mock.calls[0][0].data).toMatchObject({
        revoked_reason: 'admin',
      });
    });

    it('without an admin reason the audit row keeps its generic shape (triangulation)', async () => {
      await service.revokeInTx(
        tx as never,
        { linked_device_id: 'd1' },
        { by: GUARDIAN, reason: 'admin' },
      );

      expect(tx.audit_logs.create.mock.calls[0][0].data).toMatchObject({
        action: 'linked_device.revoked',
        changes: { reason: 'admin' },
      });
    });

    it('a system revoke has no actor and audits as system', async () => {
      await service.revokeInTx(
        tx as never,
        { linked_device_id: 'd1' },
        { by: null, reason: 'majority' },
      );

      expect(tx.audit_logs.create.mock.calls[0][0].data).toMatchObject({
        actor_user_id: null,
        actor_kind: 'system',
      });
    });

    it('a device that lost the race (count 0) is not reported, deleted or audited again', async () => {
      tx.linked_devices.updateMany.mockResolvedValue({ count: 0 });

      const revoked = await service.revokeInTx(
        tx as never,
        { linked_device_id: 'd1' },
        { by: GUARDIAN, reason: 'guardian' },
      );

      expect(revoked).toEqual([]);
      expect(tx.session.deleteMany).not.toHaveBeenCalled();
      expect(tx.audit_logs.create).not.toHaveBeenCalled();
    });

    it('no active device is a quiet no-op', async () => {
      tx.linked_devices.findMany.mockResolvedValue([]);

      await expect(
        service.revokeInTx(
          tx as never,
          { dependent_user_id: CHILD },
          { by: null, reason: 'dependent_frozen' },
        ),
      ).resolves.toEqual([]);
      expect(tx.audit_logs.create).not.toHaveBeenCalled();
    });

    it('when the last device goes, the tokens a rotation left behind are deactivated too', async () => {
      tx.linked_devices.count.mockResolvedValue(0);

      await service.revokeInTx(
        tx as never,
        { dependent_user_id: CHILD },
        { by: null, reason: 'guardianship_revoked' },
      );

      expect(tx.user_fcm_tokens.updateMany).toHaveBeenCalledWith({
        where: { user_id: CHILD, active: true },
        data: { active: false },
      });
    });

    it('while another device is left the child keeps its other tokens', async () => {
      tx.linked_devices.count.mockResolvedValue(1);

      await service.revokeInTx(
        tx as never,
        { linked_device_id: 'd1' },
        { by: GUARDIAN, reason: 'guardian' },
      );

      expect(tx.user_fcm_tokens.updateMany).not.toHaveBeenCalledWith({
        where: { user_id: CHILD, active: true },
        data: { active: false },
      });
    });

    it('revokes several devices of the child, one audit row each', async () => {
      tx.linked_devices.findMany.mockResolvedValue([row('d1'), row('d2')]);
      tx.linked_devices.count.mockResolvedValue(0);

      const revoked = await service.revokeInTx(
        tx as never,
        { dependent_user_id: CHILD },
        { by: null, reason: 'teen_login_enabled' },
      );

      expect(revoked).toHaveLength(2);
      expect(tx.audit_logs.create).toHaveBeenCalledTimes(2);
      expect(tx.session.deleteMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('revokeStandalone', () => {
    it('runs its own transaction and bumps the epoch of each child afterwards', async () => {
      await service.revokeStandalone(
        { linked_device_id: 'd1' },
        { by: null, reason: 'expired' },
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(cache.bump).toHaveBeenCalledWith(CHILD);
    });

    it('does not bump when nothing was revoked', async () => {
      tx.linked_devices.findMany.mockResolvedValue([]);

      await service.revokeStandalone(
        { linked_device_id: 'd1' },
        { by: null, reason: 'expired' },
      );

      expect(cache.bump).not.toHaveBeenCalled();
    });
  });

  describe('healOrphansInTx', () => {
    it('revokes (session_revoked) only the ACTIVE devices whose session row is gone', async () => {
      tx.linked_devices.findMany
        .mockResolvedValueOnce([
          { linked_device_id: 'd1', session_id: 'sid-d1' },
          { linked_device_id: 'd2', session_id: 'sid-d2' },
        ])
        .mockResolvedValueOnce([row('d1')]);
      tx.session.findMany.mockResolvedValue([{ id: 'sid-d2' }]);

      const healed = await service.healOrphansInTx(tx as never, CHILD);

      expect(tx.linked_devices.findMany.mock.calls[0][0].where).toEqual({
        dependent_user_id: CHILD,
        revoked_at: null,
      });
      expect(tx.session.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['sid-d1', 'sid-d2'] } },
        select: { id: true },
      });
      expect(tx.linked_devices.findMany.mock.calls[1][0].where).toEqual({
        linked_device_id: { in: ['d1'] },
        revoked_at: null,
      });
      expect(tx.linked_devices.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.linked_devices.updateMany).toHaveBeenCalledWith({
        where: { linked_device_id: 'd1', revoked_at: null },
        data: {
          revoked_at: expect.any(Date),
          revoked_by_user_id: null,
          revoked_reason: 'session_revoked',
        },
      });
      expect(healed.map((device) => device.linkedDeviceId)).toEqual(['d1']);
      expect(tx.audit_logs.create).toHaveBeenCalledTimes(1);
    });

    it('does nothing when every active device still has its session', async () => {
      tx.linked_devices.findMany.mockResolvedValueOnce([
        { linked_device_id: 'd1', session_id: 'sid-d1' },
      ]);
      tx.session.findMany.mockResolvedValue([{ id: 'sid-d1' }]);

      await expect(
        service.healOrphansInTx(tx as never, CHILD),
      ).resolves.toEqual([]);
      expect(tx.linked_devices.updateMany).not.toHaveBeenCalled();
    });

    it('is a single read when the child has no active device', async () => {
      tx.linked_devices.findMany.mockResolvedValueOnce([]);

      await expect(
        service.healOrphansInTx(tx as never, CHILD),
      ).resolves.toEqual([]);
      expect(tx.session.findMany).not.toHaveBeenCalled();
    });
  });

  describe('markMissingSessionsRevoked', () => {
    it('is one cheap read when the user has no device', async () => {
      prisma.linked_devices.findMany.mockResolvedValue([]);

      await expect(
        service.markMissingSessionsRevoked(CHILD, GUARDIAN),
      ).resolves.toEqual([]);
      expect(prisma.session.findMany).not.toHaveBeenCalled();
    });

    it('records session_revoked only for the devices whose session is gone', async () => {
      prisma.linked_devices.findMany.mockResolvedValue([
        { session_id: 'sid-d1' },
        { session_id: 'sid-d2' },
      ]);
      prisma.session.findMany.mockResolvedValue([{ id: 'sid-d2' }]);

      await service.markMissingSessionsRevoked(CHILD, GUARDIAN);

      expect(tx.linked_devices.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { session_id: { in: ['sid-d1'] }, revoked_at: null },
        }),
      );
    });

    it('never throws: a failure is logged', async () => {
      prisma.linked_devices.findMany.mockRejectedValue(new Error('db'));

      await expect(
        service.markMissingSessionsRevoked(CHILD, null),
      ).resolves.toEqual([]);
      expect(Logger.prototype.warn).toHaveBeenCalled();
    });
  });

  describe('auto-revoke announcements', () => {
    const revoked = [
      {
        linkedDeviceId: 'd1',
        dependentUserId: 'kid',
        guardianshipId: 'gs',
        pairedByUserId: 'g',
        label: 'Tablet',
        platform: 'android',
        sessionId: 's1',
      },
    ];

    it('hands the revoked rows and the reason to the registered listener', () => {
      const listener = jest.fn();
      service.onAutoRevoked(listener);

      service.announceAutoRevoked(revoked, 'majority');

      expect(listener).toHaveBeenCalledWith(revoked, 'majority');
    });

    it('does nothing without a listener or without rows', () => {
      expect(() =>
        service.announceAutoRevoked(revoked, 'expired'),
      ).not.toThrow();
      const listener = jest.fn();
      service.onAutoRevoked(listener);
      service.announceAutoRevoked([], 'expired');
      expect(listener).not.toHaveBeenCalled();
    });

    it('a listener that throws never propagates, it is logged', () => {
      service.onAutoRevoked(() => {
        throw new Error('boom');
      });

      expect(() =>
        service.announceAutoRevoked(revoked, 'expired'),
      ).not.toThrow();
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining('boom'),
      );
    });

    it('a listener that rejects never propagates, it is logged', async () => {
      service.onAutoRevoked(() => Promise.reject(new Error('async boom')));

      expect(() =>
        service.announceAutoRevoked(revoked, 'expired'),
      ).not.toThrow();
      await new Promise<void>((r) => setImmediate(r));
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining('async boom'),
      );
    });
  });
});

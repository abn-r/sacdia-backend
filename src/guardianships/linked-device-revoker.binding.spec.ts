import 'reflect-metadata';
import {
  MODULE_METADATA,
  OPTIONAL_DEPS_METADATA,
  SELF_DECLARED_DEPS_METADATA,
} from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { LinkedDeviceRevocation } from '../auth/device/linked-device-revocation';
import { DependentProfilesPurgeCronService } from './dependent-profiles-purge-cron.service';
import { GuardianPowersPolicy } from './guardian-powers.policy';
import { GuardianSecurityNotificationsService } from './guardian-security-notifications.service';
import { GuardianshipLifecycleService } from './guardianship-lifecycle.service';
import { GuardianshipsModule } from './guardianships.module';
import { LinkCodesService } from './link-codes.service';
import {
  LINKED_DEVICE_REVOKER,
  NOOP_LINKED_DEVICE_REVOKER,
  type LinkedDeviceRevoker,
} from './linked-device-revoker.port';
import { LinkedDevicesService } from './linked-devices.service';
import { PendingTeenCronService } from './pending-teen-cron.service';
import { SupervisedLoginsService } from './supervised-logins.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Phase 3 lesson: a port with a silent default is a trap. In 3a the device
 * revoker was a no-op until 3b bound the real service. From 3b on the token is
 * REQUIRED everywhere and bound to LinkedDevicesService; a consumer that goes
 * back to `@Optional()` (or a module that goes back to the no-op) fails here.
 */
describe('LINKED_DEVICE_REVOKER binding (3b)', () => {
  const consumers = [
    GuardianshipLifecycleService,
    LinkCodesService,
    SupervisedLoginsService,
    PendingTeenCronService,
    DependentProfilesPurgeCronService,
  ];

  it.each(consumers.map((consumer) => [consumer.name, consumer] as const))(
    '%s injects LINKED_DEVICE_REVOKER without @Optional()',
    (_name, consumer) => {
      const declared: Array<{ index: number; param: unknown }> =
        Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, consumer) ?? [];
      const revoker = declared.find(
        (dep) => dep.param === LINKED_DEVICE_REVOKER,
      );
      expect(revoker).toBeDefined();

      const optional: number[] =
        Reflect.getMetadata(OPTIONAL_DEPS_METADATA, consumer) ?? [];
      expect(optional).not.toContain(revoker!.index);
    },
  );

  it('GuardianshipsModule binds the token to the REAL LinkedDevicesService (not the no-op) and exports it', () => {
    const providers: Array<Record<string, unknown>> = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      GuardianshipsModule,
    );
    const binding = providers.find(
      (provider) =>
        typeof provider === 'object' &&
        provider !== null &&
        provider.provide === LINKED_DEVICE_REVOKER,
    );
    expect(binding).toEqual({
      provide: LINKED_DEVICE_REVOKER,
      useExisting: LinkedDevicesService,
    });
    expect(binding).not.toHaveProperty('useValue');

    const exported: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      GuardianshipsModule,
    );
    expect(exported).toContain(LINKED_DEVICE_REVOKER);
    expect(exported).toContain(LinkedDevicesService);
  });

  it("in a real container the token resolves to LinkedDevicesService and a revoke reaches the revocation core in the CALLER's transaction", async () => {
    const revokeInTx = jest.fn().mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        LinkedDevicesService,
        { provide: LINKED_DEVICE_REVOKER, useExisting: LinkedDevicesService },
        { provide: PrismaService, useValue: {} },
        {
          provide: LinkedDeviceRevocation,
          useValue: { revokeInTx, onAutoRevoked: jest.fn() },
        },
        { provide: GuardianPowersPolicy, useValue: {} },
        { provide: GuardianSecurityNotificationsService, useValue: {} },
      ],
    }).compile();

    const revoker = moduleRef.get<LinkedDeviceRevoker>(LINKED_DEVICE_REVOKER);
    expect(revoker).toBeInstanceOf(LinkedDevicesService);
    expect(revoker).not.toBe(NOOP_LINKED_DEVICE_REVOKER);

    const callerTx = { marker: 'caller' } as never;
    await revoker.revokeAllForDependent(
      callerTx,
      'child-1',
      'dependent_frozen',
    );
    await revoker.revokeByGuardianship(
      callerTx,
      'gs-1',
      'guardianship_revoked',
    );

    // The prototype methods are reachable through the token (a spread of the
    // instance would have dropped them: the 3a lesson).
    expect(revokeInTx).toHaveBeenNthCalledWith(
      1,
      callerTx,
      { dependent_user_id: 'child-1' },
      { by: null, reason: 'dependent_frozen' },
    );
    expect(revokeInTx).toHaveBeenNthCalledWith(
      2,
      callerTx,
      { guardianship_id: 'gs-1' },
      { by: null, reason: 'guardianship_revoked' },
    );
  });

  it('a module that forgets the binding fails to compile (boot error, not a no-op)', async () => {
    await expect(
      Test.createTestingModule({
        providers: [
          GuardianshipLifecycleService,
          { provide: PrismaService, useValue: {} },
        ],
      }).compile(),
    ).rejects.toThrow();
  });
});

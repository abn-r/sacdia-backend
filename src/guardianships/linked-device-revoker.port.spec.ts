import { Test } from '@nestjs/testing';
import {
  LINKED_DEVICE_REVOKER,
  NOOP_LINKED_DEVICE_REVOKER,
  type LinkedDeviceRevoker,
} from './linked-device-revoker.port';

describe('LINKED_DEVICE_REVOKER port', () => {
  it('the default binding revokes nothing and never touches the transaction', async () => {
    const tx = new Proxy(
      {},
      {
        get: () => {
          throw new Error('the no-op revoker must not use the transaction');
        },
      },
    );

    await expect(
      NOOP_LINKED_DEVICE_REVOKER.revokeAllForDependent(
        tx as never,
        'dep-1',
        'teen_login_enabled',
      ),
    ).resolves.toBe(0);
    await expect(
      NOOP_LINKED_DEVICE_REVOKER.revokeByGuardianship(
        tx as never,
        'gs-1',
        'guardianship_revoked',
      ),
    ).resolves.toBe(0);
  });

  it('a later binding (3b) overrides the default through the same token', async () => {
    const real: LinkedDeviceRevoker = {
      revokeAllForDependent: jest.fn().mockResolvedValue(2),
      revokeByGuardianship: jest.fn().mockResolvedValue(1),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [{ provide: LINKED_DEVICE_REVOKER, useValue: real }],
    }).compile();

    const revoker = moduleRef.get<LinkedDeviceRevoker>(LINKED_DEVICE_REVOKER);
    expect(await revoker.revokeAllForDependent({} as never, 'd', 'admin')).toBe(
      2,
    );
  });
});

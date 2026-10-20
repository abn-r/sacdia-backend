import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { DevicePairingService } from '../../guardianships/device-pairing.service';
import { DeviceAuthController } from './device-auth.controller';

describe('DeviceAuthController', () => {
  const pairing = {
    pair: jest.fn().mockResolvedValue({ accessToken: 'device.jwt' }),
  };
  let controller: DeviceAuthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [DeviceAuthController],
      providers: [{ provide: DevicePairingService, useValue: pairing }],
    }).compile();
    controller = module.get(DeviceAuthController);
  });

  it('delegates to the pairing service with the IP and User-Agent of the request and wraps the envelope', async () => {
    const dto = { pairing_token: 'a'.repeat(22), platform: 'android' } as never;

    const result = await controller.pair(dto, {
      ip: '203.0.113.9',
      headers: { 'user-agent': 'SACDIA/2.4' },
    });

    expect(result).toEqual({
      status: 'success',
      data: { accessToken: 'device.jwt' },
    });
    expect(pairing.pair).toHaveBeenCalledWith(
      dto,
      expect.objectContaining({
        ipAddress: '203.0.113.9',
        userAgent: 'SACDIA/2.4',
      }),
    );
  });

  it('is @Public at POST /auth/device/pair and answers 200', () => {
    const handler = DeviceAuthController.prototype.pair;
    expect(new Reflector().get(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata('path', handler)).toBe('pair');
    expect(Reflect.getMetadata('path', DeviceAuthController)).toBe(
      'auth/device',
    );
    expect(Reflect.getMetadata('__httpCode__', handler)).toBe(200);
  });

  it('throttles per IP: 5 a minute and 20 an hour', () => {
    const handler = DeviceAuthController.prototype.pair;
    expect(Reflect.getMetadata('THROTTLER:LIMITshort', handler)).toBe(5);
    expect(Reflect.getMetadata('THROTTLER:TTLshort', handler)).toBe(60_000);
    expect(Reflect.getMetadata('THROTTLER:LIMITmedium', handler)).toBe(20);
    expect(Reflect.getMetadata('THROTTLER:TTLmedium', handler)).toBe(3_600_000);
  });

  it('declares no acting scope (it is a public entry: there is no principal yet)', () => {
    expect(
      Reflect.getMetadata('acting_scope', DeviceAuthController.prototype.pair),
    ).toBeUndefined();
  });
});

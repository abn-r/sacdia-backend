import { Test } from '@nestjs/testing';
import { ErrorCode } from '../../common/errors/error-codes';
import { SocialSignInController } from './social-sign-in.controller';
import { SocialSignInService } from './social-sign-in.service';

describe('SocialSignInController', () => {
  let controller: SocialSignInController;
  const service = { signIn: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [SocialSignInController],
      providers: [{ provide: SocialSignInService, useValue: service }],
    }).compile();
    controller = module.get(SocialSignInController);
  });

  it('applies the auth-grade 5/min throttle', () => {
    for (const name of ['short', 'medium', 'long']) {
      expect(
        Reflect.getMetadata(`THROTTLER:LIMIT${name}`, SocialSignInController),
      ).toBe(5);
      expect(
        Reflect.getMetadata(`THROTTLER:TTL${name}`, SocialSignInController),
      ).toBe(60000);
    }
  });

  it('delegates a known provider to the service', async () => {
    service.signIn.mockResolvedValue({ accessToken: 'jwt' });
    const dto = { idToken: 't', nonce: 'n' };
    await expect(controller.signIn('google', dto)).resolves.toEqual({
      accessToken: 'jwt',
    });
    expect(service.signIn).toHaveBeenCalledWith('google', dto);
  });

  it('rejects an unknown provider with AUTH_OAUTH_PROVIDER_INVALID', async () => {
    await expect(
      controller.signIn('facebook', { idToken: 't', nonce: 'n' }),
    ).rejects.toMatchObject({
      code: ErrorCode.AUTH_OAUTH_PROVIDER_INVALID,
    });
    expect(service.signIn).not.toHaveBeenCalled();
  });
});

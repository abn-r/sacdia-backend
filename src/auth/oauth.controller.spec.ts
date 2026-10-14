import { Test, TestingModule } from '@nestjs/testing';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';

describe('OAuthController', () => {
  let controller: OAuthController;

  const mockOAuthService = {
    getConnectedProviders: jest.fn(),
    disconnectProvider: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuthController],
      providers: [{ provide: OAuthService, useValue: mockOAuthService }],
    }).compile();

    controller = module.get<OAuthController>(OAuthController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should apply auth-grade 5/min throttle on the controller', () => {
    for (const name of ['short', 'medium', 'long']) {
      expect(
        Reflect.getMetadata(`THROTTLER:LIMIT${name}`, OAuthController),
      ).toBe(5);
      expect(Reflect.getMetadata(`THROTTLER:TTL${name}`, OAuthController)).toBe(
        60000,
      );
    }
  });

  it('should delegate connected providers to OAuthService', async () => {
    mockOAuthService.getConnectedProviders.mockResolvedValue(['google']);

    await expect(
      controller.getConnectedProviders({ user: { user_id: 'u-1' } }),
    ).resolves.toEqual(['google']);
    expect(mockOAuthService.getConnectedProviders).toHaveBeenCalledWith('u-1');
  });

  it('should delegate provider disconnection to OAuthService', async () => {
    const expected = { success: true };
    mockOAuthService.disconnectProvider.mockResolvedValue(expected);

    await expect(
      controller.disconnectProvider('apple', { user: { user_id: 'u-1' } }),
    ).resolves.toEqual(expected);
    expect(mockOAuthService.disconnectProvider).toHaveBeenCalledWith(
      'u-1',
      'apple',
    );
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';

describe('OAuthController', () => {
  let controller: OAuthController;

  const mockOAuthService = {
    initiateGoogleSignIn: jest.fn(),
    initiateAppleSignIn: jest.fn(),
    handleCallback: jest.fn(),
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

  it('should delegate Google sign-in to OAuthService', async () => {
    const dto = { redirectUrl: 'sacdia://oauth/callback' };
    const expected = { url: 'https://accounts.google.com/o/oauth2/v2/auth' };
    mockOAuthService.initiateGoogleSignIn.mockResolvedValue(expected);

    await expect(controller.googleSignIn(dto)).resolves.toEqual(expected);
    expect(mockOAuthService.initiateGoogleSignIn).toHaveBeenCalledWith(
      dto.redirectUrl,
    );
  });

  it('should delegate Apple sign-in to OAuthService', async () => {
    const dto = { redirectUrl: 'sacdia://oauth/callback' };
    const expected = { url: 'https://appleid.apple.com/auth/authorize' };
    mockOAuthService.initiateAppleSignIn.mockResolvedValue(expected);

    await expect(controller.appleSignIn(dto)).resolves.toEqual(expected);
    expect(mockOAuthService.initiateAppleSignIn).toHaveBeenCalledWith(
      dto.redirectUrl,
    );
  });

  it('should delegate OAuth callback to OAuthService', async () => {
    const dto = { sessionToken: 'ba-session', provider: 'google' };
    const expected = { accessToken: 'jwt' };
    mockOAuthService.handleCallback.mockResolvedValue(expected);

    await expect(controller.handleCallback(dto)).resolves.toEqual(expected);
    expect(mockOAuthService.handleCallback).toHaveBeenCalledWith(dto);
  });
});

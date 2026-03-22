import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { TokenBlacklistService } from '../../common/services/token-blacklist.service';

describe('JwtStrategy', () => {
  const mockConfigService = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'BETTER_AUTH_SECRET') return 'test-secret-min-32-chars-for-hs256';
      throw new Error(`Missing env var: ${key}`);
    }),
  } as unknown as ConfigService;

  const mockTokenBlacklistService = {
    isBlacklisted: jest.fn(),
    isUserBlacklisted: jest.fn(),
  } as unknown as TokenBlacklistService;

  const buildReq = (token: string) =>
    ({
      headers: { authorization: `Bearer ${token}` },
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return user payload when token is valid and not revoked', async () => {
    (mockTokenBlacklistService.isBlacklisted as jest.Mock).mockResolvedValue(
      false,
    );
    (
      mockTokenBlacklistService.isUserBlacklisted as jest.Mock
    ).mockResolvedValue(false);
    const strategy = new JwtStrategy(
      mockConfigService,
      mockTokenBlacklistService,
    );

    const result = await strategy.validate(buildReq('valid-token'), {
      sub: 'user-123',
      email: 'user@example.com',
      iat: 1700000000,
    });

    expect(result).toEqual({
      sub: 'user-123',
      userId: 'user-123',
      user_id: 'user-123',
      email: 'user@example.com',
    });
  });

  it('should throw UnauthorizedException when token is individually blacklisted', async () => {
    (mockTokenBlacklistService.isBlacklisted as jest.Mock).mockResolvedValue(
      true,
    );
    const strategy = new JwtStrategy(
      mockConfigService,
      mockTokenBlacklistService,
    );

    await expect(
      strategy.validate(buildReq('revoked-token'), {
        sub: 'user-123',
        email: 'user@example.com',
        iat: 1700000000,
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when user was globally blacklisted', async () => {
    (mockTokenBlacklistService.isBlacklisted as jest.Mock).mockResolvedValue(
      false,
    );
    (
      mockTokenBlacklistService.isUserBlacklisted as jest.Mock
    ).mockResolvedValue(true);
    const strategy = new JwtStrategy(
      mockConfigService,
      mockTokenBlacklistService,
    );

    await expect(
      strategy.validate(buildReq('valid-token'), {
        sub: 'user-123',
        email: 'user@example.com',
        iat: 1700000000,
      }),
    ).rejects.toThrow(UnauthorizedException);
  });
});

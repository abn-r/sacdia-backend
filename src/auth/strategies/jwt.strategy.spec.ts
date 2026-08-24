import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { TokenBlacklistService } from '../../common/services/token-blacklist.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { accessJwtClaims } from '../../common/constants/jwt-audiences';

describe('JwtStrategy', () => {
  const mockConfigService = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'BETTER_AUTH_SECRET')
        return 'test-secret-min-32-chars-for-hs256';
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

  const accessPayload = (overrides: Record<string, unknown> = {}) => ({
    sub: 'user-123',
    email: 'user@example.com',
    iat: 1700000000,
    ...accessJwtClaims(),
    ...overrides,
  });

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

    const result = await strategy.validate(
      buildReq('valid-token'),
      accessPayload(),
    );

    expect(result).toMatchObject({
      sub: 'user-123',
      userId: 'user-123',
      user_id: 'user-123',
      email: 'user@example.com',
      mfa_pending: false,
    });
    expect(mockTokenBlacklistService.isBlacklisted).toHaveBeenCalled();
  });

  it('rejects a QR member audience used as an API Bearer token', async () => {
    const strategy = new JwtStrategy(
      mockConfigService,
      mockTokenBlacklistService,
    );

    await expect(
      strategy.validate(
        buildReq('qr-member-token'),
        accessPayload({ aud: 'sacdia:qr-member' }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
    expect(mockTokenBlacklistService.isBlacklisted).not.toHaveBeenCalled();
  });

  it('rejects a QR member audience when aud is an array', async () => {
    const strategy = new JwtStrategy(
      mockConfigService,
      mockTokenBlacklistService,
    );

    await expect(
      strategy.validate(
        buildReq('qr-member-token'),
        accessPayload({ aud: ['sacdia:qr-member'] }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
  });

  it('rejects a token missing access iss/aud', async () => {
    const strategy = new JwtStrategy(
      mockConfigService,
      mockTokenBlacklistService,
    );

    await expect(
      strategy.validate(buildReq('legacy-token'), {
        sub: 'user-123',
        email: 'user@example.com',
        iat: 1700000000,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
    expect(mockTokenBlacklistService.isBlacklisted).not.toHaveBeenCalled();
  });

  it('rejects a token with the wrong issuer', async () => {
    const strategy = new JwtStrategy(
      mockConfigService,
      mockTokenBlacklistService,
    );

    await expect(
      strategy.validate(
        buildReq('wrong-iss-token'),
        accessPayload({ iss: 'https://evil.example' }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
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
      strategy.validate(buildReq('revoked-token'), accessPayload()),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
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
      strategy.validate(buildReq('valid-token'), accessPayload()),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
  });
});

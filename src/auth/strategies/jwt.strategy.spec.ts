import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { TokenBlacklistService } from '../../common/services/token-blacklist.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { accessJwtClaims } from '../../common/constants/jwt-audiences';

describe('JwtStrategy', () => {
  const buildConfigService = (degradedMode?: string) =>
    ({
      getOrThrow: jest.fn((key: string) => {
        if (key === 'BETTER_AUTH_SECRET')
          return 'test-secret-min-32-chars-for-hs256';
        throw new Error(`Missing env var: ${key}`);
      }),
      get: jest.fn((key: string) =>
        key === 'AUTH_BLACKLIST_DEGRADED_MODE' ? degradedMode : undefined,
      ),
    }) as unknown as ConfigService;

  const mockTokenBlacklistService = {
    checkToken: jest.fn(),
    checkUserTokens: jest.fn(),
  };

  const mockPrisma = {
    session: { findFirst: jest.fn() },
  };

  const buildStrategy = (degradedMode?: string) =>
    new JwtStrategy(
      buildConfigService(degradedMode),
      mockTokenBlacklistService as unknown as TokenBlacklistService,
      mockPrisma as unknown as PrismaService,
    );

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
    mockTokenBlacklistService.checkToken.mockResolvedValue('ok');
    mockTokenBlacklistService.checkUserTokens.mockResolvedValue('ok');
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return user payload when token is valid and not revoked', async () => {
    const strategy = buildStrategy();

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
    expect(mockTokenBlacklistService.checkToken).toHaveBeenCalled();
    expect(mockPrisma.session.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a QR member audience used as an API Bearer token', async () => {
    const strategy = buildStrategy();

    await expect(
      strategy.validate(
        buildReq('qr-member-token'),
        accessPayload({ aud: 'sacdia:qr-member' }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
    expect(mockTokenBlacklistService.checkToken).not.toHaveBeenCalled();
  });

  it('rejects a QR member audience when aud is an array', async () => {
    const strategy = buildStrategy();

    await expect(
      strategy.validate(
        buildReq('qr-member-token'),
        accessPayload({ aud: ['sacdia:qr-member'] }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
  });

  it('rejects a token missing access iss/aud', async () => {
    const strategy = buildStrategy();

    await expect(
      strategy.validate(buildReq('legacy-token'), {
        sub: 'user-123',
        email: 'user@example.com',
        iat: 1700000000,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
    expect(mockTokenBlacklistService.checkToken).not.toHaveBeenCalled();
  });

  it('rejects a token with the wrong issuer', async () => {
    const strategy = buildStrategy();

    await expect(
      strategy.validate(
        buildReq('wrong-iss-token'),
        accessPayload({ iss: 'https://evil.example' }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
  });

  it('should throw UnauthorizedException when token is individually blacklisted', async () => {
    mockTokenBlacklistService.checkToken.mockResolvedValue('revoked');
    const strategy = buildStrategy();

    await expect(
      strategy.validate(buildReq('revoked-token'), accessPayload()),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
  });

  it('should throw UnauthorizedException when user was globally blacklisted', async () => {
    mockTokenBlacklistService.checkUserTokens.mockResolvedValue('revoked');
    const strategy = buildStrategy();

    await expect(
      strategy.validate(buildReq('valid-token'), accessPayload()),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
  });

  describe('revocation cache unavailable', () => {
    const SID = '0b1c7d1e-1111-4444-8888-aaaaaaaaaaaa';

    beforeEach(() => {
      mockTokenBlacklistService.checkToken.mockResolvedValue('unavailable');
      mockTokenBlacklistService.checkUserTokens.mockResolvedValue(
        'unavailable',
      );
    });

    describe('db-session (default)', () => {
      it.each([[undefined], ['db-session'], ['not-a-mode']])(
        'accepts a token whose session row is alive (mode=%p)',
        async (mode) => {
          mockPrisma.session.findFirst.mockResolvedValue({ id: SID });
          const strategy = buildStrategy(mode);

          const result = await strategy.validate(
            buildReq('t'),
            accessPayload({ sid: SID }),
          );

          expect(result).toMatchObject({ sub: 'user-123', sid: SID });
          expect(mockPrisma.session.findFirst).toHaveBeenCalledWith({
            where: {
              id: SID,
              userId: 'user-123',
              expiresAt: { gt: expect.any(Date) },
            },
            select: { id: true },
          });
        },
      );

      it('does not query the user-wide key again once the cache is known down', async () => {
        mockPrisma.session.findFirst.mockResolvedValue({ id: SID });
        const strategy = buildStrategy('db-session');

        await strategy.validate(buildReq('t'), accessPayload({ sid: SID }));

        expect(
          mockTokenBlacklistService.checkUserTokens,
        ).not.toHaveBeenCalled();
      });

      it('handles an unavailable user-wide check after an ok token check', async () => {
        mockTokenBlacklistService.checkToken.mockResolvedValue('ok');
        mockPrisma.session.findFirst.mockResolvedValue({ id: SID });
        const strategy = buildStrategy('db-session');

        await expect(
          strategy.validate(buildReq('t'), accessPayload({ sid: SID })),
        ).resolves.toMatchObject({ sid: SID });
        expect(mockPrisma.session.findFirst).toHaveBeenCalledTimes(1);
      });

      it('rejects with 401 when the session row is missing or expired', async () => {
        mockPrisma.session.findFirst.mockResolvedValue(null);
        const strategy = buildStrategy('db-session');

        await expect(
          strategy.validate(buildReq('t'), accessPayload({ sid: SID })),
        ).rejects.toMatchObject({
          code: ErrorCode.GUARD_JWT_UNAUTHORIZED,
          status: 401,
        });
      });

      it('behaves like reject (503) when the token has no sid', async () => {
        const strategy = buildStrategy('db-session');

        await expect(
          strategy.validate(buildReq('t'), accessPayload()),
        ).rejects.toMatchObject({
          code: ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
          status: 503,
        });
        expect(mockPrisma.session.findFirst).not.toHaveBeenCalled();
      });

      it('answers 503 (not 401) when the database lookup itself fails', async () => {
        mockPrisma.session.findFirst.mockRejectedValue(new Error('db down'));
        const strategy = buildStrategy('db-session');

        await expect(
          strategy.validate(buildReq('t'), accessPayload({ sid: SID })),
        ).rejects.toMatchObject({
          code: ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
          status: 503,
        });
      });
    });

    describe('reject', () => {
      it('answers 503 even when the token carries a live sid', async () => {
        mockPrisma.session.findFirst.mockResolvedValue({ id: SID });
        const strategy = buildStrategy('reject');

        await expect(
          strategy.validate(buildReq('t'), accessPayload({ sid: SID })),
        ).rejects.toMatchObject({
          code: ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
          status: 503,
        });
        expect(mockPrisma.session.findFirst).not.toHaveBeenCalled();
      });
    });

    describe('allow', () => {
      it('accepts the token without touching the database and warns', async () => {
        const strategy = buildStrategy('allow');

        await expect(
          strategy.validate(buildReq('t'), accessPayload()),
        ).resolves.toMatchObject({ sub: 'user-123' });
        expect(mockPrisma.session.findFirst).not.toHaveBeenCalled();
        expect(Logger.prototype.warn).toHaveBeenCalledWith(
          expect.stringContaining('auth_jwt_revocation_check_unavailable'),
        );
      });

      it('rate-limits the degraded warning', async () => {
        const strategy = buildStrategy('allow');

        await strategy.validate(buildReq('t'), accessPayload());
        await strategy.validate(buildReq('t'), accessPayload());
        await strategy.validate(buildReq('t'), accessPayload());

        const degradedWarnings = (
          Logger.prototype.warn as jest.Mock
        ).mock.calls.filter(([message]) =>
          String(message).includes('auth_jwt_revocation_check_unavailable'),
        );
        expect(degradedWarnings).toHaveLength(1);
      });
    });

    it('a revoked verdict still wins over an unavailable one', async () => {
      mockTokenBlacklistService.checkToken.mockResolvedValue('ok');
      mockTokenBlacklistService.checkUserTokens.mockResolvedValue('revoked');
      const strategy = buildStrategy('allow');

      await expect(
        strategy.validate(buildReq('t'), accessPayload({ sid: SID })),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
    });
  });
});

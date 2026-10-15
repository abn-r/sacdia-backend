import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BetterAuthService } from '../../better-auth/better-auth.service';
import { AppUnauthorizedException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { FILE_STORAGE_SERVICE } from '../../common/services/file-storage.service';
import { TokenBlacklistService } from '../../common/services/token-blacklist.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppleTokenClient } from './apple-token.client';
import { SocialAccountResolver } from './social-account.resolver';
import { SocialSignInService } from './social-sign-in.service';
import {
  APPLE_ID_TOKEN_VERIFIER,
  GOOGLE_ID_TOKEN_VERIFIER,
  type VerifiedIdentity,
} from './social-sign-in.types';

describe('SocialSignInService', () => {
  let service: SocialSignInService;

  const google = { provider: 'google', verify: jest.fn() };
  const apple = { provider: 'apple', verify: jest.fn() };
  const resolver = { resolve: jest.fn() };
  const appleTokens = { exchangeCode: jest.fn() };
  const betterAuth = {
    createSession: jest.fn().mockResolvedValue({
      id: 'sess-1',
      token: 'opaque-token',
      expiresAt: new Date(1_900_000_000_000),
    }),
    signJwt: jest.fn().mockReturnValue('sacdia-jwt'),
    hasTotpEnabled: jest.fn(),
  };
  const tokenBlacklist = { blacklistAllUserTokens: jest.fn() };
  const prisma = {
    users: { findUnique: jest.fn() },
    users_pr: { findUnique: jest.fn() },
    account: { findMany: jest.fn(), update: jest.fn() },
  };
  const fileStorage = {
    getSignedDownloadUrl: jest.fn(
      async (_b: unknown, v: string) => `signed:${v}`,
    ),
  };

  const identity: VerifiedIdentity = {
    provider: 'google',
    sub: 'g-1',
    email: 'ana@example.com',
    emailVerified: true,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    google.verify.mockResolvedValue(identity);
    betterAuth.hasTotpEnabled.mockResolvedValue({ enabled: false });
    apple.verify.mockResolvedValue({
      ...identity,
      provider: 'apple',
      sub: 'a-1',
    });
    resolver.resolve.mockResolvedValue({
      userId: 'user-1',
      created: false,
      linked: false,
      revokedPriorAccess: false,
    });
    prisma.users.findUnique.mockResolvedValue({
      user_id: 'user-1',
      email: 'ana@example.com',
      name: 'Ana',
      paternal_last_name: 'Pérez',
      maternal_last_name: null,
      user_image: 'profiles/u1.jpg',
    });
    prisma.users_pr.findUnique.mockResolvedValue({ complete: true });
    prisma.account.findMany.mockResolvedValue([
      { providerId: 'credential' },
      { providerId: 'google' },
    ]);

    const module = await Test.createTestingModule({
      providers: [
        SocialSignInService,
        { provide: GOOGLE_ID_TOKEN_VERIFIER, useValue: google },
        { provide: APPLE_ID_TOKEN_VERIFIER, useValue: apple },
        { provide: SocialAccountResolver, useValue: resolver },
        { provide: AppleTokenClient, useValue: appleTokens },
        { provide: BetterAuthService, useValue: betterAuth },
        { provide: PrismaService, useValue: prisma },
        { provide: FILE_STORAGE_SERVICE, useValue: fileStorage },
        { provide: TokenBlacklistService, useValue: tokenBlacklist },
      ],
    }).compile();
    service = module.get(SocialSignInService);
  });

  it('returns the old OAuth callback payload plus the login token fields', async () => {
    const context = { ipAddress: '198.51.100.4', userAgent: 'Dart/3.11' };
    await expect(
      service.signIn('google', { idToken: 't', nonce: 'n' }, context),
    ).resolves.toEqual({
      accessToken: 'sacdia-jwt',
      sessionToken: 'opaque-token',
      refreshToken: 'opaque-token',
      expiresAt: 1_900_000_000,
      tokenType: 'bearer',
      user: {
        id: 'user-1',
        email: 'ana@example.com',
        name: 'Ana',
        paternal_last_name: 'Pérez',
        maternal_last_name: null,
        avatar: 'signed:profiles/u1.jpg',
        connectedProviders: ['google'],
      },
      needsPostRegistration: false,
    });
    expect(google.verify).toHaveBeenCalledWith('t', 'n');
    expect(betterAuth.createSession).toHaveBeenCalledWith('user-1', context);
    expect(betterAuth.signJwt).toHaveBeenCalledWith(
      { id: 'user-1', email: 'ana@example.com' },
      false,
      'sess-1',
    );
  });

  it('issues an mfa_pending token when the user has TOTP enabled', async () => {
    betterAuth.hasTotpEnabled.mockResolvedValue({ enabled: true });
    await service.signIn('google', { idToken: 't', nonce: 'n' });
    expect(betterAuth.hasTotpEnabled).toHaveBeenCalledWith('user-1');
    expect(betterAuth.signJwt).toHaveBeenCalledWith(
      { id: 'user-1', email: 'ana@example.com' },
      true,
      'sess-1',
    );
  });

  it('blacklists prior JWTs before signing when prior access was revoked', async () => {
    resolver.resolve.mockResolvedValue({
      userId: 'user-1',
      created: false,
      linked: true,
      revokedPriorAccess: true,
    });
    await service.signIn('google', { idToken: 't', nonce: 'n' });
    expect(tokenBlacklist.blacklistAllUserTokens).toHaveBeenCalledWith(
      'user-1',
      28800,
    );
    const blacklistOrder =
      tokenBlacklist.blacklistAllUserTokens.mock.invocationCallOrder[0];
    expect(blacklistOrder).toBeLessThan(
      betterAuth.createSession.mock.invocationCallOrder[0],
    );
    expect(blacklistOrder).toBeLessThan(
      betterAuth.signJwt.mock.invocationCallOrder[0],
    );
  });

  describe('when prior access was revoked and the blacklist is flaky', () => {
    beforeEach(() => {
      resolver.resolve.mockResolvedValue({
        userId: 'user-1',
        created: false,
        linked: true,
        revokedPriorAccess: true,
      });
    });

    it('retries the blacklist once and signs in', async () => {
      tokenBlacklist.blacklistAllUserTokens
        .mockRejectedValueOnce(new Error('cache down'))
        .mockResolvedValueOnce(undefined);

      await expect(
        service.signIn('google', { idToken: 't', nonce: 'n' }),
      ).resolves.toMatchObject({ accessToken: 'sacdia-jwt' });
      expect(tokenBlacklist.blacklistAllUserTokens).toHaveBeenCalledTimes(2);
    });

    it('logs an error and still signs in when the retry fails too', async () => {
      const errorLog = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      tokenBlacklist.blacklistAllUserTokens.mockRejectedValue(
        new Error('cache down'),
      );

      try {
        await expect(
          service.signIn('google', { idToken: 't', nonce: 'n' }),
        ).resolves.toMatchObject({ accessToken: 'sacdia-jwt' });
        expect(tokenBlacklist.blacklistAllUserTokens).toHaveBeenCalledTimes(2);
        expect(errorLog).toHaveBeenCalledTimes(1);
        expect(String(errorLog.mock.calls[0][0])).toContain('user-1');
        expect(String(errorLog.mock.calls[0][0])).not.toContain('@');
        expect(betterAuth.createSession).toHaveBeenCalledWith(
          'user-1',
          undefined,
        );
      } finally {
        errorLog.mockRestore();
        tokenBlacklist.blacklistAllUserTokens.mockReset();
      }
    });
  });

  it('does not blacklist anything on a regular sign-in', async () => {
    await service.signIn('google', { idToken: 't', nonce: 'n' });
    expect(tokenBlacklist.blacklistAllUserTokens).not.toHaveBeenCalled();
  });

  it('flags post-registration for a new user', async () => {
    resolver.resolve.mockResolvedValue({
      userId: 'user-1',
      created: true,
      linked: false,
    });
    prisma.users_pr.findUnique.mockResolvedValue({ complete: false });
    await expect(
      service.signIn('google', { idToken: 't', nonce: 'n' }),
    ).resolves.toMatchObject({
      needsPostRegistration: true,
    });
  });

  it('rejects an identity without a verified email', async () => {
    google.verify.mockResolvedValue({ ...identity, emailVerified: false });
    const error = await service
      .signIn('google', { idToken: 't', nonce: 'n' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppUnauthorizedException);
    expect((error as AppUnauthorizedException).code).toBe(
      ErrorCode.AUTH_OAUTH_EMAIL_UNVERIFIED,
    );
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('rejects an identity without email', async () => {
    google.verify.mockResolvedValue({ ...identity, email: null });
    await expect(
      service.signIn('google', { idToken: 't', nonce: 'n' }),
    ).rejects.toMatchObject({
      code: ErrorCode.AUTH_OAUTH_EMAIL_UNVERIFIED,
    });
  });

  it('uses the app-provided full name for Apple', async () => {
    await service.signIn('apple', {
      idToken: 't',
      nonce: 'n',
      fullName: { givenName: 'Ana', familyName: 'Pérez' },
    });
    expect(resolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'apple',
        givenName: 'Ana',
        familyName: 'Pérez',
      }),
    );
  });

  it('stores the Apple refresh token after exchanging the authorization code', async () => {
    appleTokens.exchangeCode.mockResolvedValue({
      refreshToken: 'rt-1',
      sub: 'a-1',
    });
    await service.signIn('apple', {
      idToken: 't',
      nonce: 'n',
      authorizationCode: 'code',
    });
    expect(appleTokens.exchangeCode).toHaveBeenCalledWith('code');
    expect(prisma.account.update).toHaveBeenCalledWith({
      where: {
        providerId_accountId: { providerId: 'apple', accountId: 'a-1' },
      },
      data: { refreshToken: 'rt-1' },
    });
  });

  it('skips the refresh token when the code belongs to a different Apple identity', async () => {
    appleTokens.exchangeCode.mockResolvedValue({
      refreshToken: 'rt-other',
      sub: 'someone-else',
    });
    await expect(
      service.signIn('apple', {
        idToken: 't',
        nonce: 'n',
        authorizationCode: 'code',
      }),
    ).resolves.toMatchObject({ accessToken: 'sacdia-jwt' });
    expect(prisma.account.update).not.toHaveBeenCalled();
  });

  it('skips the refresh token when Apple returned no id_token sub', async () => {
    appleTokens.exchangeCode.mockResolvedValue({
      refreshToken: 'rt-1',
      sub: null,
    });
    await service.signIn('apple', {
      idToken: 't',
      nonce: 'n',
      authorizationCode: 'code',
    });
    expect(prisma.account.update).not.toHaveBeenCalled();
  });

  it('rejects an email longer than the users.email column before resolving', async () => {
    google.verify.mockResolvedValue({
      ...identity,
      email: `${'a'.repeat(95)}@example.com`,
    });
    const error = await service
      .signIn('google', { idToken: 't', nonce: 'n' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppUnauthorizedException);
    expect((error as AppUnauthorizedException).code).toBe(
      ErrorCode.AUTH_INVALID_TOKEN,
    );
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('still signs in when the Apple code exchange fails', async () => {
    appleTokens.exchangeCode.mockRejectedValue(new Error('invalid_grant'));
    await expect(
      service.signIn('apple', {
        idToken: 't',
        nonce: 'n',
        authorizationCode: 'code',
      }),
    ).resolves.toMatchObject({ accessToken: 'sacdia-jwt' });
    expect(prisma.account.update).not.toHaveBeenCalled();
  });

  it('does not call Apple when no authorization code is sent', async () => {
    await service.signIn('apple', { idToken: 't', nonce: 'n' });
    expect(appleTokens.exchangeCode).not.toHaveBeenCalled();
  });
});

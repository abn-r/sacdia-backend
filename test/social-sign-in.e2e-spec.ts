import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AppleTokenClient } from '../src/auth/social-sign-in/apple-token.client';
import {
  APPLE_ID_TOKEN_VERIFIER,
  GOOGLE_ID_TOKEN_VERIFIER,
} from '../src/auth/social-sign-in/social-sign-in.types';
import { BetterAuthService } from '../src/better-auth/better-auth.service';
import { AppUnauthorizedException } from '../src/common/errors/app.exception';
import { ErrorCode } from '../src/common/errors/error-codes';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Social sign-in E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const googleVerifier = { provider: 'google', verify: jest.fn() };
  const appleVerifier = { provider: 'apple', verify: jest.fn() };
  // The route is capped at 5/min per IP; the suite must not depend on that.
  const mockThrottlerGuard = { canActivate: jest.fn().mockReturnValue(true) };
  const appleTokens = { exchangeCode: jest.fn(), revoke: jest.fn() };
  const betterAuth = {
    createSession: jest.fn().mockResolvedValue({
      id: 'sess-1',
      token: 'opaque-token',
      expiresAt: new Date(1_900_000_000_000),
    }),
    signJwt: jest.fn().mockReturnValue('fake-jwt'),
  };

  const dbUser = {
    user_id: 'user-1',
    email: 'ana@example.com',
    name: 'Ana',
    paternal_last_name: null,
    maternal_last_name: null,
    user_image: null,
    email_verified: true,
    active: true,
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(APP_GUARD)
      .useValue(mockThrottlerGuard)
      .overrideGuard(ThrottlerGuard)
      .useValue(mockThrottlerGuard)
      .overrideProvider(BetterAuthService)
      .useValue(betterAuth)
      .overrideProvider(GOOGLE_ID_TOKEN_VERIFIER)
      .useValue(googleVerifier)
      .overrideProvider(APPLE_ID_TOKEN_VERIFIER)
      .useValue(appleVerifier)
      .overrideProvider(AppleTokenClient)
      .useValue(appleTokens)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.setGlobalPrefix('api/v1');
    prisma = app.get(PrismaService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(prisma, '$transaction')
      .mockImplementation((fn: (tx: PrismaService) => Promise<unknown>) =>
        fn(prisma),
      );
    jest.spyOn(prisma.account, 'findUnique').mockResolvedValue(null);
    jest.spyOn(prisma.account, 'create').mockResolvedValue({});
    jest
      .spyOn(prisma.account, 'findMany')
      .mockResolvedValue([{ providerId: 'google' }] as never);
    jest.spyOn(prisma.users, 'findUnique').mockResolvedValue(dbUser);
    jest.spyOn(prisma.users, 'create').mockResolvedValue(dbUser);
    jest.spyOn(prisma.users, 'update').mockResolvedValue(dbUser);
    jest
      .spyOn(prisma.users_pr, 'findUnique')
      .mockResolvedValue({ complete: false });
    jest.spyOn(prisma.users_pr, 'create').mockResolvedValue({});
    jest.spyOn(prisma.users_roles, 'findFirst').mockResolvedValue({});
  });

  const post = (provider: string, body: object) =>
    request(app.getHttpServer())
      .post(`/api/v1/auth/oauth/${provider}/token`)
      .send(body);

  it('returns 201 with the session payload for a valid Google token', async () => {
    googleVerifier.verify.mockResolvedValue({
      provider: 'google',
      sub: 'g-1',
      email: 'ana@example.com',
      emailVerified: true,
    });

    const res = await post('google', { idToken: 'id-token', nonce: 'nonce-1' });

    expect(res.status).toBe(201);
    // Success responses are wrapped by the global interceptor: { status, data }.
    expect(res.body.status).toBe('success');
    expect(res.body.data).toMatchObject({
      accessToken: 'fake-jwt',
      sessionToken: 'opaque-token',
      refreshToken: 'opaque-token',
      expiresAt: 1_900_000_000,
      tokenType: 'bearer',
      user: {
        id: 'user-1',
        email: 'ana@example.com',
        connectedProviders: ['google'],
      },
      needsPostRegistration: true,
    });
    expect(googleVerifier.verify).toHaveBeenCalledWith('id-token', 'nonce-1');
  });

  it('returns 401 AUTH_INVALID_TOKEN when the verifier rejects', async () => {
    googleVerifier.verify.mockRejectedValue(
      new AppUnauthorizedException(ErrorCode.AUTH_INVALID_TOKEN),
    );
    const res = await post('google', { idToken: 'bad', nonce: 'nonce-1' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.AUTH_INVALID_TOKEN);
  });

  it('returns 401 AUTH_OAUTH_EMAIL_UNVERIFIED for an unverified email', async () => {
    appleVerifier.verify.mockResolvedValue({
      provider: 'apple',
      sub: 'a-1',
      email: 'x@privaterelay.appleid.com',
      emailVerified: false,
    });
    const res = await post('apple', { idToken: 'id-token', nonce: 'nonce-1' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.AUTH_OAUTH_EMAIL_UNVERIFIED);
  });

  it('returns 400 for an unknown provider', async () => {
    const res = await post('facebook', {
      idToken: 'id-token',
      nonce: 'nonce-1',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.AUTH_OAUTH_PROVIDER_INVALID);
  });

  it('returns 400 when idToken or nonce is missing', async () => {
    const res = await post('google', { idToken: 'id-token' });
    expect(res.status).toBe(400);
    expect(googleVerifier.verify).not.toHaveBeenCalled();
  });
});

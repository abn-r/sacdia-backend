import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { createHmac } from 'crypto';
import { AppModule } from '../src/app.module';
import { BetterAuthService } from '../src/better-auth/better-auth.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const mockBetterAuthService = {
    signInWithPassword: jest.fn().mockResolvedValue({
      user: { id: 'test-user-id', email: 'test@example.com', name: 'Test' },
      session: {
        token: 'fake-session-token',
        expiresAt: new Date(1900000000000),
      },
      accessToken: 'fake-jwt',
    }),
    refreshSession: jest.fn().mockResolvedValue({
      user: { id: 'test-user-id', email: 'test@example.com', name: 'Test' },
      session: {
        token: 'fake-refreshed-session',
        expiresAt: new Date(1900000000000),
      },
      accessToken: 'fake-refreshed-jwt',
    }),
    signOut: jest.fn().mockResolvedValue(undefined),
    createUser: jest.fn().mockResolvedValue({
      user: { id: 'test-user-id', email: 'test@example.com', name: 'Test' },
      session: {
        token: 'fake-session-token',
        expiresAt: new Date(1900000000000),
      },
      accessToken: 'fake-jwt',
    }),
    signJwt: jest.fn().mockReturnValue('fake-jwt'),
    resetPasswordForEmail: jest.fn().mockResolvedValue(undefined),
    updatePasswordById: jest.fn().mockResolvedValue(undefined),
    getOAuthUrl: jest
      .fn()
      .mockResolvedValue({ url: 'https://oauth.test', state: 'xyz' }),
    handleOAuthCallback: jest.fn().mockResolvedValue({
      user: { id: 'test-user-id', email: 'test@example.com', name: 'Test' },
      session: {
        token: 'fake-session-token',
        expiresAt: new Date(1900000000000),
      },
      accessToken: 'fake-jwt',
    }),
    enrollTotp: jest.fn(),
    verifyTotp: jest.fn(),
    disableTotp: jest.fn(),
    hasTotpEnabled: jest.fn().mockResolvedValue({ enabled: false }),
  };

  const bootstrapApp = async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BetterAuthService)
      .useValue(mockBetterAuthService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.setGlobalPrefix('api/v1');
    prisma = app.get(PrismaService);
    await app.init();
  };

  const createSignedJwt = (payload: Record<string, unknown>): string => {
    const secret = process.env.BETTER_AUTH_SECRET || 'test-secret';
    const header = { alg: 'HS256', typ: 'JWT' };
    const encode = (value: Record<string, unknown>) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');

    const encodedHeader = encode(header);
    const encodedPayload = encode(payload);
    const signature = createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  };

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET || 'test-secret';
    process.env.AUTH_REJECT_SNAKE_CASE = 'true';
    await bootstrapApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/api/v1/auth/login (POST)', () => {
    it('should login successfully', async () => {
      jest.spyOn(prisma.users, 'findUnique').mockResolvedValue({
        user_id: 'test-user-id',
        email: 'test@example.com',
        user_image: null,
        name: 'Test',
        paternal_last_name: 'User',
        maternal_last_name: 'E2E',
        users_pr: null,
        users_roles: [
          { roles: { role_name: 'user', role_category: 'GLOBAL' } },
        ],
      } as any);

      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('success');
          expect(res.body.data).toHaveProperty('accessToken');
          expect(res.body.data).toHaveProperty('refreshToken');
          expect(res.body.data).toHaveProperty('expiresAt');
          expect(res.body.data).toHaveProperty('tokenType', 'bearer');
        });
    });

    it('should fail with invalid credentials', async () => {
      mockBetterAuthService.signInWithPassword.mockRejectedValueOnce(
        new Error('Invalid login credentials'),
      );

      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'wrong@example.com', password: 'wrong' })
        .expect(401);
    });
  });

  describe('/api/v1/auth/refresh (POST)', () => {
    it('should reject legacy snake_case payload by default', async () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: 'legacy-refresh' })
        .expect(400)
        .expect((res) => {
          const code =
            res.body.details?.code ??
            res.body.code ??
            res.body.details?.message?.code;
          expect(code).toBe('LEGACY_SNAKE_CASE_REMOVED');
        });
    });

    it('should refresh and allow /auth/me after server restart', async () => {
      await app.close();
      await bootstrapApp();

      const refreshedAccessToken = createSignedJwt({
        sub: 'test-user-id',
        email: 'test@example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      mockBetterAuthService.refreshSession.mockResolvedValueOnce({
        user: { id: 'test-user-id', email: 'test@example.com', name: 'Test' },
        session: {
          token: 'new-refresh-token',
          expiresAt: new Date(Date.now() + 3600000),
        },
        accessToken: refreshedAccessToken,
      });

      jest.spyOn(prisma.users, 'findUnique').mockResolvedValue({
        user_id: 'test-user-id',
        email: 'test@example.com',
        name: 'Test',
        paternal_last_name: 'User',
        maternal_last_name: 'E2E',
        gender: null,
        birthday: null,
        baptism: false,
        baptism_date: null,
        user_image: null,
        country_id: null,
        union_id: null,
        local_field_id: null,
        created_at: new Date(),
        users_pr: { complete: true },
        users_roles: [
          {
            roles: {
              role_name: 'user',
              role_category: 'GLOBAL',
              role_permissions: [],
            },
          },
        ],
        club_role_assignments: [],
      } as any);

      const refreshRes = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'persisted-refresh-token' })
        .expect(200);

      const newAccessToken = refreshRes.body.data.accessToken;
      expect(newAccessToken).toBeTruthy();

      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${newAccessToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('success');
          expect(res.body.data.user_id).toBe('test-user-id');
        });
    });

    it('should allow legacy snake_case payload when rollback flag is disabled', async () => {
      process.env.AUTH_REJECT_SNAKE_CASE = 'false';

      mockBetterAuthService.refreshSession.mockResolvedValueOnce({
        user: { id: 'test-user-id', email: 'test@example.com', name: 'Test' },
        session: {
          token: 'legacy-refresh-token',
          expiresAt: new Date(Date.now() + 3600000),
        },
        accessToken: 'legacy-access-token',
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: 'legacy-refresh' })
        .expect(200)
        .expect((res) => {
          expect(res.body.data.accessToken).toBe('legacy-access-token');
          expect(res.body.data.refreshToken).toBe('legacy-refresh-token');
        });

      process.env.AUTH_REJECT_SNAKE_CASE = 'true';
    });
  });

  describe('/api/v1/auth/logout (POST)', () => {
    it('should return 200 even without Authorization header', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({})
        .expect(200)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.revocationAttempted).toBe(false);
          expect(res.body.revocationSucceeded).toBe(false);
        });
    });
  });
});
